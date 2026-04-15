"""Simulation endpoints: run in-silico trial simulations."""

import logging
import threading

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.dependencies import get_db, get_engine, get_session_factory
from api.schemas import SimulationRequest, SimulationResponse

router = APIRouter(prefix="/simulation", tags=["simulation"])

logger = logging.getLogger(__name__)

# In-memory store for MOA simulation progress and results
_moa_simulations: dict[str, dict] = {}

# Cached heavy engine (loads TCGA data once) for responder-similarity endpoints
_cached_engine = None
_cached_engine_lock = threading.Lock()


def _get_cached_engine():
    global _cached_engine
    with _cached_engine_lock:
        if _cached_engine is None:
            from analysis.moa_simulation import MOASimulationEngine
            _cached_engine = MOASimulationEngine(n_iterations=10, save_plots=False)
        return _cached_engine


def _load_sim_summary(sim_id: str) -> dict:
    import json
    import os
    path = os.path.join("data", "simulations", sim_id, "summary.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Simulation {sim_id} summary not found")
    with open(path) as f:
        return json.load(f)


# ── Existing single-trial simulation ─────────────────────────────────────


@router.post("/run", response_model=SimulationResponse)
def run_simulation(req: SimulationRequest, db: Session = Depends(get_db)):
    """Run an in-silico trial simulation.

    Attempts to use TCGA data if available; otherwise falls back to a
    simple statistical simulation based on the requested parameters.
    """
    from database.queries import get_trial

    trial = get_trial(db, req.trial_nct_id)
    if trial is None:
        raise HTTPException(status_code=404, detail=f"Trial {req.trial_nct_id} not found")

    # Try full TCGA-based simulation first
    try:
        from analysis.moa_simulation import extract_response_rate
        from analysis.response_model import HistoricalResponseModel
        from analysis.simulation import InSilicoSimulator
        from connectors.tcga import TCGAConnector

        tcga = TCGAConnector()
        cohort = tcga.get_cohort(max_cases=req.max_cohort)

        if cohort:
            criteria_text = trial.eligibility.criteria_text if trial.eligibility else ""
            min_age = trial.eligibility.min_age if trial.eligibility else ""
            max_age = trial.eligibility.max_age if trial.eligibility else ""
            sex = trial.eligibility.sex if trial.eligibility else "ALL"

            # Seed the response model with the trial's actual reported response
            # rate (using the combined CR+PR aggregation when applicable) so the
            # simulation reflects what the trial actually observed rather than a
            # hard-coded default. Falls back to the request value if unavailable.
            import json as _json
            best_rr = None
            for outcome in (trial.outcomes or []):
                rows = [r.model_dump() if hasattr(r, "model_dump") else dict(r)
                        for r in (outcome.results or [])]
                if not rows:
                    continue
                rr = extract_response_rate(_json.dumps(rows), outcome.measure)
                if rr is not None and 0 < rr < 1:
                    best_rr = rr
                    break
            seeded_rate = best_rr if best_rr is not None else req.response_rate
            response_model = HistoricalResponseModel(response_rate=seeded_rate)
            simulator = InSilicoSimulator(response_model=response_model)
            result = simulator.run_simulation(
                trial_nct_id=req.trial_nct_id,
                criteria_text=criteria_text,
                cohort=cohort,
                min_age_str=min_age,
                max_age_str=max_age,
                sex=sex,
            )
            summary = result.summary()
            return SimulationResponse(**summary)
    except Exception as e:
        logger.info("TCGA simulation unavailable (%s), using statistical fallback", e)

    # Statistical fallback simulation
    rng = np.random.default_rng(42)
    total_cohort = req.max_cohort
    eligibility_rate = rng.uniform(0.3, 0.7)
    eligible_count = max(1, int(total_cohort * eligibility_rate))
    responses = rng.random(eligible_count) < req.response_rate
    responder_count = int(responses.sum())
    actual_rate = responder_count / eligible_count if eligible_count > 0 else 0.0
    mean_magnitude = float(rng.uniform(0.3, 0.8)) if responder_count > 0 else 0.0

    return SimulationResponse(
        trial_nct_id=req.trial_nct_id,
        total_cohort=total_cohort,
        eligible_count=eligible_count,
        responder_count=responder_count,
        response_rate=round(actual_rate, 4),
        mean_magnitude=round(mean_magnitude, 4),
    )


# ── MOA-based simulation ─────────────────────────────────────────────────


