"""
Comprehensive analysis: Percentage of predicted responders recovered by SATGBM
for a representative sample of clinical trials across multiple MOA categories.

This script replicates the tcga_trial_comparison logic from the API endpoint
but runs it in batch mode across many trials.
"""

import sys, os, csv, json, time, traceback, sqlite3
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analysis.biomarker_extractor import extract_biomarkers
from analysis.moa_simulation import MOASimulationEngine
from config.schema import load_config
from database.engine import create_db_engine, get_session_factory
from database.models import (
    TrialRecord, InterventionRecord, MOAAnnotationRecord,
    EligibilityRecord, trial_interventions
)

# 1. Setup
config = load_config()
db_engine = create_db_engine(config.database)
SessionFactory = get_session_factory(db_engine)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def load_dcna():
    path = os.path.join(DATA_DIR, "tcga_dcna.csv")
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        patients = header[1:]
        data = {}
        for row in reader:
            drug = row[0]
            data[drug] = [float(v) if v else 0.0 for v in row[1:]]
    return patients, data


def load_expression():
    path = os.path.join(DATA_DIR, "tcga_gene_expression.csv")
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        patients = header[2:]
        data = {}
        for row in reader:
            symbol = row[1] or row[0]
            data[symbol] = [float(v) if v else 0.0 for v in row[2:]]
    return patients, data


