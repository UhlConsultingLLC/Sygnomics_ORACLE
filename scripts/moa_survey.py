"""Survey all MOA categories × trials to compute SATGBM metrics across the DB.

For each (trial, drug, MOA) combination this script computes and persists to
the ``trial_satgbm_metrics`` table:

  * percentage of predicted responders *recovered* (responders excluded by
    trial eligibility criteria / total predicted responders).
  * fold change of identified responders (total SATGBM predicted responders /
    trial-eligible responders).

Learned DCNA thresholds per MOA are cached to ``data/moa_threshold_cache.json``
so re-runs skip the expensive simulations entirely.

Usage:
    python -m scripts.moa_survey
"""

import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

# Override print to handle non-Latin characters and flush immediately
_builtin_print = print
def print(*args, **kwargs):
    kwargs.setdefault("flush", True)
    try:
        _builtin_print(*args, **kwargs)
    except UnicodeEncodeError:
        safe_args = []
        for a in args:
            if isinstance(a, str):
                safe_args.append(a.encode("ascii", errors="replace").decode("ascii"))
            else:
                safe_args.append(a)
        _builtin_print(*safe_args, **kwargs)


# Add project root to path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from database.engine import create_db_engine, init_db, get_session_factory
from database.models import (
    InterventionRecord,
    MOAAnnotationRecord,
    TrialRecord,
    EligibilityRecord,
    TrialSATGBMMetric,
    trial_interventions,
)


THRESHOLD_CACHE_PATH = ROOT / "data" / "moa_threshold_cache.json"
OUT_JSON_PATH = ROOT / "data" / "moa_survey_results.json"