class MOASimulationRequest(BaseModel):
    moa_category: str
    n_iterations: int = Field(default=1000, ge=10, le=5000)
    save_plots: bool = True


class MOASimulationStartResponse(BaseModel):
    sim_id: str
    status: str
    message: str


@router.post("/moa-run", response_model=MOASimulationStartResponse)
def start_moa_simulation(req: MOASimulationRequest):
    """Start an MOA-based simulation in a background thread.

    Returns a simulation ID to poll for progress.
    """
    import uuid

    sim_id = str(uuid.uuid4())[:8]
    _moa_simulations[sim_id] = {
        "status": "running",
        "stage": "initializing",
        "detail": "",
        "progress_pct": 0,
        "result": None,
        "error": None,
    }

    def run_simulation():
        try:
            from analysis.moa_simulation import MOASimulationEngine

            engine = MOASimulationEngine(
                n_iterations=req.n_iterations,
                save_plots=req.save_plots,
            )

            def progress_cb(stage, detail, pct):
                _moa_simulations[sim_id]["stage"] = stage
                _moa_simulations[sim_id]["detail"] = detail
                _moa_simulations[sim_id]["progress_pct"] = pct

            # Create a new DB session for the background thread
            db_engine = get_engine()
            sf = get_session_factory(db_engine)
            db = sf()
            try:
                result = engine.run(req.moa_category, db, progress_callback=progress_cb)
                _moa_simulations[sim_id]["result"] = result
                if "error" in result:
                    _moa_simulations[sim_id]["status"] = "error"
                    _moa_simulations[sim_id]["error"] = result["error"]
                else:
                    _moa_simulations[sim_id]["status"] = "complete"
            finally:
                db.close()

        except Exception as e:
            logger.exception("MOA simulation %s failed", sim_id)
            _moa_simulations[sim_id]["status"] = "error"
            _moa_simulations[sim_id]["error"] = str(e)

    thread = threading.Thread(target=run_simulation, daemon=True)
    thread.start()

    return MOASimulationStartResponse(
        sim_id=sim_id,
        status="running",
        message=f"Simulation started for MOA '{req.moa_category}' with {req.n_iterations} iterations",
    )


@router.get("/moa-status/{sim_id}")
def get_moa_simulation_status(sim_id: str):
    """Poll for MOA simulation progress."""
    if sim_id not in _moa_simulations:
        raise HTTPException(status_code=404, detail=f"Simulation {sim_id} not found")

    sim = _moa_simulations[sim_id]
    response = {
        "sim_id": sim_id,
        "status": sim["status"],
        "stage": sim["stage"],
        "detail": sim["detail"],
        "progress_pct": sim["progress_pct"],
    }

    if sim["status"] == "complete" and sim["result"]:
        response["result"] = sim["result"]
    elif sim["status"] == "error":
        response["error"] = sim["error"]
        if sim["result"]:
            response["partial_result"] = {
                k: v for k, v in sim["result"].items()
                if k in ("drugs_found", "trials_found", "sim_id")
            }

    return response


@router.get("/moa-list")
def list_moa_simulations():
    """List all MOA simulations and their statuses."""
    return [
        {
            "sim_id": sid,
            "status": sim["status"],
            "stage": sim["stage"],
            "progress_pct": sim["progress_pct"],
            "moa_category": sim.get("result", {}).get("moa_category", "") if sim.get("result") else "",
        }
        for sid, sim in _moa_simulations.items()
    ]


@router.get("/moa-responder-similarity/{sim_id}")
def get_responder_similarity(sim_id: str, rule: str = "majority", q_cutoff: float = 0.1):
    """Compute responder-similarity analysis for a completed MOA simulation."""
    import math

    from fastapi.responses import JSONResponse

    from analysis.responder_similarity import compute_responder_similarity

    summary = _load_sim_summary(sim_id)
    matrix = summary.get("responder_classification_matrix")
    if not matrix:
        raise HTTPException(status_code=400, detail="Simulation has no responder classification matrix")
    if rule not in ("majority", "any"):
        raise HTTPException(status_code=400, detail="rule must be 'majority' or 'any'")

    engine = _get_cached_engine()
    result = compute_responder_similarity(engine, matrix, rule=rule, q_cutoff=q_cutoff)

    # Sanitize NaN/Inf for JSON
    def _clean(o):
        if isinstance(o, float):
            if math.isnan(o) or math.isinf(o):
                return None
            return o
        if isinstance(o, dict):
            return {k: _clean(v) for k, v in o.items()}
        if isinstance(o, list):
            return [_clean(v) for v in o]
        return o

    return JSONResponse(content=_clean(result))