def load_patient_biomarkers():
    path = os.path.join(DATA_DIR, "tcga_patient_biomarkers.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f).get("patients", {})
    except Exception:
        return {}


def load_drug_targets():
    path = os.path.join(DATA_DIR, "drug_targets_cache.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


print("Loading data files...")
dcna_patients, dcna_data = load_dcna()
expr_patients, expr_data = load_expression()
patients_bio = load_patient_biomarkers()
drug_targets_cache = load_drug_targets()
dcna_upper = {k.upper(): k for k in dcna_data.keys()}
expr_idx = {p: i for i, p in enumerate(expr_patients)}

print(f"DCNA: {len(dcna_patients)} patients, {len(dcna_data)} drugs")
print(f"Expression: {len(expr_patients)} patients, {len(expr_data)} genes")
print(f"Biomarkers: {len(patients_bio)} patients")
print(f"Drug targets: {len(drug_targets_cache)} drugs")


# 2. Biomarker mapper (same as in trials.py)
def build_biomarker_mappers():
    def _has_nonsilent_mut(profile, gene):
        muts = (profile.get("mutations") or {}).get(gene) or []
        for m in muts:
            ct = (m.get("consequence_type") or "").lower()
            if ct and "synonymous" not in ct and "intron" not in ct and "downstream" not in ct and "upstream" not in ct and "non_coding" not in ct:
                return True
        return False

    def _has_specific_aa(profile, gene, aa_contains):
        muts = (profile.get("mutations") or {}).get(gene) or []
        return any(aa_contains in (m.get("aa_change") or "") for m in muts)

    def _cnv_is(profile, gene, change):
        return ((profile.get("cnv") or {}).get(gene) or "").lower() == change.lower()

    def _is_newly_diagnosed(profile):
        clin = profile.get("clinical") or {}
        prog = (clin.get("progression_or_recurrence") or "").lower()
        return prog in ("no", "not reported", "unknown")

    def _is_recurrent(profile):
        clin = profile.get("clinical") or {}
        prog = (clin.get("progression_or_recurrence") or "").lower()
        return "yes" in prog or "recurr" in prog

    return {
        "IDH1 mutation": lambda p: _has_nonsilent_mut(p, "IDH1"),
        "IDH1 R132H mutation": lambda p: _has_specific_aa(p, "IDH1", "R132H"),
        "IDH2 mutation": lambda p: _has_nonsilent_mut(p, "IDH2"),
        "IDH mutation": lambda p: _has_nonsilent_mut(p, "IDH1") or _has_nonsilent_mut(p, "IDH2"),
        "EGFR mutation": lambda p: _has_nonsilent_mut(p, "EGFR"),
        "EGFR amplification": lambda p: _cnv_is(p, "EGFR", "Gain"),
        "PTEN loss": lambda p: _cnv_is(p, "PTEN", "Loss"),
        "PTEN mutation": lambda p: _has_nonsilent_mut(p, "PTEN"),
        "CDKN2A deletion": lambda p: _cnv_is(p, "CDKN2A", "Loss"),
        "TERT promoter mutation": lambda p: _has_nonsilent_mut(p, "TERT"),
        "ATRX loss": lambda p: _has_nonsilent_mut(p, "ATRX"),
        "ATRX mutation": lambda p: _has_nonsilent_mut(p, "ATRX"),
        "H3K27M mutation": lambda p: _has_specific_aa(p, "H3F3A", "K27M") or _has_specific_aa(p, "HIST1H3B", "K27M"),
        "TP53 mutation": lambda p: _has_nonsilent_mut(p, "TP53"),
        "BRAF mutation": lambda p: _has_nonsilent_mut(p, "BRAF"),
        "BRAF V600E": lambda p: _has_specific_aa(p, "BRAF", "V600E"),
        "BRAF V600E mutation": lambda p: _has_specific_aa(p, "BRAF", "V600E"),
        "PIK3CA mutation": lambda p: _has_nonsilent_mut(p, "PIK3CA"),
        "NF1 mutation": lambda p: _has_nonsilent_mut(p, "NF1"),
        "MDM2 amplification": lambda p: _cnv_is(p, "MDM2", "Gain"),
        "CDK4 amplification": lambda p: _cnv_is(p, "CDK4", "Gain"),
        "PDGFRA amplification": lambda p: _cnv_is(p, "PDGFRA", "Gain"),
        "MET amplification": lambda p: _cnv_is(p, "MET", "Gain"),
        "Newly diagnosed": _is_newly_diagnosed,
        "Recurrent disease": _is_recurrent,
        "EGFRvIII": lambda p: ((p.get("clinical") or {}).get("egfrviii_status") == "yes"),
        "EGFRvIII mutation": lambda p: ((p.get("clinical") or {}).get("egfrviii_status") == "yes"),
        "EGFRvIII expression": lambda p: ((p.get("clinical") or {}).get("egfrviii_status") == "yes"),
        "EGFRvIII positive": lambda p: ((p.get("clinical") or {}).get("egfrviii_status") == "yes"),
        "1p/19q codeletion": lambda p: ((p.get("clinical") or {}).get("codeletion_1p19q") == "codeleted"),
        "1p/19q": lambda p: ((p.get("clinical") or {}).get("codeletion_1p19q") == "codeleted"),
        "IDH wild-type": lambda p: (
            (p.get("clinical") or {}).get("idh_status") == "wild-type"
            if (p.get("clinical") or {}).get("idh_status")
            else not (_has_nonsilent_mut(p, "IDH1") or _has_nonsilent_mut(p, "IDH2"))
        ),
        "MGMT methylated": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") == "methylated"),
        "MGMT promoter methylated": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") == "methylated"),
        "MGMT unmethylated": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") == "unmethylated"),
        "MGMT status known": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") in ("methylated", "unmethylated")),
        "MGMT mentioned": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") in ("methylated", "unmethylated")),
        "EGFR alteration": lambda p: _has_nonsilent_mut(p, "EGFR") or _cnv_is(p, "EGFR", "Gain"),
        "EGFR overexpression": lambda p: _cnv_is(p, "EGFR", "Gain"),
        "FGFR alteration": lambda p: (
            _has_nonsilent_mut(p, "FGFR1") or _has_nonsilent_mut(p, "FGFR2") or _has_nonsilent_mut(p, "FGFR3")
            or _cnv_is(p, "FGFR1", "Gain") or _cnv_is(p, "FGFR2", "Gain") or _cnv_is(p, "FGFR3", "Gain")
        ),
        "High TMB": lambda p: len(p.get("mutations") or {}) > 200,
        "NTRK fusion": lambda p: (
            _has_nonsilent_mut(p, "NTRK1") or _has_nonsilent_mut(p, "NTRK2") or _has_nonsilent_mut(p, "NTRK3")
        ),
        "ALK fusion": lambda p: _has_nonsilent_mut(p, "ALK"),
        "ROS1 fusion": lambda p: _has_nonsilent_mut(p, "ROS1"),
    }


mappers = build_biomarker_mappers()

# 3. Select trial candidates across MOA categories
session = SessionFactory()
conn = sqlite3.connect(os.path.join(DATA_DIR, "ct_pipeline.db"))
cur = conn.cursor()

target_moas = [
    "VEGF inhibitor", "EGFR inhibitor", "CDK4/6 inhibitor", "PARP inhibitor",
    "Immune Checkpoint inhibitor", "IDH inhibitor", "MEK inhibitor", "HDAC inhibitor",
    "PI3K inhibitor", "mTOR inhibitor", "FGFR inhibitor", "RAF inhibitor",
    "DNA Damage inhibitor", "CSF1R inhibitor", "MET inhibitor", "VEGFR inhibitor",
    "Topoisomerase inhibitor", "Tubulin inhibitor", "KIT inhibitor",
    "ABL inhibitor", "WEE1 inhibitor", "AKT inhibitor", "EZH2 inhibitor",
    "PDGFR inhibitor", "FKBP1A inhibitor",
]

trial_candidates = []
seen_nct_ids = set()

for moa in target_moas:
    cur.execute("""
        SELECT DISTINCT t.nct_id, i.name, i.id, m.moa_broad_category, m.moa_short_form,
               LENGTH(e.criteria_text) as criteria_len
        FROM trials t
        JOIN trial_interventions ti ON t.nct_id = ti.trial_nct_id
        JOIN interventions i ON ti.intervention_id = i.id
        JOIN moa_annotations m ON m.intervention_id = i.id
        JOIN eligibility e ON e.trial_nct_id = t.nct_id
        WHERE m.moa_broad_category = ?
          AND i.intervention_type IN ('DRUG', 'BIOLOGICAL', 'Drug', 'Biological', 'drug', 'biological')
          AND m.moa_short_form != ''
          AND e.criteria_text != ''
          AND LENGTH(e.criteria_text) > 100
        ORDER BY criteria_len DESC
    """, (moa,))

    rows = cur.fetchall()
    for nct_id, drug_name, iv_id, moa_broad, moa_short, crit_len in rows:
        if drug_name.upper() in dcna_upper and nct_id not in seen_nct_ids:
            trial_candidates.append({
                "nct_id": nct_id,
                "drug_name": drug_name,
                "intervention_id": iv_id,
                "moa_broad": moa_broad,
                "moa_short": moa_short,
            })
            seen_nct_ids.add(nct_id)
            break

conn.close()

print(f"\nSelected {len(trial_candidates)} unique trial-drug pairs for analysis.")
for tc in trial_candidates:
    print(f"  {tc['nct_id']} | {tc['drug_name']:<25} | {tc['moa_broad']}")

# 4. Run analysis
print("\n" + "=" * 100)
print("RUNNING MOA SIMULATIONS AND TRIAL COMPARISONS")
print("=" * 100)

moa_sim_cache = {}
sim_engine = MOASimulationEngine(n_iterations=1000, save_plots=False)

results_table = []
errors = []

for idx, tc in enumerate(trial_candidates):
    nct_id = tc["nct_id"]
    drug_name = tc["drug_name"]
    iv_id = tc["intervention_id"]
    moa_broad = tc["moa_broad"]
    moa_short = tc["moa_short"]

    print(f"\n[{idx+1}/{len(trial_candidates)}] Processing {nct_id} - {drug_name} ({moa_broad})...")
    t0 = time.time()

    try:
        # MOA category for simulation
        moa_category = f"group:{moa_broad}" if moa_broad else moa_short

        # Run or retrieve cached MOA simulation
        if moa_category not in moa_sim_cache:
            print(f"  Running MOA simulation for '{moa_category}'...")
            sim_result = sim_engine.run(moa_category, session)
            if "error" in sim_result:
                if moa_category.startswith("group:") and moa_short:
                    sim_result = sim_engine.run(moa_short, session)
                    if "error" not in sim_result:
                        moa_category = moa_short
                if "error" in sim_result:
                    errors.append((nct_id, drug_name, moa_broad, f"Sim failed: {sim_result['error']}"))
                    print(f"  ERROR: {sim_result['error']}")
                    continue
            moa_sim_cache[moa_category] = sim_result
            print(f"  Simulation done. Threshold: {sim_result.get('overall_learned_threshold', 'N/A')}")
        else:
            sim_result = moa_sim_cache[moa_category]
            print(f"  Using cached simulation.")

        learned_threshold = float(sim_result.get("overall_learned_threshold", 0))
        expression_threshold = 0.0

        # Resolve DCNA drug key
        dcna_key = None
        for cand in (drug_name,):
            if cand in dcna_data:
                dcna_key = cand
                break
            hit = dcna_upper.get(cand.upper())
            if hit:
                dcna_key = hit
                break
        if dcna_key is None:
            errors.append((nct_id, drug_name, moa_broad, "No DCNA profile"))
            print(f"  ERROR: No DCNA profile for '{drug_name}'")
            continue

        # Drug targets
        target_genes_in_expr = []
        dn_upper = drug_name.upper()
        targets_entry = drug_targets_cache.get(dn_upper) or drug_targets_cache.get(drug_name)
        if targets_entry:
            t_list = targets_entry if isinstance(targets_entry, list) else targets_entry.get("targets", [])
            for t in t_list:
                gs = t.get("gene_symbol", "")
                if gs and gs in expr_data:
                    target_genes_in_expr.append(gs)

        # Extract biomarkers
        trial_row = session.get(TrialRecord, nct_id)
        elig = session.query(EligibilityRecord).filter_by(trial_nct_id=nct_id).first()
        elig_criteria = elig.criteria_text if elig and elig.criteria_text else ""

        elig_text = "\n".join([
            elig_criteria,
            trial_row.brief_summary or "",
            trial_row.detailed_description or "",
        ]).strip()
        elig_end_offset = len(elig_criteria) if elig_criteria else None
        markers = extract_biomarkers(elig_text, eligibility_end_offset=elig_end_offset)

        # Build inclusion/exclusion rules
        inclusion_rules = []
        exclusion_rules = []
        mapped_markers_list = []
        unmapped_markers_list = []
        seen_marker_keys = set()
        for m in markers:
            name = m.marker
            ctx = m.context
            key = (name, ctx)
            if key in seen_marker_keys:
                continue
            seen_marker_keys.add(key)
            fn = mappers.get(name)
            if fn is None:
                unmapped_markers_list.append(f"{name} ({ctx})")
                continue
            mapped_markers_list.append(f"{name} ({ctx})")
            if ctx == "exclusion":
                exclusion_rules.append((name, fn))
            else:
                inclusion_rules.append((name, fn))

        def eligible_by_criteria(profile):
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

        # Per-patient scoring
        n_total = 0
        n_predicted_responders = 0
        n_responder_enrolled = 0
        n_responder_excluded = 0
        n_eligible = 0

        for i, pid in enumerate(dcna_patients):
            ei = expr_idx.get(pid)
            if ei is None:
                continue
            n_total += 1

            dcna_v = float(dcna_data[dcna_key][i])
            if target_genes_in_expr:
                vals = [float(expr_data[g][ei]) for g in target_genes_in_expr if g in expr_data]
                expr_v = float(np.mean(vals)) if vals else 0.0
            else:
                expr_v = 0.0

            responder = bool(dcna_v > learned_threshold and expr_v > expression_threshold)
            profile = patients_bio.get(pid) or {}
            eligible = eligible_by_criteria(profile)

            if eligible:
                n_eligible += 1
            if responder:
                n_predicted_responders += 1
                if eligible:
                    n_responder_enrolled += 1
                else:
                    n_responder_excluded += 1

        pct_recovered = (n_responder_excluded / n_predicted_responders * 100) if n_predicted_responders > 0 else 0.0

        elapsed = time.time() - t0
        print(f"  Patients scored: {n_total}")
        print(f"  Predicted responders: {n_predicted_responders}")
        print(f"  Trial-eligible predicted responders: {n_responder_enrolled}")
        print(f"  Missed by trial criteria: {n_responder_excluded}")
        print(f"  % Recovered: {pct_recovered:.1f}%")
        print(f"  Mapped biomarkers: {mapped_markers_list}")
        print(f"  DCNA threshold: {learned_threshold:.4f}")
        print(f"  Time: {elapsed:.1f}s")

        results_table.append({
            "nct_id": nct_id,
            "drug": drug_name,
            "moa_broad": moa_broad,
            "moa_short": moa_short,
            "dcna_threshold": round(learned_threshold, 4),
            "n_total_patients": n_total,
            "n_predicted_responders": n_predicted_responders,
            "n_eligible": n_eligible,
            "n_responder_enrolled": n_responder_enrolled,
            "n_responder_excluded": n_responder_excluded,
            "pct_recovered": round(pct_recovered, 1),
            "n_mapped_biomarkers": len(mapped_markers_list),
            "mapped_biomarkers": "; ".join(mapped_markers_list),
            "n_unmapped_biomarkers": len(unmapped_markers_list),
        })

    except Exception as e:
        elapsed = time.time() - t0
        errors.append((nct_id, drug_name, moa_broad, str(e)))
        print(f"  ERROR ({elapsed:.1f}s): {e}")
        traceback.print_exc()

session.close()

# 5. Print final results
print("\n\n" + "=" * 140)
print("RESULTS: Percentage of Predicted Responders Recovered by SATGBM")
print("=" * 140)
hdr = f"{'NCT ID':<18} {'Drug':<22} {'MOA Category':<28} {'Thresh':>7} {'#Pred':>6} {'#EligR':>7} {'#Missed':>8} {'%Recov':>7} {'#Biom':>6}"
print(hdr)
print("-" * 140)

for r in sorted(results_table, key=lambda x: x["pct_recovered"], reverse=True):
    line = (
        f"{r['nct_id']:<18} "
        f"{r['drug'][:21]:<22} "
        f"{r['moa_broad'][:27]:<28} "
        f"{r['dcna_threshold']:>7.4f} "
        f"{r['n_predicted_responders']:>6} "
        f"{r['n_responder_enrolled']:>7} "
        f"{r['n_responder_excluded']:>8} "
        f"{r['pct_recovered']:>6.1f}% "
        f"{r['n_mapped_biomarkers']:>6}"
    )
    print(line)

print("-" * 140)

if results_table:
    pct_values = [r["pct_recovered"] for r in results_table]
    print(f"\nSummary across {len(results_table)} trials:")
    print(f"  Min % recovered:    {min(pct_values):.1f}%")
    print(f"  Max % recovered:    {max(pct_values):.1f}%")
    print(f"  Mean % recovered:   {np.mean(pct_values):.1f}%")
    print(f"  Median % recovered: {np.median(pct_values):.1f}%")
    print(f"  Std dev:            {np.std(pct_values):.1f}%")

    n_zero = sum(1 for v in pct_values if v == 0.0)
    n_low = sum(1 for v in pct_values if 0 < v <= 20)
    n_mid = sum(1 for v in pct_values if 20 < v <= 50)
    n_high = sum(1 for v in pct_values if v > 50)
    print(f"\n  Distribution:")
    print(f"    0%:         {n_zero} trials (no biomarker filtering / all predicted responders eligible)")
    print(f"    1-20%:      {n_low} trials")
    print(f"    21-50%:     {n_mid} trials")
    print(f"    >50%:       {n_high} trials")

if errors:
    print(f"\nErrors ({len(errors)}):")
    for nct_id, drug, moa, err in errors:
        print(f"  {nct_id} | {drug} | {moa} : {err[:120]}")

print("\n\nDETAILED BIOMARKER INFORMATION:")
print("=" * 140)
for r in sorted(results_table, key=lambda x: x["pct_recovered"], reverse=True):
    print(f"  {r['nct_id']} ({r['drug']}): {r['mapped_biomarkers'] or '(none mapped)'}")
    if r["n_unmapped_biomarkers"] > 0:
        print(f"    + {r['n_unmapped_biomarkers']} unmapped biomarker(s)")