def _load_threshold_cache() -> dict:
    if THRESHOLD_CACHE_PATH.exists():
        try:
            with open(THRESHOLD_CACHE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_threshold_cache(cache: dict) -> None:
    THRESHOLD_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(THRESHOLD_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)


def _upsert_metric(db, *, trial_nct_id, intervention_id, moa_category,
                   drug_name, learned_threshold, total_scored, enrolled,
                   responders_enrolled, responders_excluded, total_responders,
                   n_biomarker_rules, pct_recovered, fold_change,
                   trial_predicted_rr, satgbm_predicted_rr):
    """Insert or update a metric row for this (trial, drug, moa) scope."""
    row = (
        db.query(TrialSATGBMMetric)
        .filter_by(
            trial_nct_id=trial_nct_id,
            intervention_id=intervention_id,
            moa_category=moa_category,
            arm_id=None,
            group_title="",
        )
        .first()
    )
    if row is None:
        row = TrialSATGBMMetric(
            trial_nct_id=trial_nct_id,
            intervention_id=intervention_id,
            moa_category=moa_category,
            arm_id=None,
            group_title="",
        )
        db.add(row)
    row.drug_name = drug_name
    row.learned_dcna_threshold = float(learned_threshold)
    row.expression_threshold = 0.0
    row.total_scored = int(total_scored)
    row.enrolled_by_criteria = int(enrolled)
    row.responders_enrolled = int(responders_enrolled)
    row.responders_excluded = int(responders_excluded)
    row.total_responders = int(total_responders)
    row.n_biomarker_rules = int(n_biomarker_rules)
    row.pct_responders_recovered = float(pct_recovered)
    row.fold_change = None if fold_change is None else float(fold_change)
    row.trial_predicted_rr = float(trial_predicted_rr)
    row.satgbm_predicted_rr = float(satgbm_predicted_rr)


def main():
    # ── Setup ──
    engine = create_db_engine()
    init_db(engine)
    SessionFactory = get_session_factory(engine)
    db = SessionFactory()

    # ── 1) Build trial → drug → MOA mapping ──
    print("Querying trial-drug-MOA combinations...")
    rows = (
        db.query(
            trial_interventions.c.trial_nct_id,
            InterventionRecord.id.label("intervention_id"),
            InterventionRecord.name.label("drug_name"),
            MOAAnnotationRecord.moa_short_form,
            MOAAnnotationRecord.moa_broad_category,
        )
        .join(InterventionRecord, trial_interventions.c.intervention_id == InterventionRecord.id)
        .join(MOAAnnotationRecord, MOAAnnotationRecord.intervention_id == InterventionRecord.id)
        .filter(MOAAnnotationRecord.moa_short_form.isnot(None))
        .filter(MOAAnnotationRecord.moa_short_form != "")
        .all()
    )

    moa_trials = defaultdict(list)
    seen = set()
    for r in rows:
        moa_key = f"group:{r.moa_broad_category}" if r.moa_broad_category else r.moa_short_form
        dedup = (r.trial_nct_id, r.intervention_id, moa_key)
        if dedup in seen:
            continue
        seen.add(dedup)
        moa_trials[moa_key].append({
            "nct_id": r.trial_nct_id,
            "intervention_id": r.intervention_id,
            "drug_name": r.drug_name,
            "moa_short": r.moa_short_form,
            "moa_broad": r.moa_broad_category,
        })

    total_combos = sum(len(v) for v in moa_trials.values())
    print(f"Found {len(moa_trials)} MOA categories, {total_combos} trial-drug combinations\n")

    # ── 2) Lazy-load heavy modules ──
    from analysis.biomarker_extractor import extract_biomarkers
    from analysis.moa_simulation import MOASimulationEngine
    from api.routers.tcga import get_drug_targets as tcga_get_drug_targets, _load_dcna, _load_expression

    print("Loading TCGA DCNA + expression data...")
    dcna_patients, _, dcna_data = _load_dcna()
    expr_patients, _, expr_data = _load_expression()
    expr_idx = {p: i for i, p in enumerate(expr_patients)}

    bio_path = os.path.join(ROOT, "data", "tcga_patient_biomarkers.json")
    try:
        with open(bio_path, "r", encoding="utf-8") as f:
            bio_json = json.load(f)
    except Exception:
        bio_json = {"patients": {}}
    patients_bio = bio_json.get("patients") or {}
    print(f"Loaded {len(patients_bio)} patient biomarker profiles\n")

    from api.routers.trials import _build_biomarker_mappers
    mappers = _build_biomarker_mappers()

    upper_map = {d.upper(): d for d in dcna_data}

    # ── Threshold cache (avoids re-running slow MOA simulations) ──
    threshold_cache = _load_threshold_cache()
    print(f"Loaded {len(threshold_cache)} cached MOA thresholds\n")

    engine_sim = MOASimulationEngine(n_iterations=1000, save_plots=False)

    moa_keys_sorted = sorted(moa_trials.keys())
    combo_idx = 0
    metrics_written = 0

    for mi, moa_key in enumerate(moa_keys_sorted):
        trials_list = moa_trials[moa_key]
        print(f"[{mi+1}/{len(moa_keys_sorted)}] MOA: {moa_key}  ({len(trials_list)} trials)")

        # ── Resolve learned threshold (from cache or by running simulation) ──
        if moa_key in threshold_cache:
            entry = threshold_cache[moa_key]
            if entry.get("error"):
                print(f"  !! Cached error — {entry['error']}")
                continue
            learned_threshold = entry["threshold"]
        else:
            try:
                sim_result = engine_sim.run(moa_key, db)
                if "error" in sim_result:
                    short = moa_key.replace("group:", "") if moa_key.startswith("group:") else moa_key
                    sim_result = engine_sim.run(short, db)
            except Exception as e:
                sim_result = {"error": f"exception: {e}"}

            if "error" in sim_result:
                threshold_cache[moa_key] = {"error": sim_result["error"]}
                _save_threshold_cache(threshold_cache)
                print(f"  !! Simulation error: {sim_result['error']}")
                continue

            threshold = sim_result.get("overall_learned_threshold")
            if threshold is None:
                threshold_cache[moa_key] = {"error": "no learned threshold"}
                _save_threshold_cache(threshold_cache)
                print(f"  !! No learned threshold")
                continue

            learned_threshold = float(threshold)
            threshold_cache[moa_key] = {
                "threshold": learned_threshold,
                "computed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            _save_threshold_cache(threshold_cache)

        expression_threshold = 0.0

        # ── Process each trial in this MOA ──
        for trial_info in trials_list:
            combo_idx += 1
            nct_id = trial_info["nct_id"]
            intervention_id = trial_info["intervention_id"]
            drug_name = trial_info["drug_name"]

            try:
                # Resolve DCNA key for this drug
                dcna_key = None
                if drug_name in dcna_data:
                    dcna_key = drug_name
                else:
                    hit = upper_map.get(drug_name.upper())
                    if hit:
                        dcna_key = hit
                if dcna_key is None:
                    try:
                        from api.mesh_expansion import expand_intervention
                        for syn in expand_intervention(drug_name):
                            if syn in dcna_data:
                                dcna_key = syn
                                break
                            if syn.upper() in upper_map:
                                dcna_key = upper_map[syn.upper()]
                                break
                    except Exception:
                        pass

                if dcna_key is None:
                    continue

                # Drug targets
                try:
                    targets_info = tcga_get_drug_targets(drug_name)
                    targets_raw = targets_info.get("targets") or []
                    target_genes_in_expr = [t["gene_symbol"] for t in targets_raw if t.get("in_expression_data")]
                except Exception:
                    target_genes_in_expr = []

                trial_row = db.get(TrialRecord, nct_id)
                if trial_row is None:
                    continue
                elig = db.query(EligibilityRecord).filter_by(trial_nct_id=nct_id).first()
                elig_criteria = elig.criteria_text if elig and elig.criteria_text else ""
                elig_text = "\n".join([
                    elig_criteria,
                    trial_row.brief_summary or "",
                    trial_row.detailed_description or "",
                ]).strip()
                elig_end_offset = len(elig_criteria) if elig_criteria else None
                markers = extract_biomarkers(elig_text, eligibility_end_offset=elig_end_offset)

                inclusion_rules = []
                exclusion_rules = []
                for m in markers:
                    fn = mappers.get(m.marker)
                    if fn is None:
                        continue
                    if m.context == "exclusion":
                        exclusion_rules.append((m.marker, fn))
                    else:
                        inclusion_rules.append((m.marker, fn))

                def _eligible(profile):
                    if not inclusion_rules and not exclusion_rules:
                        return True
                    for _, fn in inclusion_rules:
                        try:
                            if not fn(profile):
                                return False
                        except Exception:
                            return False
                    for _, fn in exclusion_rules:
                        try:
                            if fn(profile):
                                return False
                        except Exception:
                            pass
                    return True

                # Score patients
                n_responder_enrolled = 0
                n_nonresponder_enrolled = 0
                n_responder_excluded = 0
                n_nonresponder_excluded = 0
                total_scored = 0

                for i, pid in enumerate(dcna_patients):
                    ei = expr_idx.get(pid)
                    if ei is None:
                        continue
                    dcna_v = float(dcna_data[dcna_key][i])
                    if target_genes_in_expr:
                        vals = [float(expr_data[g][ei]) for g in target_genes_in_expr if g in expr_data]
                        expr_v = float(np.mean(vals)) if vals else 0.0
                    else:
                        expr_v = 0.0

                    responder = bool(dcna_v > learned_threshold and expr_v > expression_threshold)
                    profile = patients_bio.get(pid) or {}
                    eligible = _eligible(profile)
                    total_scored += 1

                    if eligible and responder:
                        n_responder_enrolled += 1
                    elif eligible and not responder:
                        n_nonresponder_enrolled += 1
                    elif not eligible and responder:
                        n_responder_excluded += 1
                    else:
                        n_nonresponder_excluded += 1

                total_responders = n_responder_enrolled + n_responder_excluded
                pct_recovered = (n_responder_excluded / total_responders * 100.0) if total_responders > 0 else 0.0
                # Fold change: SATGBM total responders vs trial-eligible responders
                fold_change = (total_responders / n_responder_enrolled) if n_responder_enrolled > 0 else None

                enrolled = n_responder_enrolled + n_nonresponder_enrolled
                left_rate = (n_responder_enrolled / enrolled) if enrolled else 0.0
                right_rate = (total_responders / total_scored) if total_scored else 0.0

                # ── Persist to DB ──
                _upsert_metric(
                    db,
                    trial_nct_id=nct_id,
                    intervention_id=intervention_id,
                    moa_category=moa_key,
                    drug_name=drug_name,
                    learned_threshold=learned_threshold,
                    total_scored=total_scored,
                    enrolled=enrolled,
                    responders_enrolled=n_responder_enrolled,
                    responders_excluded=n_responder_excluded,
                    total_responders=total_responders,
                    n_biomarker_rules=len(inclusion_rules) + len(exclusion_rules),
                    pct_recovered=round(pct_recovered, 2),
                    fold_change=None if fold_change is None else round(fold_change, 3),
                    trial_predicted_rr=round(left_rate, 4),
                    satgbm_predicted_rr=round(right_rate, 4),
                )
                metrics_written += 1

                if metrics_written % 50 == 0:
                    db.commit()

                fold_str = f"{fold_change:.2f}" if fold_change is not None else "N/A"
                print(f"  [{combo_idx}/{total_combos}] {nct_id} + {drug_name}: "
                      f"recovered={pct_recovered:.1f}% "
                      f"({n_responder_excluded}/{total_responders}), "
                      f"fold_change={fold_str} "
                      f"(enrolled_resp={n_responder_enrolled}), "
                      f"rules={len(inclusion_rules)}i+{len(exclusion_rules)}e")

            except Exception as e:
                print(f"  [{combo_idx}/{total_combos}] {nct_id} + {drug_name}: ERROR - {e}")
                db.rollback()
                continue

        # Commit after each MOA to minimise data loss if crash
        db.commit()

    # Final commit
    db.commit()

    # ── Summary from DB ──
    print("\n" + "=" * 80)
    print("OVERALL SUMMARY (from DB)")
    print("=" * 80)

    all_metrics = db.query(TrialSATGBMMetric).all()
    print(f"Total metrics rows in DB: {len(all_metrics)}")

    if all_metrics:
        all_pcts = [m.pct_responders_recovered for m in all_metrics]
        all_folds = [m.fold_change for m in all_metrics if m.fold_change is not None]

        print(f"\nPercentage of predicted responders recovered:")
        print(f"  Min:    {min(all_pcts):.1f}%")
        print(f"  Q1:     {np.percentile(all_pcts, 25):.1f}%")
        print(f"  Median: {np.median(all_pcts):.1f}%")
        print(f"  Q3:     {np.percentile(all_pcts, 75):.1f}%")
        print(f"  Max:    {max(all_pcts):.1f}%")
        print(f"  Mean:   {np.mean(all_pcts):.2f}%")

        if all_folds:
            print(f"\nFold change (SATGBM / trial-eligible responders): n={len(all_folds)} "
                  f"(of {len(all_metrics)}; rest have 0 enrolled responders → undefined)")
            print(f"  Min:    {min(all_folds):.2f}x")
            print(f"  Q1:     {np.percentile(all_folds, 25):.2f}x")
            print(f"  Median: {np.median(all_folds):.2f}x")
            print(f"  Q3:     {np.percentile(all_folds, 75):.2f}x")
            print(f"  Max:    {max(all_folds):.2f}x")
            print(f"  Mean:   {np.mean(all_folds):.2f}x")

        # Per MOA
        from collections import defaultdict as _dd
        per_moa_pct = _dd(list)
        per_moa_fold = _dd(list)
        for m in all_metrics:
            per_moa_pct[m.moa_category].append(m.pct_responders_recovered)
            if m.fold_change is not None:
                per_moa_fold[m.moa_category].append(m.fold_change)

        print("\n" + "─" * 80)
        print("PER-MOA SUMMARY")
        print("─" * 80)
        for moa in sorted(per_moa_pct.keys()):
            pcts = per_moa_pct[moa]
            folds = per_moa_fold.get(moa, [])
            line = f"  {moa} — n={len(pcts)}"
            line += f"  pct_recovered: med={np.median(pcts):.1f}% (range {min(pcts):.1f}–{max(pcts):.1f}%)"
            if folds:
                line += f"  fold: med={np.median(folds):.2f}x (range {min(folds):.2f}–{max(folds):.2f}x, n={len(folds)})"
            print(line)

    db.close()


if __name__ == "__main__":
    main()