@router.get("/moa-responder-similarity/{sim_id}/download")
def download_responder_similarity(sim_id: str, rule: str = "majority", q_cutoff: float = 0.1):
    """Download full responder-similarity feature table as CSV with provenance header."""
    from fastapi.responses import Response

    from analysis.responder_similarity import compute_responder_similarity, features_to_csv
    from api.provenance import build_export_metadata, csv_header_lines, provenance_filename

    summary = _load_sim_summary(sim_id)
    matrix = summary.get("responder_classification_matrix")
    if not matrix:
        raise HTTPException(status_code=400, detail="Simulation has no responder classification matrix")

    engine = _get_cached_engine()
    result = compute_responder_similarity(engine, matrix, rule=rule, q_cutoff=q_cutoff)
    csv_text = features_to_csv(result["features"])

    meta = build_export_metadata(
        endpoint="/simulation/moa-responder-similarity/{sim_id}/download",
        params={"sim_id": sim_id, "rule": rule, "q_cutoff": q_cutoff},
        row_count=csv_text.count("\n") - 1 if csv_text else 0,
    )
    filename = provenance_filename(f"responder_similarity_{sim_id}_{rule}", "csv", meta)
    return Response(
        content=csv_header_lines(meta) + csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Oracle-Build-Id": meta["build_id"],
        },
    )


@router.get("/moa-categories")
def get_available_moa_categories(db: Session = Depends(get_db)):
    """Get MOA categories that have enough trials for simulation.

    Returns both individual (specific) categories and grouped (broad)
    categories.  Grouped categories combine related MOA short-forms
    under a common family name (e.g. "PARP inhibitor" groups PARP1,
    PARP2, etc.) and include the list of drug names in brackets.

    Each item has:
      - category:    display name (e.g. "PARP inhibitor [Olaparib, Niraparib, …]")
      - value:       the string sent back to the simulation endpoint
      - drug_count:  number of unique drugs
      - is_group:    True for broad family groups, False for individual MOAs
      - drugs:       list of unique drug names in the category
      - members:     (groups only) list of specific MOA short-forms included
    """
    from collections import defaultdict

    from database.models import InterventionRecord, MOAAnnotationRecord

    # ── Fetch all (broad, short, drug_name) tuples ──
    rows = (
        db.query(
            MOAAnnotationRecord.moa_broad_category,
            MOAAnnotationRecord.moa_short_form,
            InterventionRecord.name,
        )
        .join(InterventionRecord)
        .filter(MOAAnnotationRecord.moa_short_form.isnot(None))
        .filter(MOAAnnotationRecord.moa_short_form != "")
        .all()
    )

    exclude = {
        "Unknown", "Non-Drug Intervention", "Diagnostic agent",
        "Somatic cell supplemental therapy",
    }

    # Normalize broad categories that are aliases for the same family.
    # Some DB entries (e.g. "PARP 1, 2 and 3 inhibitor") have their own
    # broad_category instead of the canonical family name.
    _BROAD_ALIASES: dict[str, str] = {
        "PARP 1, 2 and 3 inhibitor": "PARP inhibitor",
        "DNA Damage cross-linking agent": "DNA Damage inhibitor",
        "DNA Damage disrupting agent": "DNA Damage inhibitor",
        "Immune Checkpoint antagonist": "Immune Checkpoint inhibitor",
        "Immune Checkpoint other": "Immune Checkpoint inhibitor",
        "PDGFR antagonist": "PDGFR inhibitor",
    }

    # ── Build per-short-form data ──
    short_drugs: dict[str, set[str]] = defaultdict(set)  # short_form -> drug names
    broad_to_shorts: dict[str, set[str]] = defaultdict(set)  # broad -> short_forms
    broad_drugs: dict[str, set[str]] = defaultdict(set)  # broad -> drug names

    for broad, short, drug_name in rows:
        if short in exclude:
            continue
        short_drugs[short].add(drug_name)
        # Normalize broad category through alias table
        norm_broad = _BROAD_ALIASES.get(broad, broad) if broad else broad
        if norm_broad and norm_broad not in exclude:
            broad_to_shorts[norm_broad].add(short)
            broad_drugs[norm_broad].add(drug_name)

    # ── Resolve aliases & deduplicate drug names ──
    from moa_classification.drug_aliases import resolve_drug_list

    def _dedup_drugs(names: set[str]) -> list[str]:
        """Resolve code names → generic and deduplicate (case-insensitive)."""
        return resolve_drug_list(names)

    results: list[dict] = []

    # ── 1) Grouped (broad) categories ──
    # Only create a group when the broad category actually merges 2+
    # short-forms, OR when the single member's short_form differs from
    # the broad name (e.g. broad="HER2 inhibitor", short="ERBB2 inhibitor").
    emitted_shorts: set[str] = set()  # track shorts consumed by groups

    for broad, shorts in broad_to_shorts.items():
        if broad in exclude:
            continue
        # Decide whether to create a group entry
        is_true_group = len(shorts) > 1 or (len(shorts) == 1 and next(iter(shorts)) != broad)
        if not is_true_group:
            continue

        drugs = _dedup_drugs(broad_drugs[broad])
        if not drugs:
            continue
        drug_label = ", ".join(drugs[:6])
        if len(drugs) > 6:
            drug_label += f", +{len(drugs) - 6} more"

        results.append({
            "category": f"{broad} [{drug_label}]",
            "value": f"group:{broad}",
            "drug_count": len(drugs),
            "is_group": True,
            "drugs": drugs,
            "members": sorted(shorts),
        })
        emitted_shorts.update(shorts)

    # ── 2) Individual (specific) categories ──
    for short, drug_set in short_drugs.items():
        if short in exclude:
            continue
        drugs = _dedup_drugs(drug_set)
        if not drugs:
            continue

        entry: dict = {
            "category": short,
            "value": short,
            "drug_count": len(drugs),
            "is_group": False,
            "drugs": drugs,
            "members": [],
        }
        # If this short was consumed by a group, mark it so the UI
        # can still show it individually but knows a group exists.
        if short in emitted_shorts:
            entry["part_of_group"] = True
        results.append(entry)

    # Sort: groups first (alphabetical), then individuals (by drug count desc)
    results.sort(key=lambda r: (0 if r["is_group"] else 1, -r["drug_count"], r.get("value", "")))
    return results


# ── Screening impact (biomarker vs recruitment criteria) ─────────────────


@router.get("/screening-impact")
def screening_impact(moas: str = "EGFR inhibitor,PARP inhibitor,VEGFR inhibitor"):
    """Find trials whose observed response rate would have been improved if the
    cohort had been screened on learned DCNA threshold + expression > 0 instead
    of the recruitment criteria that were actually applied.

    For each MOA, we scan the most recent completed simulation on disk and
    return every testing-trial arm that (a) had non-empty recruitment criteria
    and (b) shows a positive lift (screened RR > observed RR).
    """
    import json
    import os

    wanted = [m.strip() for m in moas.split(",") if m.strip()]
    base = os.path.join("data", "simulations")
    if not os.path.isdir(base):
        return {"results": [], "warning": "No simulations directory found."}

    # Most recent sim per MOA
    latest: dict[str, tuple[float, str, dict]] = {}
    for sid in os.listdir(base):
        path = os.path.join(base, sid, "summary.json")
        if not os.path.isfile(path):
            continue
        try:
            with open(path) as f:
                summary = json.load(f)
        except Exception:
            continue
        moa = (summary.get("moa_category") or "").strip()
        if moa not in wanted:
            continue
        mtime = os.path.getmtime(path)
        if moa not in latest or mtime > latest[moa][0]:
            latest[moa] = (mtime, sid, summary)

    results = []
    for moa, (_mtime, sid, summary) in latest.items():
        threshold = summary.get("overall_learned_threshold")
        for t in (summary.get("testing_trials") or []):
            actual = t.get("actual_response_rate")
            pred = t.get("mean_predicted_rate")
            crit = t.get("molecular_criteria") or []
            if actual is None or pred is None:
                continue
            if not crit:
                continue
            lift_pp = (pred - actual) * 100.0
            if lift_pp <= 0:
                continue
            results.append({
                "moa_category": moa,
                "sim_id": sid,
                "nct_id": t.get("nct_id"),
                "title": t.get("title"),
                "arm_group": t.get("arm_group"),
                "drugs": t.get("drugs") or [],
                "enrollment": t.get("enrollment"),
                "recruitment_criteria": crit,
                "observed_rate": float(actual),
                "screened_rate": float(pred),
                "lift_pp": round(float(lift_pp), 2),
                "learned_threshold": threshold,
                "eligible_patients": t.get("eligible_patients"),
                "cohort_size": t.get("cohort_size"),
            })

    results.sort(key=lambda r: -r["lift_pp"])
    return {
        "results": results,
        "moas_searched": wanted,
        "moas_found": list(latest.keys()),
        "threshold_by_moa": {m: s[2].get("overall_learned_threshold") for m, s in latest.items()},
    }


# ── Proposed-drug simulation ─────────────────────────────────────────────


class CriterionEntry(BaseModel):
    text: str = ""
    type: str = Field("inclusion", description="'inclusion' or 'exclusion'")


class ProposedDrugRequest(BaseModel):
    sim_id: str = Field(..., description="Completed MOA sim to borrow the learned DCNA threshold from")
    drug_name: str = Field(..., description="Proposed drug (must have DCNA data)")
    eligibility_criteria: list[str] = Field(default_factory=list, description="Legacy: plain text criteria (treated as inclusion)")
    eligibility_criteria_v2: list[CriterionEntry] = Field(default_factory=list, description="Criteria with inclusion/exclusion type")
    criteria_logic: str = Field("all", description="'all' (AND), 'any' (OR), or 'at_least'")
    criteria_min_count: int = Field(1, ge=1, description="Min inclusion criteria to satisfy when logic='at_least'")
    trial_size: int = Field(..., ge=5, le=2000)
    n_iterations: int = Field(1000, ge=10, le=5000)


@router.post("/proposed-drug")
def simulate_proposed_drug(req: ProposedDrugRequest):
    """Run a 1000-iteration in-silico simulation for a proposed new drug in an
    MOA family, using the learned DCNA threshold from a completed MOA run.

    Returns:
      - predicted_rates: list of per-iteration predicted response rates
      - patients: per-patient scatter data (dcna, expr, responder, mgmt_status)
    """
    import numpy as np

    from analysis.moa_simulation import TrialInfo

    # 1) Pull learned threshold from the referenced MOA summary
    summary = _load_sim_summary(req.sim_id)
    learned_threshold = summary.get("overall_learned_threshold")
    if learned_threshold is None:
        raise HTTPException(status_code=400, detail="Referenced simulation has no learned DCNA threshold")

    engine = _get_cached_engine()

    # 2) Resolve the proposed drug against DCNA data (case-insensitive)
    dcna_upper = {d.upper(): d for d in engine.dcna_drugs_list}
    key = dcna_upper.get(req.drug_name.strip().upper())
    if key is None:
        raise HTTPException(
            status_code=400,
            detail=f"Drug '{req.drug_name}' has no DCNA profile in the TCGA cache. "
                   f"Try one of the drugs available in your MOA simulation.",
        )

    # 3) Per-criterion eligibility.
    #    v2 criteria carry inclusion/exclusion types; legacy plain-text are
    #    treated as inclusion.  Inclusion criteria are INTERSECTED (patient
    #    must match ALL), exclusion criteria are SUBTRACTED (patient must
    #    match NONE).  Per-criterion sets are tracked so the scatter plot can
    #    size-code patients by which criteria they satisfy.
    crit_entries: list[dict] = []  # {"text": str, "type": "inclusion"|"exclusion"}
    if req.eligibility_criteria_v2:
        for ce in req.eligibility_criteria_v2:
            t = ce.text.strip()
            if t:
                crit_entries.append({"text": t, "type": ce.type or "inclusion"})
    else:
        for c in (req.eligibility_criteria or []):
            t = c.strip()
            if t:
                crit_entries.append({"text": t, "type": "inclusion"})

    raw_criteria = [e["text"] for e in crit_entries]
    crit_types = [e["type"] for e in crit_entries]

    # Evaluate each criterion independently against the full TCGA cohort
    per_crit_sets: list[set[str]] = []
    for entry in crit_entries:
        tinfo = TrialInfo(
            nct_id="PROPOSED",
            title=f"Proposed: {key}",
            enrollment=req.trial_size,
            response_rate=None,
            drug_names=[key],
            dcna_drug_names=[key],
            criteria_text=entry["text"],
        )
        per_crit_sets.append(set(engine.get_eligible_patients(tinfo)))

    if not crit_entries:
        # No criteria supplied — use entire common-patient cohort
        tinfo = TrialInfo(
            nct_id="PROPOSED",
            title=f"Proposed: {key}",
            enrollment=req.trial_size,
            response_rate=None,
            drug_names=[key],
            dcna_drug_names=[key],
            criteria_text="",
        )
        per_crit_sets.append(set(engine.get_eligible_patients(tinfo)))
        raw_criteria = [""]
        crit_types = ["inclusion"]

    # Apply criteria logic: all (AND), any (OR), at_least (≥ N)
    inclusion_sets = [s for s, t in zip(per_crit_sets, crit_types) if t == "inclusion"]
    exclusion_sets = [s for s, t in zip(per_crit_sets, crit_types) if t == "exclusion"]

    # Full cohort (used as baseline when no inclusion criteria exist, and
    # also as the pool for returning ALL patients in the scatter plot)
    tinfo_all = TrialInfo(
        nct_id="PROPOSED", title=f"Proposed: {key}", enrollment=req.trial_size,
        response_rate=None, drug_names=[key], dcna_drug_names=[key], criteria_text="",
    )
    all_patients_set = set(engine.get_eligible_patients(tinfo_all))

    logic = (req.criteria_logic or "all").lower()
    if inclusion_sets:
        if logic == "any":
            eligible_set = set.union(*inclusion_sets)
        elif logic == "at_least":
            from collections import Counter
            counts: Counter = Counter()
            for s in inclusion_sets:
                counts.update(s)
            min_n = max(1, min(req.criteria_min_count, len(inclusion_sets)))
            eligible_set = {p for p, c in counts.items() if c >= min_n}
        else:  # "all" — intersect
            eligible_set = set.intersection(*inclusion_sets)
    else:
        eligible_set = set(all_patients_set)

    for exc in exclusion_sets:
        eligible_set -= exc

    eligible = sorted(eligible_set)
    if len(eligible) < 5:
        raise HTTPException(
            status_code=400,
            detail=f"Only {len(eligible)} TCGA patients match the supplied eligibility criteria.",
        )
    # Build synthetic TrialInfo for iteration sampling (no filtering needed since
    # we already computed the union cohort explicitly).
    trial = TrialInfo(
        nct_id="PROPOSED",
        title=f"Proposed: {key}",
        enrollment=req.trial_size,
        response_rate=None,
        drug_names=[key],
        dcna_drug_names=[key],
        criteria_text="",
    )

    # 4) Run N iterations at the learned threshold
    engine.n_iterations = int(req.n_iterations)
    result = engine.simulate_trial_iterations(
        trial=trial,
        eligible_patients=eligible,
        sim_dir="",
        is_training=False,
        learned_threshold=float(learned_threshold),
    )
    predicted_rates = result.get("predicted_rates", [])

    # 5) Per-patient scatter: score EVERY common TCGA patient once,
    #    classify responder vs non-responder at the learned threshold,
    #    tag eligibility, and MGMT methylation status from expression.
    dcna_idx = {p: i for i, p in enumerate(engine.dcna_patients)}
    expr_idx = {p: i for i, p in enumerate(engine.expr_patients)}

    # Gene-target keys for this drug (used to compute avg expression)
    expr_keys_upper = {k.upper(): k for k in engine.expr_data}
    gene_keys: set[str] = set()
    entry = engine.drug_targets.get(key, {})
    for t in entry.get("targets", []):
        g = (t.get("gene_symbol") or "").upper()
        if g in expr_keys_upper:
            gene_keys.add(expr_keys_upper[g])

    # MGMT median for methylation-status proxy
    mgmt_series = engine.expr_data.get("MGMT")
    mgmt_median = float(np.median(mgmt_series)) if mgmt_series else None

    patients_out = []
    for pid in sorted(all_patients_set):
        di = dcna_idx.get(pid)
        ei = expr_idx.get(pid)
        if di is None or ei is None:
            continue
        dcna_v = float(engine.dcna_data[key][di])
        if gene_keys:
            expr_v = float(np.mean([engine.expr_data[g][ei] for g in gene_keys]))
        else:
            expr_v = 0.0
        responder = bool(dcna_v > learned_threshold and expr_v > 0)
        mgmt_status = None
        if mgmt_median is not None and "MGMT" in engine.expr_data:
            m = engine.expr_data["MGMT"][ei]
            mgmt_status = "METHYLATED" if m <= mgmt_median else "UNMETHYLATED"
        matched_criteria = [i for i, s in enumerate(per_crit_sets) if pid in s]
        patients_out.append({
            "patient_id": pid,
            "dcna": dcna_v,
            "expr": expr_v,
            "responder": responder,
            "eligible": pid in eligible_set,
            "mgmt_status": mgmt_status,
            "matched_criteria": matched_criteria,
        })

    return {
        "drug_name": key,
        "moa_category": summary.get("moa_category"),
        "learned_threshold": float(learned_threshold),
        "trial_size": req.trial_size,
        "n_iterations": int(req.n_iterations),
        "eligible_count": len(eligible),
        "predicted_rates": [float(x) for x in predicted_rates],
        "mean_predicted_rate": float(np.mean(predicted_rates)) if predicted_rates else 0.0,
        "patients": patients_out,
        "criteria": raw_criteria,
        "criteria_types": crit_types,
        "criteria_logic": logic,
        "criteria_min_count": req.criteria_min_count if logic == "at_least" else None,
        "total_patients": len(patients_out),
    }


# ── TAM estimate (predicted responders across MOAs) ─────────────────────


class TAMRequest(BaseModel):
    moas: list[str] = Field(..., description="MOA category names (no 'group:' prefix)")
    us_patients: int = Field(..., ge=0)
    ww_patients: int = Field(..., ge=0)
    rule: str = Field("majority", description="'majority' or 'any' (only used when top_n=0)")
    top_n: int = Field(
        0,
        ge=0,
        description=(
            "If > 0, select the top-N drugs per MOA by response rate and union"
            " their responder sets for the MOA total. If 0, use the"
            " classification-matrix aggregation rule across all trials."
        ),
    )


@router.post("/tam-estimate")
def tam_estimate(req: TAMRequest):
    """Estimate the TAM (target addressable market) of predicted responders for
    each requested drug MOA. For every MOA we locate the most recent completed
    simulation, apply the classification-matrix aggregation rule to get a
    responder set within the 548 TCGA cohort, and multiply the resulting
    response rate by the user-supplied US and worldwide GBM patient counts.

    Also returns the union of responder IDs across all MOAs to estimate
    unique patients covered by at least one drug class.
    """
    import json
    import os

    from analysis.responder_similarity import apply_aggregation

    base = os.path.join("data", "simulations")
    if not os.path.isdir(base):
        raise HTTPException(status_code=404, detail="No simulations directory found")

    wanted = [m.strip() for m in req.moas if m.strip()]
    if not wanted:
        raise HTTPException(status_code=400, detail="No MOAs supplied")

    # Map each wanted MOA → most recent (sim_id, summary)
    latest: dict[str, tuple[float, str, dict]] = {}
    for sid in os.listdir(base):
        path = os.path.join(base, sid, "summary.json")
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                summary = json.load(f)
        except Exception:
            continue
        moa = (summary.get("moa_category") or "").strip()
        if moa not in wanted:
            continue
        mtime = os.path.getmtime(path)
        if moa not in latest or mtime > latest[moa][0]:
            latest[moa] = (mtime, sid, summary)

    # Cohort size: total TCGA-GBM patients
    cohort_total = 548
    try:
        bio_path = os.path.join("data", "tcga_patient_biomarkers.json")
        if os.path.isfile(bio_path):
            with open(bio_path, "r", encoding="utf-8") as f:
                bio = json.load(f)
            cohort_total = len(bio.get("patients") or {}) or cohort_total
    except Exception:
        pass

    # Lazy cached engine (only when top_n > 0, since per-drug classification
    # requires direct DCNA + expression access).
    engine = None
    dcna_idx_map: dict[str, int] = {}
    expr_idx_map: dict[str, int] = {}
    if req.top_n > 0:
        import numpy as np
        engine = _get_cached_engine()
        dcna_idx_map = {p: i for i, p in enumerate(engine.dcna_patients)}
        expr_idx_map = {p: i for i, p in enumerate(engine.expr_patients)}
        dcna_drug_upper = {d.upper(): d for d in engine.dcna_drugs_list}
        expr_keys_upper = {k.upper(): k for k in engine.expr_data}
        # Patients present in both DCNA and expression data form the scorable cohort
        common_patients = [p for p in engine.dcna_patients if p in expr_idx_map]

    def _classify_drug(drug_key: str, threshold: float) -> set[str]:
        """Return the set of TCGA patient IDs predicted to respond to this drug:
        DCNA > learned_threshold AND mean target expression > 0."""
        if drug_key not in engine.dcna_data:
            return set()
        entry = engine.drug_targets.get(drug_key, {})
        gene_keys: list[str] = []
        for t in entry.get("targets", []):
            g = (t.get("gene_symbol") or "").upper()
            if g in expr_keys_upper:
                gene_keys.append(expr_keys_upper[g])
        dcna_series = engine.dcna_data[drug_key]
        out: set[str] = set()
        for pid in common_patients:
            di = dcna_idx_map[pid]
            ei = expr_idx_map[pid]
            dv = float(dcna_series[di])
            if dv <= threshold:
                continue
            if gene_keys:
                ev = float(np.mean([engine.expr_data[g][ei] for g in gene_keys]))
            else:
                ev = 0.0
            if ev > 0:
                out.add(pid)
        return out

    per_moa = []
    union_responders: set[str] = set()
    missing: list[str] = []
    for moa in wanted:
        if moa not in latest:
            missing.append(moa)
            continue
        _mtime, sid, summary = latest[moa]
        threshold = summary.get("overall_learned_threshold")

        if req.top_n > 0 and threshold is not None:
            # Per-drug route: score every drug in moa_drug_names, sort by
            # response rate, take the top-N, and union their responder sets.
            drug_names = summary.get("moa_drug_names") or []
            per_drug: list[dict] = []
            for raw in drug_names:
                key = dcna_drug_upper.get((raw or "").upper())
                if not key:
                    continue
                resp_set = _classify_drug(key, float(threshold))
                rate = len(resp_set) / cohort_total if cohort_total else 0.0
                per_drug.append({
                    "drug_name": key,
                    "n_responders": len(resp_set),
                    "response_rate": rate,
                    "responder_ids": resp_set,
                })
            if not per_drug:
                missing.append(moa)
                continue
            per_drug.sort(key=lambda d: -d["response_rate"])
            selected = per_drug[: req.top_n]
            moa_responders: set[str] = set()
            for d in selected:
                moa_responders |= d["responder_ids"]
            n_resp = len(moa_responders)
            rate = n_resp / cohort_total if cohort_total else 0.0
            per_moa.append({
                "moa_category": moa,
                "sim_id": sid,
                "learned_threshold": threshold,
                "n_responders": n_resp,
                "cohort_total": cohort_total,
                "response_rate": rate,
                "us_predicted": int(round(req.us_patients * rate)),
                "ww_predicted": int(round(req.ww_patients * rate)),
                "responder_ids": sorted(moa_responders),
                "top_drugs": [
                    {
                        "drug_name": d["drug_name"],
                        "n_responders": d["n_responders"],
                        "response_rate": d["response_rate"],
                    }
                    for d in selected
                ],
                "n_drugs_evaluated": len(per_drug),
            })
            union_responders |= moa_responders
            continue

        # Classification-matrix route (all trials aggregated)
        matrix = summary.get("responder_classification_matrix")
        if not matrix:
            missing.append(moa)
            continue
        labels = apply_aggregation(matrix, req.rule)
        responders = {pid for pid, v in labels.items() if v}
        n_resp = len(responders)
        rate = n_resp / cohort_total if cohort_total else 0.0
        per_moa.append({
            "moa_category": moa,
            "sim_id": sid,
            "learned_threshold": threshold,
            "n_responders": n_resp,
            "cohort_total": cohort_total,
            "response_rate": rate,
            "us_predicted": int(round(req.us_patients * rate)),
            "ww_predicted": int(round(req.ww_patients * rate)),
            "responder_ids": sorted(responders),
            "top_drugs": None,
            "n_drugs_evaluated": None,
        })
        union_responders |= responders

    union_n = len(union_responders)
    union_rate = union_n / cohort_total if cohort_total else 0.0

    return {
        "rule": req.rule,
        "top_n": req.top_n,
        "us_patients": req.us_patients,
        "ww_patients": req.ww_patients,
        "cohort_total": cohort_total,
        "per_moa": per_moa,
        "missing_moas": missing,
        "union": {
            "n_responders": union_n,
            "response_rate": union_rate,
            "us_predicted": int(round(req.us_patients * union_rate)),
            "ww_predicted": int(round(req.ww_patients * union_rate)),
            "responder_ids": sorted(union_responders),
        },
    }
