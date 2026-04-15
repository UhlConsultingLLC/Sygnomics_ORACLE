"""Trial endpoints: list, search, detail, refresh."""

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload, subqueryload

from analysis.filters import canonicalize_phase, CANONICAL_PHASES
from api.dependencies import get_db
from api.mesh_expansion import expand_condition, expand_intervention


def _display_phase(raw: str | None) -> str:
    """Render a raw DB phase as a single canonical label for display.
    Combined phases like Phase 1/Phase 2 become "PHASE1/PHASE2"."""
    canon = canonicalize_phase(raw)
    if not canon:
        return "NA"
    ordered = [p for p in CANONICAL_PHASES if p in canon]
    return "/".join(ordered)
from api.schemas import OutcomeSummary, TrialListResponse, TrialSummary
from database.models import ArmRecord, ConditionRecord, InterventionRecord, OutcomeRecord, TrialRecord, WHOClassificationRecord, trial_conditions, trial_interventions
from database.queries import get_trial

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trials", tags=["trials"])


@router.get("", response_model=TrialListResponse)
def list_trials(
    nct_id: Optional[str] = Query(None, description="Filter by NCT ID (partial match)"),
    condition: Optional[str] = Query(None, description="Filter by condition name"),
    status: Optional[str] = Query(None, description="Filter by trial status"),
    phase: Optional[str] = Query(None, description="Filter by canonical phase(s); comma-separated. Values: EARLY_PHASE1, PHASE1, PHASE2, PHASE3, PHASE4, NA"),
    intervention: Optional[str] = Query(None, description="Filter by therapy/treatment name (comma-separated for multiple)"),
    intervention_mode: Optional[str] = Query("any", description="How to combine multiple therapies: 'any' (OR) or 'all' (AND)"),
    intervention_exclusive: bool = Query(False, description="AND mode only: require trial interventions to be limited to the searched therapies (no extras)"),
    intervention_same_arm: bool = Query(False, description="AND mode only: require all therapies to appear in the same trial arm/group"),
    has_results: Optional[str] = Query(None, description="Filter results: 'with_data' (has actual results), 'no_data' (outcomes but no results on CT.gov), 'no_outcomes' (no outcome records)"),
    outcome_keyword: Optional[str] = Query(None, description="Filter by outcome measure keyword"),
    source: Optional[str] = Query(None, description="Filter by data source: 'ctgov', 'ctis', or 'all' (default)"),
    intercavitary: Optional[str] = Query(None, description="Filter by intercavitary delivery: 'confirmed', 'mentioned', 'any' (confirmed+mentioned), or 'none'"),
    who_type: Optional[str] = Query(None, description="Filter by WHO 2021 subtype (partial match on who_types)"),
    expand_synonyms: bool = Query(True, description="Expand condition/intervention via MeSH synonyms"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List trials with server-side pagination and filtering."""
    # Build query — eager-load conditions, interventions, and sponsor for summary
    query = (
        db.query(TrialRecord)
        .options(
            subqueryload(TrialRecord.conditions),
            subqueryload(TrialRecord.interventions),
            subqueryload(TrialRecord.outcomes),
            joinedload(TrialRecord.sponsor),
        )
    )

    # Apply filters at database level
    if source and source != "all":
        query = query.filter(TrialRecord.source == source)

    if intercavitary:
        if intercavitary == "any":
            query = query.filter(TrialRecord.intercavitary_delivery.in_(["confirmed", "mentioned"]))
        elif intercavitary in ("confirmed", "mentioned", "none"):
            query = query.filter(TrialRecord.intercavitary_delivery == intercavitary)

    if who_type:
        who_terms = [w.strip() for w in who_type.split(",") if w.strip()]
        if who_terms:
            who_sub = (
                db.query(WHOClassificationRecord.trial_nct_id)
                .filter(or_(*[WHOClassificationRecord.who_types.ilike(f"%{w}%") for w in who_terms]))
                .subquery()
            )
            query = query.filter(TrialRecord.nct_id.in_(db.query(who_sub)))

    if nct_id:
        query = query.filter(TrialRecord.nct_id.ilike(f"%{nct_id}%"))

    applied_expansions: dict[str, list[str]] = {}

    if condition:
        # Support comma-separated + optional MeSH synonym expansion
        raw_terms = [k.strip() for k in condition.split(",") if k.strip()]
        cond_terms: list[str] = []
        for t in raw_terms:
            if expand_synonyms:
                expanded = list(expand_condition(t))
                if expanded:
                    cond_terms.extend(expanded)
                    if len(expanded) > 1:
                        applied_expansions.setdefault("condition", []).extend(expanded)
                else:
                    cond_terms.append(t)
            else:
                cond_terms.append(t)
        # Dedupe case-insensitive
        seen = set()
        cond_terms = [c for c in cond_terms if not (c.lower() in seen or seen.add(c.lower()))]
        if cond_terms:
            cond_filters = [ConditionRecord.name.ilike(f"%{kw}%") for kw in cond_terms]
            query = query.join(TrialRecord.conditions).filter(or_(*cond_filters))

    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if statuses:
            query = query.filter(TrialRecord.status.in_(statuses))

    if phase:
        requested = {p.strip().upper() for p in phase.split(",") if p.strip()}
        if requested:
            all_raw = [r for (r,) in db.query(TrialRecord.phase).distinct().all()]
            matching_raw = [r for r in all_raw if r and (canonicalize_phase(r) & requested)]
            clauses = []
            if matching_raw:
                clauses.append(TrialRecord.phase.in_(matching_raw))
            if "NA" in requested:
                clauses.append(TrialRecord.phase.is_(None))
            query = query.filter(or_(*clauses)) if clauses else query.filter(False)

    # Build intervention groups (one group per user-entered term, containing its synonyms)
    intervention_groups: list[list[str]] = []
    if intervention:
        raw_terms = [k.strip() for k in intervention.split(",") if k.strip()]
        for t in raw_terms:
            if expand_synonyms:
                expanded = list(expand_intervention(t)) or [t]
                # DB-grounded synonyms: any other intervention name sharing a
                # chembl_id with a DB intervention that matches `t`. Picks up
                # brand/generic/code aliases that the trials actually use
                # (e.g. "XL184" ↔ "Cabozantinib" ↔ "Cometriq").
                try:
                    seed_rows = (
                        db.query(InterventionRecord.chembl_id)
                        .filter(InterventionRecord.name.ilike(f"%{t}%"))
                        .filter(InterventionRecord.chembl_id.isnot(None))
                        .filter(InterventionRecord.chembl_id != "")
                        .distinct()
                        .all()
                    )
                    chembl_ids = [r[0] for r in seed_rows if r[0]]
                    if chembl_ids:
                        syn_rows = (
                            db.query(InterventionRecord.name)
                            .filter(InterventionRecord.chembl_id.in_(chembl_ids))
                            .distinct()
                            .all()
                        )
                        expanded.extend(r[0] for r in syn_rows if r[0])
                except Exception as exc:
                    logger.warning("DB intervention synonym lookup failed for %r: %s", t, exc)
                if len(expanded) > 1:
                    applied_expansions.setdefault("intervention", []).extend(expanded)
            else:
                expanded = [t]
            # Dedupe within group (case-insensitive)
            seen_g: set[str] = set()
            grp = [e for e in expanded if not (e.lower() in seen_g or seen_g.add(e.lower()))]
            if grp:
                intervention_groups.append(grp)

    iv_mode = (intervention_mode or "any").lower()
    if intervention_groups:
        if iv_mode == "all":
            # Require each group (therapy) to be matched by at least one intervention on the trial
            for grp in intervention_groups:
                sub = (
                    db.query(trial_interventions.c.trial_nct_id)
                    .join(
                        InterventionRecord,
                        InterventionRecord.id == trial_interventions.c.intervention_id,
                    )
                    .filter(or_(*[InterventionRecord.name.ilike(f"%{kw}%") for kw in grp]))
                    .subquery()
                )
                query = query.filter(TrialRecord.nct_id.in_(db.query(sub)))
        else:
            # OR mode: any group match is sufficient
            flat = [kw for grp in intervention_groups for kw in grp]
            query = query.join(TrialRecord.interventions).filter(
                or_(*[InterventionRecord.name.ilike(f"%{kw}%") for kw in flat])
            )

    if has_results:
        # Multi-select three-way results filter, OR-combined.
        modes = {m.strip() for m in has_results.split(",") if m.strip()}
        has_data_sub = (
            db.query(OutcomeRecord.trial_nct_id)
            .filter(
                OutcomeRecord.results_json.isnot(None),
                func.length(OutcomeRecord.results_json) > 2,
            )
            .distinct()
            .subquery()
        )
        has_outcomes_sub = (
            db.query(OutcomeRecord.trial_nct_id).distinct().subquery()
        )
        clauses = []
        if "with_data" in modes:
            clauses.append(TrialRecord.nct_id.in_(db.query(has_data_sub)))
        if "no_data" in modes:
            clauses.append(and_(
                TrialRecord.nct_id.in_(db.query(has_outcomes_sub)),
                ~TrialRecord.nct_id.in_(db.query(has_data_sub)),
            ))
        if "no_outcomes" in modes:
            clauses.append(~TrialRecord.nct_id.in_(db.query(has_outcomes_sub)))
        if clauses:
            query = query.filter(or_(*clauses))

    if outcome_keyword:
        # Support comma-separated keywords (from outcome expansion)
        keywords = [k.strip() for k in outcome_keyword.split(",") if k.strip()]
        if keywords:
            outcome_filters = [
                OutcomeRecord.measure.ilike(f"%{kw}%") for kw in keywords
            ]
            # Join OutcomeRecord if not already joined by has_results filter
            if not has_results:
                query = query.join(
                    OutcomeRecord, TrialRecord.nct_id == OutcomeRecord.trial_nct_id
                )
            query = query.filter(or_(*outcome_filters))

    # Optional post-filters that require loading trial-level data (exclusive / same-arm)
    needs_postfilter = (
        iv_mode == "all"
        and len(intervention_groups) >= 1
        and (intervention_exclusive or intervention_same_arm)
    )
    restricted_ids: Optional[list[str]] = None
    if needs_postfilter:
        candidate_ids = [
            row[0]
            for row in query.with_entities(TrialRecord.nct_id).distinct().all()
        ]
        kept: list[str] = []

        def _matches_group(text: str, grp: list[str]) -> bool:
            tl = text.lower()
            return any(kw.lower() in tl for kw in grp)

        if intervention_same_arm and candidate_ids:
            # Require one arm whose label+description contains at least one term from every group
            arms = (
                db.query(ArmRecord)
                .filter(ArmRecord.trial_nct_id.in_(candidate_ids))
                .all()
            )
            arms_by_trial: dict[str, list[ArmRecord]] = {}
            for a in arms:
                arms_by_trial.setdefault(a.trial_nct_id, []).append(a)
            for nid in candidate_ids:
                trial_arms = arms_by_trial.get(nid, [])
                same_arm_ok = any(
                    all(_matches_group(f"{a.label} {a.description}", grp) for grp in intervention_groups)
                    for a in trial_arms
                )
                if same_arm_ok:
                    kept.append(nid)
            candidate_ids = kept
            kept = []

        if intervention_exclusive and candidate_ids:
            # Require every intervention attached to the trial to match one of the groups
            iv_rows = (
                db.query(trial_interventions.c.trial_nct_id, InterventionRecord.name)
                .join(
                    InterventionRecord,
                    InterventionRecord.id == trial_interventions.c.intervention_id,
                )
                .filter(trial_interventions.c.trial_nct_id.in_(candidate_ids))
                .all()
            )
            ivs_by_trial: dict[str, list[str]] = {}
            for nid, name in iv_rows:
                ivs_by_trial.setdefault(nid, []).append(name or "")
            for nid in candidate_ids:
                names = ivs_by_trial.get(nid, [])
                if not names:
                    continue
                if all(any(_matches_group(nm, grp) for grp in intervention_groups) for nm in names):
                    kept.append(nid)
            candidate_ids = kept

        restricted_ids = candidate_ids
        query = query.filter(TrialRecord.nct_id.in_(restricted_ids or [""]))

    # Get total count efficiently (separate count query)
    count_query = query.with_entities(func.count(func.distinct(TrialRecord.nct_id)))
    total = count_query.scalar() or 0

    # Apply pagination at database level
    records = (
        query.distinct()
        .order_by(TrialRecord.nct_id)
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Bulk-load WHO classifications for these trials
    nct_ids = [r.nct_id for r in records]
    who_records = (
        db.query(WHOClassificationRecord)
        .filter(WHOClassificationRecord.trial_nct_id.in_(nct_ids))
        .all()
    ) if nct_ids else []
    who_map: dict[str, WHOClassificationRecord] = {w.trial_nct_id: w for w in who_records}

    return TrialListResponse(
        trials=[
            TrialSummary(
                nct_id=r.nct_id,
                title=r.title,
                status=r.status,
                phase=_display_phase(r.phase),
                enrollment_count=r.enrollment_count,
                conditions=[c.name for c in r.conditions],
                interventions=[iv.name for iv in r.interventions],
                outcomes=[
                    OutcomeSummary(
                        type=o.type,
                        measure=o.measure,
                        time_frame=o.time_frame,
                    )
                    for o in r.outcomes
                ],
                sponsor_name=r.sponsor.name if r.sponsor else "",
                source=getattr(r, 'source', 'ctgov') or 'ctgov',
                intercavitary_delivery=getattr(r, 'intercavitary_delivery', 'none') or 'none',
                intercavitary_mechanisms=getattr(r, 'intercavitary_mechanisms', '') or '',
                who_types=(
                    [t.strip() for t in who_map[r.nct_id].who_types.split(" | ") if t.strip()]
                    if r.nct_id in who_map else []
                ),
                who_confidence=who_map[r.nct_id].confidence if r.nct_id in who_map else "",
            )
            for r in records
        ],
        total=total,
        applied_expansions={k: sorted(set(v), key=str.lower) for k, v in applied_expansions.items()},
    )


@router.get("/{nct_id}")
def get_trial_detail(nct_id: str, db: Session = Depends(get_db)):
    """Get full details for a specific trial."""
    trial = get_trial(db, nct_id)
    if trial is None:
        raise HTTPException(status_code=404, detail=f"Trial {nct_id} not found")
    return trial.model_dump()


@router.get("/{nct_id}/biomarkers")
def get_trial_biomarkers(nct_id: str, db: Session = Depends(get_db)):
    """Extract biomarker criteria from trial eligibility and arms, with TCGA GBM prevalence."""
    from analysis.biomarker_extractor import extract_biomarkers, extract_arm_biomarkers
    from database.models import ArmRecord, EligibilityRecord, TrialRecord

    # Pull trial-level prose so we don't miss criteria buried in the summary
    # (e.g., MGMT methylation status assigned per regimen, "newly diagnosed" GBM).
    trial_row = db.get(TrialRecord, nct_id)
    summary_text = ""
    if trial_row is not None:
        summary_text = "\n".join([
            trial_row.brief_summary or "",
            trial_row.detailed_description or "",
        ]).strip()

    # Eligibility-level biomarkers (also screen the trial summary so disease-state
    # and molecular criteria mentioned only in prose are flagged TCGA-matchable).
    elig = db.query(EligibilityRecord).filter_by(trial_nct_id=nct_id).first()
    combined_elig = "\n".join([elig.criteria_text or "" if elig else "", summary_text]).strip()
    elig_markers = extract_biomarkers(combined_elig)

    # Arm-level biomarkers (with per-arm assignment from the summary text).
    arm_records = db.query(ArmRecord).filter_by(trial_nct_id=nct_id).all()
    arms_data = [
        {"label": a.label, "type": a.type, "description": a.description}
        for a in arm_records
    ]
    arm_markers = extract_arm_biomarkers(arms_data, summary_text=summary_text)

    # A marker should only appear in the trial-level (TCGA-GBM matchable) list
    # if it applies to the trial as a whole. If it shows up on some arms but not
    # all, it is arm-specific (e.g., MGMT methylated vs unmethylated assigned by
    # regimen) and must be removed from the trial-level list to avoid implying
    # it applies to every patient.
    if arm_markers and arms_data:
        total_arms = len(arms_data)
        arm_marker_presence: dict[str, int] = {}
        for ai in arm_markers:
            for bm in ai.biomarkers:
                arm_marker_presence[bm.marker] = arm_marker_presence.get(bm.marker, 0) + 1
        arm_specific = {
            name for name, count in arm_marker_presence.items() if count < total_arms
        }
        elig_markers = [m for m in elig_markers if m.marker not in arm_specific]

    return {
        "nct_id": nct_id,
        "biomarkers": [m.model_dump() for m in elig_markers],
        "arm_biomarkers": [a.model_dump() for a in arm_markers],
    }


# ── Trial vs SATGBM TCGA comparison ──────────────────────────────────────


# Map canonical biomarker markers (from biomarker_extractor) → a callable
# that takes a TCGA patient biomarker dict (has "mutations", "cnv", "clinical")
# and returns True if the patient satisfies that marker. Markers not present
# here are treated as unmappable and ignored entirely when filtering.
def _build_biomarker_mappers():
    def _has_nonsilent_mut(profile: dict, gene: str) -> bool:
        muts = (profile.get("mutations") or {}).get(gene) or []
        for m in muts:
            ct = (m.get("consequence_type") or "").lower()
            if ct and "synonymous" not in ct and "intron" not in ct and "downstream" not in ct and "upstream" not in ct and "non_coding" not in ct:
                return True
        return False

    def _has_specific_aa(profile: dict, gene: str, aa_contains: str) -> bool:
        muts = (profile.get("mutations") or {}).get(gene) or []
        return any(aa_contains in (m.get("aa_change") or "") for m in muts)

    def _cnv_is(profile: dict, gene: str, change: str) -> bool:
        return ((profile.get("cnv") or {}).get(gene) or "").lower() == change.lower()

    def _is_newly_diagnosed(profile: dict) -> bool:
        clin = profile.get("clinical") or {}
        prog = (clin.get("progression_or_recurrence") or "").lower()
        return prog in ("no", "not reported", "unknown")

    def _is_recurrent(profile: dict) -> bool:
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
        # IDH wild-type (invert IDH mutation check; requires clinical annotation or WES)
        "IDH wild-type": lambda p: (
            (p.get("clinical") or {}).get("idh_status") == "wild-type"
            if (p.get("clinical") or {}).get("idh_status")
            else not (_has_nonsilent_mut(p, "IDH1") or _has_nonsilent_mut(p, "IDH2"))
        ),
        # MGMT methylation status
        "MGMT methylated": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") == "methylated"),
        "MGMT promoter methylated": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") == "methylated"),
        "MGMT unmethylated": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") == "unmethylated"),
        "MGMT status known": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") in ("methylated", "unmethylated")),
        "MGMT mentioned": lambda p: ((p.get("clinical") or {}).get("mgmt_methylation") in ("methylated", "unmethylated")),
        # EGFR alteration (mutation OR amplification)
        "EGFR alteration": lambda p: _has_nonsilent_mut(p, "EGFR") or _cnv_is(p, "EGFR", "Gain"),
        "EGFR overexpression": lambda p: _cnv_is(p, "EGFR", "Gain"),
        # FGFR alterations (any FGFR1/2/3 mutation or amplification)
        "FGFR alteration": lambda p: (
            _has_nonsilent_mut(p, "FGFR1") or _has_nonsilent_mut(p, "FGFR2") or _has_nonsilent_mut(p, "FGFR3")
            or _cnv_is(p, "FGFR1", "Gain") or _cnv_is(p, "FGFR2", "Gain") or _cnv_is(p, "FGFR3", "Gain")
        ),
        # High TMB (use somatic mutation count; >10 mutations/Mb ~ >400 WES mutations)
        "High TMB": lambda p: len(p.get("mutations") or {}) > 200,
        # Fusion markers — check for gene-level structural rearrangements
        # (limited: only detectable if captured in somatic mutations as fusions)
        "NTRK fusion": lambda p: (
            _has_nonsilent_mut(p, "NTRK1") or _has_nonsilent_mut(p, "NTRK2") or _has_nonsilent_mut(p, "NTRK3")
        ),
        "ALK fusion": lambda p: _has_nonsilent_mut(p, "ALK"),
        "ROS1 fusion": lambda p: _has_nonsilent_mut(p, "ROS1"),
    }


import re as _re

_ACRONYMS = {"ATRA", "FOLFOX", "FOLFIRI", "FOLFIRINOX", "CHOP", "ABVD", "BEP", "ICE", "DHAP"}

_FORMULATION_PATTERNS = [
    _re.compile(r"\([^)]*\)"),  # parenthetical content
    _re.compile(r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|mg/m2|mg/kg|units?|iu)\b", _re.IGNORECASE),
    _re.compile(r"\b(?:tablets?|capsules?|injection|injectable|oral|iv|intravenous|infusion|suspension|solution|powder|cream|ointment|gel|patch|film-coated|film|coated|extended[- ]release|sustained[- ]release|immediate[- ]release|hydrochloride|hcl|sulfate|sodium|mesylate|citrate|phosphate|dihydrate|monohydrate|anhydrous)\b", _re.IGNORECASE),
]


def _standardize_drug_name(raw: str) -> str:
    """Strip common pharmaceutical formulation noise from an intervention name
    and return a title-cased standard name. Preserves all-caps acronyms."""
    if not raw:
        return ""
    s = raw.strip()
    for pat in _FORMULATION_PATTERNS:
        s = pat.sub(" ", s)
    s = _re.sub(r"[,;]", " ", s)
    s = _re.sub(r"\s+", " ", s).strip(" -")
    if not s:
        return raw.strip()

    def _title_token(tok: str) -> str:
        stripped = _re.sub(r"[^A-Za-z0-9]", "", tok)
        if stripped.upper() in _ACRONYMS:
            return tok.upper()
        if len(stripped) >= 2 and stripped.isupper():
            return tok  # preserve existing acronyms like BRAF, PARP
        return tok[:1].upper() + tok[1:].lower() if tok else tok

    return " ".join(_title_token(t) for t in s.split())


from functools import lru_cache as _lru_cache

@_lru_cache(maxsize=512)
def _chembl_preferred_name(term: str) -> str | None:
    """Look up the ChEMBL preferred (INN/generic) name for a drug term.

    Queries the ChEMBL REST API molecule search endpoint and returns the
    pref_name of the best matching molecule, or None if no confident match.
    Handles research codes like 'BGB-290' → 'PAMIPARIB'.
    """
    import json as _json_
    import urllib.parse
    import urllib.request

    if not term or not term.strip():
        return None

    slug_re = _re.compile(r"[^a-z0-9]+")
    def _slug(s: str) -> str:
        return slug_re.sub("", s.lower())

    norm = _slug(term)
    if not norm:
        return None

    try:
        url = (
            "https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?"
            + urllib.parse.urlencode({"q": term.strip(), "limit": 5})
        )
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "CT-Pipeline/0.1.0",
        })
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = _json_.loads(resp.read().decode("utf-8"))
    except Exception:
        return None

    for mol in (data.get("molecules") or [])[:5]:
        pref = (mol.get("pref_name") or "").strip()
        if not pref:
            continue
        # Check if term matches pref_name or any synonym
        syn_names = [
            (s.get("molecule_synonym") or s.get("synonyms") or "").strip()
            for s in (mol.get("molecule_synonyms") or []) if isinstance(s, dict)
        ]
        all_slugs = {_slug(pref), *(_slug(s) for s in syn_names)}
        if any(norm and (norm == n or norm in n or n in norm) for n in all_slugs if n):
            # Return title-cased pref_name (ChEMBL returns uppercase)
            return pref.title()

    return None


def _resolve_drug_display_name(raw: str) -> str:
    """Resolve the best display name for a drug.

    Attempts ChEMBL preferred-name lookup first (to resolve research codes
    like BGB-290 → Pamiparib), then falls back to formulation stripping.
    """
    stripped = _standardize_drug_name(raw) or raw.strip()
    # Try ChEMBL lookup with the stripped name
    preferred = _chembl_preferred_name(stripped)
    if preferred:
        return preferred
    # Also try with the raw name in case stripping removed useful info
    if stripped.lower() != raw.strip().lower():
        preferred = _chembl_preferred_name(raw.strip())
        if preferred:
            return preferred
    return stripped


def _pick_primary_intervention(trial_row, intervention_id: Optional[int] = None):
    """Pick the intervention row to use as primary drug. If intervention_id is
    provided, use that specific one (must belong to the trial). Otherwise use
    the first non-placebo drug/biological."""
    candidates = []
    for iv in trial_row.interventions or []:
        itype = (iv.intervention_type or "").lower()
        name = (iv.name or "").strip()
        if not name:
            continue
        if "placebo" in name.lower():
            continue
        if itype and itype not in ("drug", "biological", "small_molecule", "combination_product", ""):
            continue
        candidates.append(iv)
    if intervention_id is not None:
        for iv in candidates:
            if iv.id == intervention_id:
                return iv
        return None
    return candidates[0] if candidates else None


@router.get("/{nct_id}/drug-options")
def trial_drug_options(nct_id: str, db: Session = Depends(get_db)):
    """Return candidate drug interventions for the TCGA comparison tool."""
    from api.routers.tcga import _load_dcna
    from database.models import MOAAnnotationRecord, TrialRecord

    trial_row = db.get(TrialRecord, nct_id)
    if trial_row is None:
        raise HTTPException(status_code=404, detail=f"Trial {nct_id} not found")

    _, _, dcna_data = _load_dcna()
    dcna_upper = {k.upper(): k for k in dcna_data.keys()}

    try:
        from api.mesh_expansion import expand_intervention as _expand_iv
    except Exception:
        _expand_iv = None  # type: ignore

    def _has_dcna(name: str) -> bool:
        if not name:
            return False
        if name in dcna_data or name.upper() in dcna_upper:
            return True
        if _expand_iv is not None:
            try:
                for syn in _expand_iv(name) or []:
                    if syn in dcna_data or syn.upper() in dcna_upper:
                        return True
            except Exception:
                pass
        return False

    raw_items: list[dict] = []
    for iv in trial_row.interventions or []:
        itype = (iv.intervention_type or "").lower()
        name = (iv.name or "").strip()
        if not name:
            continue
        if "placebo" in name.lower():
            continue
        if itype and itype not in ("drug", "biological", "small_molecule", "combination_product", ""):
            continue
        std = _resolve_drug_display_name(name)
        raw_items.append({"iv": iv, "raw_name": name, "standard_name": std})

    # Dedupe by (standard_name, chembl_id) — keep first id, collect aliases
    merged: dict[tuple[str, str], dict] = {}
    for item in raw_items:
        iv = item["iv"]
        key = (item["standard_name"].lower(), (iv.chembl_id or "").lower())
        if key in merged:
            if item["raw_name"] not in merged[key]["raw_names"]:
                merged[key]["raw_names"].append(item["raw_name"])
        else:
            moa_row = (
                db.query(MOAAnnotationRecord.moa_short_form, MOAAnnotationRecord.moa_broad_category)
                .filter(MOAAnnotationRecord.intervention_id == iv.id)
                .filter(MOAAnnotationRecord.moa_short_form.isnot(None))
                .filter(MOAAnnotationRecord.moa_short_form != "")
                .first()
            )
            moa_short = moa_row[0] if moa_row else None
            moa_broad = moa_row[1] if moa_row else None
            merged[key] = {
                "intervention_id": iv.id,
                "standard_name": item["standard_name"],
                "raw_names": [item["raw_name"]],
                "chembl_id": iv.chembl_id,
                "moa_short_form": moa_short,
                "moa_broad_category": moa_broad,
            }

    drugs_out = []
    for entry in merged.values():
        has_dcna = _has_dcna(entry["standard_name"]) or any(_has_dcna(r) for r in entry["raw_names"])
        entry["has_dcna_profile"] = has_dcna
        drugs_out.append(entry)

    drugs_out.sort(key=lambda d: (not d["has_dcna_profile"], d["standard_name"].lower()))

    # Build arm list with their intervention names
    arms_out = []
    for arm in trial_row.arms or []:
        iv_names = [n.strip() for n in (arm.intervention_names or "").split(",") if n.strip()]
        arms_out.append({
            "arm_id": arm.id,
            "label": arm.label,
            "type": arm.type,
            "description": arm.description,
            "intervention_names": iv_names,
        })

    # Extract sub-groups from outcome results.  Trials often define
    # sub-populations (e.g., "Sub-population A", "Sub-population B")
    # as separate result groups inside outcomes, not as separate arms.
    import json as _json_dopt
    seen_groups: dict[str, str] = {}  # group_title -> group_description
    for oc in trial_row.outcomes or []:
        rj = oc.results_json
        if not rj:
            continue
        try:
            rows = _json_dopt.loads(rj)
        except Exception:
            continue
        for row in rows:
            gt = (row.get("group_title") or "").strip()
            gd = (row.get("group_description") or "").strip()
            if not gt:
                continue
            # Keep the longest description for each title
            if gt not in seen_groups or len(gd) > len(seen_groups[gt]):
                seen_groups[gt] = gd

    # Build sub-group list, excluding generic "Total"/"Overall" entries
    _SKIP_TITLES = {"total", "overall", "all participants", "all subjects",
                    "all patients", "full analysis set", "itt", "intent-to-treat"}
    subgroups_out = []
    for gt, gd in sorted(seen_groups.items()):
        if gt.lower().strip() in _SKIP_TITLES:
            continue
        subgroups_out.append({
            "group_title": gt,
            "group_description": gd,
        })

    return {"nct_id": nct_id, "drugs": drugs_out, "arms": arms_out, "subgroups": subgroups_out}


@router.post("/{nct_id}/tcga-comparison")
def tcga_trial_comparison(
    nct_id: str,
    intervention_id: Optional[int] = Query(None, description="Specific intervention row id to use as primary drug"),
    arm_id: Optional[int] = Query(None, description="Specific arm/group id to scope biomarkers & therapies"),
    group_title: Optional[str] = Query(None, description="Outcome result sub-group title (e.g. 'Sub-population B')"),
    db: Session = Depends(get_db),
):
    """Compare a single clinical trial's enrollment against the TCGA cohort
    under (a) the trial's own eligibility criteria and (b) SATGBM's learned
    DCNA + expression thresholds.

    Selection scoping (from most specific to least):
      *group_title* — scopes biomarkers to a sub-group description found in
        outcome results (e.g. "Sub-population B: EGFR amp + EGFRvIII pos")
        and restricts the observed response rate to that sub-group.
      *arm_id* — scopes to a formal CT.gov arm's description and therapies.
      *(neither)* — uses the full trial eligibility criteria.
    """
    import numpy as np
    import json as _json2
    from analysis.biomarker_extractor import extract_biomarkers, extract_arm_biomarkers
    from analysis.moa_simulation import MOASimulationEngine, extract_response_rate
    from api.routers.simulation import _get_cached_engine
    from api.routers.tcga import get_drug_targets as tcga_get_drug_targets, _load_dcna, _load_expression
    from database.models import EligibilityRecord, MOAAnnotationRecord, TrialRecord

    trial_row = db.get(TrialRecord, nct_id)
    if trial_row is None:
        raise HTTPException(status_code=404, detail=f"Trial {nct_id} not found")

    # Resolve selected sub-group (if provided).  We look up the group
    # description across all outcome results for this trial.
    selected_subgroup: dict | None = None
    if group_title is not None:
        _best_desc = ""
        for oc in (trial_row.outcomes or []):
            rj = oc.results_json
            if not rj:
                continue
            try:
                rows = _json2.loads(rj)
            except Exception:
                continue
            for row in rows:
                gt = (row.get("group_title") or "").strip()
                gd = (row.get("group_description") or "").strip()
                if gt == group_title and len(gd) > len(_best_desc):
                    _best_desc = gd
        if not _best_desc:
            raise HTTPException(
                status_code=400,
                detail=f"Sub-group '{group_title}' not found in outcome results for {nct_id}",
            )
        selected_subgroup = {"group_title": group_title, "group_description": _best_desc}

    # Resolve selected arm (if provided)
    selected_arm = None
    if arm_id is not None:
        for arm in (trial_row.arms or []):
            if arm.id == arm_id:
                selected_arm = arm
                break
        if selected_arm is None:
            raise HTTPException(status_code=400, detail=f"Arm {arm_id} not found for trial {nct_id}")

    # 1) Pick primary intervention drug.
    # When an arm is selected and no explicit intervention_id was given,
    # try to find the first drug that belongs to that arm.
    if intervention_id is None and selected_arm is not None:
        arm_iv_names = [n.strip().lower() for n in (selected_arm.intervention_names or "").split(",") if n.strip()]
        if arm_iv_names:
            for iv in (trial_row.interventions or []):
                itype = (iv.intervention_type or "").lower()
                name = (iv.name or "").strip()
                if not name or "placebo" in name.lower():
                    continue
                if itype and itype not in ("drug", "biological", "small_molecule", "combination_product", ""):
                    continue
                if name.lower() in arm_iv_names or any(ai in name.lower() or name.lower() in ai for ai in arm_iv_names):
                    intervention_id = iv.id
                    break

    primary_drug = _pick_primary_intervention(trial_row, intervention_id=intervention_id)
    if primary_drug is None:
        if intervention_id is not None:
            raise HTTPException(status_code=400, detail=f"Intervention {intervention_id} is not an eligible drug for this trial")
        raise HTTPException(status_code=400, detail="No eligible small-molecule/biological intervention found for this trial")

    raw_drug_name = primary_drug.name
    drug_name = _resolve_drug_display_name(raw_drug_name)

    # 2) Resolve MOA category for this drug
    moa_row = (
        db.query(MOAAnnotationRecord.moa_broad_category, MOAAnnotationRecord.moa_short_form)
        .filter(MOAAnnotationRecord.intervention_id == primary_drug.id)
        .filter(MOAAnnotationRecord.moa_short_form.isnot(None))
        .filter(MOAAnnotationRecord.moa_short_form != "")
        .first()
    )
    if moa_row is None:
        raise HTTPException(
            status_code=400,
            detail=f"No MOA annotation found for drug '{drug_name}'",
        )
    moa_broad, moa_short = moa_row
    # Prefer broad group when available (matches /simulation/moa-categories grouping)
    moa_category = f"group:{moa_broad}" if moa_broad else moa_short

    # 3) Run MOA simulation (synchronous; uses existing engine)
    engine = MOASimulationEngine(n_iterations=1000, save_plots=False)
    sim_result = engine.run(moa_category, db)
    if "error" in sim_result:
        # Retry with plain short form if group form failed
        if moa_category.startswith("group:") and moa_short:
            sim_result = engine.run(moa_short, db)
            if "error" not in sim_result:
                moa_category = moa_short
        if "error" in sim_result:
            raise HTTPException(
                status_code=400,
                detail=f"MOA simulation failed for '{moa_category}': {sim_result['error']}",
            )
    learned_threshold = sim_result.get("overall_learned_threshold")
    if learned_threshold is None:
        raise HTTPException(status_code=500, detail="MOA simulation did not produce a learned threshold")
    learned_threshold = float(learned_threshold)
    expression_threshold = 0.0

    # 4) Resolve drug targets via TCGA router helper
    targets_info = tcga_get_drug_targets(drug_name)
    targets_raw = targets_info.get("targets") or []
    target_genes_in_expr = [t["gene_symbol"] for t in targets_raw if t.get("in_expression_data")]

    # 5) Load DCNA + expression tables (same helpers the TCGA router uses)
    dcna_patients, _, dcna_data = _load_dcna()
    expr_patients, _, expr_data = _load_expression()

    # Resolve DCNA drug key (case-insensitive); try standard then raw name
    upper_map = {d.upper(): d for d in dcna_data}
    dcna_key = None
    for cand in (drug_name, raw_drug_name):
        if not cand:
            continue
        if cand in dcna_data:
            dcna_key = cand
            break
        hit = upper_map.get(cand.upper())
        if hit:
            dcna_key = hit
            break
    if dcna_key is None:
        # Try MOA engine's alias list
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
        raise HTTPException(
            status_code=400,
            detail=f"Drug '{drug_name}' has no DCNA profile in TCGA data",
        )

    expr_idx = {p: i for i, p in enumerate(expr_patients)}

    # 6) Load per-patient biomarkers
    import json as _json, os as _os
    bio_path = _os.path.join(_os.path.dirname(__file__), "..", "..", "data", "tcga_patient_biomarkers.json")
    try:
        with open(bio_path, "r", encoding="utf-8") as f:
            bio_json = _json.load(f)
    except Exception:
        bio_json = {"patients": {}}
    patients_bio = bio_json.get("patients") or {}

    # 7) Extract biomarkers from trial eligibility + summary
    elig = db.query(EligibilityRecord).filter_by(trial_nct_id=nct_id).first()
    elig_criteria = elig.criteria_text if elig and elig.criteria_text else ""

    if selected_subgroup is not None:
        # ── Sub-group-scoped extraction ──
        # The sub-group description (e.g. "Subjects with EGFR gene-amplified
        # and EGFRvIII^pos glioblastoma") explicitly states the molecular
        # criteria for this sub-population.  Extract biomarkers from it and
        # treat them all as inclusion criteria.
        sg_desc = selected_subgroup["group_description"]
        sg_title = selected_subgroup["group_title"]
        sg_text = f"{sg_title}\n{sg_desc}"
        sg_markers = extract_biomarkers(sg_text)
        for m in sg_markers:
            m.context = "inclusion"
            if m.requirement == "mentioned":
                m.requirement = "required"
        # Also pull shared eligibility biomarkers (respects inc/excl headers)
        elig_markers = extract_biomarkers(elig_criteria) if elig_criteria else []
        seen = {m.marker for m in sg_markers}
        for m in elig_markers:
            if m.marker not in seen:
                sg_markers.append(m)
                seen.add(m.marker)
        markers = sg_markers

    elif selected_arm is not None:
        # ── Arm-scoped extraction ──
        # Use the arm's own description plus shared eligibility criteria.
        # Biomarkers from the arm description are inclusion criteria.
        arm_desc = selected_arm.description or ""
        arm_label = selected_arm.label or ""
        arm_text = f"{arm_label}\n{arm_desc}"
        summary_text = "\n".join([
            trial_row.brief_summary or "",
            trial_row.detailed_description or "",
        ]).strip()
        arm_markers = extract_biomarkers(arm_text)
        for m in arm_markers:
            m.context = "inclusion"
            if m.requirement == "mentioned":
                m.requirement = "required"
        elig_markers = extract_biomarkers(elig_criteria) if elig_criteria else []
        seen = {m.marker for m in arm_markers}
        for m in elig_markers:
            if m.marker not in seen:
                arm_markers.append(m)
                seen.add(m.marker)
        # Try arm-specific biomarkers from summary via extract_arm_biomarkers
        arm_dicts = [{
            "label": a.label,
            "type": a.type,
            "description": a.description or "",
            "interventions": [n.strip() for n in (a.intervention_names or "").split(",") if n.strip()],
        } for a in (trial_row.arms or [])]
        arm_bm_info = extract_arm_biomarkers(arm_dicts, summary_text)
        for abi in arm_bm_info:
            if abi.arm_label == selected_arm.label:
                for bm in abi.biomarkers:
                    if bm.marker not in seen:
                        bm.context = "inclusion"
                        arm_markers.append(bm)
                        seen.add(bm.marker)
        markers = arm_markers

    else:
        # ── Full trial extraction (original behavior) ──
        elig_text = "\n".join([
            elig_criteria,
            trial_row.brief_summary or "",
            trial_row.detailed_description or "",
        ]).strip()
        elig_end_offset = len(elig_criteria) if elig_criteria else None
        markers = extract_biomarkers(elig_text, eligibility_end_offset=elig_end_offset)

    mappers = _build_biomarker_mappers()

    mapped_markers: list[dict] = []
    unmapped_markers: list[str] = []
    inclusion_rules: list[tuple[str, object]] = []
    exclusion_rules: list[tuple[str, object]] = []
    seen_marker_keys: set[tuple[str, str]] = set()
    for m in markers:
        name = m.marker
        ctx = m.context
        key = (name, ctx)
        if key in seen_marker_keys:
            continue
        seen_marker_keys.add(key)
        fn = mappers.get(name)
        if fn is None:
            unmapped_markers.append(f"{name} ({ctx})")
            mapped_markers.append({"marker": name, "context": ctx, "mapped": False})
            continue
        mapped_markers.append({"marker": name, "context": ctx, "mapped": True})
        if ctx == "exclusion":
            exclusion_rules.append((name, fn))
        else:
            inclusion_rules.append((name, fn))

    def _eligible_by_criteria(profile: dict) -> bool:
        # If no mappable rules at all, default to eligible.
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

    # 8) Per-patient scoring
    points_all: list[dict] = []
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
        eligible = _eligible_by_criteria(profile)

        points_all.append({
            "patient_id": pid,
            "dcna": round(dcna_v, 4),
            "expression": round(expr_v, 4),
            "responder": responder,
            "eligible_by_criteria": eligible,
        })

    # 9) Build left panel (trial criteria) and right panel (SATGBM)
    left_points: list[dict] = []
    for pt in points_all:
        if pt["eligible_by_criteria"] and pt["responder"]:
            cat = "responder_enrolled"
        elif pt["eligible_by_criteria"] and not pt["responder"]:
            cat = "nonresponder_enrolled"
        elif (not pt["eligible_by_criteria"]) and pt["responder"]:
            cat = "responder_excluded_by_criteria"
        else:
            cat = "nonresponder_excluded_by_criteria"
        left_points.append({
            "patient_id": pt["patient_id"],
            "dcna": pt["dcna"],
            "expression": pt["expression"],
            "category": cat,
        })

    # Right panel uses same trial-eligibility categorisation as left panel
    # so both plots highlight the same patients with black borders.
    right_points: list[dict] = []
    for pt in points_all:
        if pt["eligible_by_criteria"] and pt["responder"]:
            cat = "responder_enrolled"
        elif pt["eligible_by_criteria"] and not pt["responder"]:
            cat = "nonresponder_enrolled"
        elif (not pt["eligible_by_criteria"]) and pt["responder"]:
            cat = "responder_excluded_by_criteria"
        else:
            cat = "nonresponder_excluded_by_criteria"
        right_points.append({
            "patient_id": pt["patient_id"],
            "dcna": pt["dcna"],
            "expression": pt["expression"],
            "category": cat,
        })

    left_enrolled = sum(1 for p in left_points if p["category"] in ("responder_enrolled", "nonresponder_enrolled"))
    left_responders = sum(1 for p in left_points if p["category"] == "responder_enrolled")
    left_rate = (left_responders / left_enrolled) if left_enrolled else 0.0
    left_missed = sum(1 for p in left_points if p["category"] == "responder_excluded_by_criteria")

    right_responders = sum(1 for p in right_points if p["category"] in ("responder_enrolled", "responder_excluded_by_criteria"))
    right_rate = (right_responders / len(right_points)) if right_points else 0.0

    # Percentage of predicted responders recovered: responders missed by trial
    # criteria / total predicted responders.  Fold change: total SATGBM
    # responders vs trial-eligible responders (undefined when trial enrolls 0).
    pct_responders_recovered = (left_missed / right_responders * 100.0) if right_responders > 0 else 0.0
    fold_change = (right_responders / left_responders) if left_responders > 0 else None

    nonresponders_left_enrolled = left_enrolled - left_responders
    nonresponders_right = 0  # SATGBM selection has no nonresponders by definition
    nonresponders_spared = max(0, nonresponders_left_enrolled - nonresponders_right)

    # Extract the actual observed clinical response rate from outcome tables.
    # Prioritise outcomes whose measure name explicitly indicates a response
    # rate (ORR, objective response, CR, PR, best overall response) over
    # survival/PFS/OS metrics that can masquerade as percentages.
    import re as _re
    _RR_PATTERN = _re.compile(
        r'(?:objective\s*)?response\s*rate|'
        r'\borr\b|'
        r'\bbest\s*overall\s*response\b|'
        r'\b(?:complete|partial)\s*(?:response|remission)\b|'
        r'\bcr\s*\+\s*pr\b',
        _re.IGNORECASE,
    )
    _SURVIVAL_PATTERN = _re.compile(
        r'surviv|'
        r'\bpfs\b|'
        r'\bos\b|'
        r'progression[- ]?free|'
        r'overall\s*survival|'
        r'time\s*to\s*(?:progression|event|death)',
        _re.IGNORECASE,
    )

    observed_response_rate = None

    # When a sub-group is selected, filter outcome result rows to only
    # those belonging to the chosen group before extracting the rate.
    def _filter_results_for_group(rows_raw: str) -> str:
        """If a sub-group is selected, return JSON with only that group's rows."""
        if selected_subgroup is None:
            return rows_raw
        try:
            rows = _json2.loads(rows_raw)
            filtered = [r for r in rows if (r.get("group_title") or "").strip() == selected_subgroup["group_title"]]
            return _json2.dumps(filtered) if filtered else rows_raw
        except Exception:
            return rows_raw

    # Two passes: first look for explicit response-rate outcomes, then fall back
    outcomes_list = list(trial_row.outcomes or [])
    for priority_pass in (True, False):
        if observed_response_rate is not None:
            break
        for outcome in outcomes_list:
            try:
                measure = outcome.measure or ''
                is_rr = bool(_RR_PATTERN.search(measure))
                is_surv = bool(_SURVIVAL_PATTERN.search(measure))
                if priority_pass and not is_rr:
                    continue           # first pass: only explicit RR measures
                if not priority_pass and is_surv:
                    continue           # second pass: skip survival metrics
                rows_raw = outcome.results_json
                if not rows_raw:
                    continue
                scoped_raw = _filter_results_for_group(rows_raw)
                rr = extract_response_rate(scoped_raw, measure)
                if rr is not None and 0 < rr < 1:
                    observed_response_rate = round(rr, 4)
                    break
            except Exception:
                continue

    # 10) Query biomarker–therapy associations for the trial's drug
    from database.models import BiomarkerTherapyAssociation

    # Collect all extracted biomarker names (canonical forms)
    extracted_marker_names = list({b["marker"] for b in mapped_markers})

    # Also build the drug's therapy class from MOA annotations
    therapy_class_row = (
        db.query(MOAAnnotationRecord.moa_broad_category)
        .filter(MOAAnnotationRecord.intervention_id == primary_drug.id)
        .filter(MOAAnnotationRecord.moa_broad_category.isnot(None))
        .filter(MOAAnnotationRecord.moa_broad_category != "")
        .first()
    )
    therapy_class_str = therapy_class_row[0] if therapy_class_row else ""

    # Query associations that match the drug name, drug class, or extracted biomarkers
    drug_name_lower = drug_name.lower()
    raw_drug_lower = raw_drug_name.lower()
    all_associations = db.query(BiomarkerTherapyAssociation).all()

    biomarker_therapy_matches: list[dict] = []
    seen_assoc_keys: set[tuple] = set()

    for assoc in all_associations:
        therapy_lower = assoc.therapy_name.lower()
        assoc_class_lower = (assoc.therapy_class or "").lower()

        # Match by drug name (exact or substring) OR therapy class
        drug_match = (
            drug_name_lower in therapy_lower
            or raw_drug_lower in therapy_lower
            or therapy_lower in drug_name_lower
            or therapy_lower in raw_drug_lower
            or (therapy_class_str and assoc_class_lower and (
                therapy_class_str.lower() in assoc_class_lower
                or assoc_class_lower in therapy_class_str.lower()
            ))
        )
        if not drug_match:
            continue

        # Dedup key
        dk = (assoc.biomarker.lower(), assoc.therapy_name.lower(), assoc.response_effect)
        if dk in seen_assoc_keys:
            continue
        seen_assoc_keys.add(dk)

        # Check if this biomarker was extracted from the trial
        marker_extracted = any(
            assoc.biomarker.lower() == em.lower() or
            assoc.biomarker.lower() in em.lower() or
            em.lower() in assoc.biomarker.lower()
            for em in extracted_marker_names
        )

        biomarker_therapy_matches.append({
            "biomarker": assoc.biomarker,
            "biomarker_status": assoc.biomarker_status,
            "biomarker_category": assoc.biomarker_category,
            "therapy_name": assoc.therapy_name,
            "therapy_class": assoc.therapy_class,
            "response_effect": assoc.response_effect,
            "effect_size": assoc.effect_size,
            "mechanism_summary": assoc.mechanism_summary,
            "evidence_level": assoc.evidence_level,
            "evidence_sources": assoc.evidence_sources,
            "disease_context": assoc.disease_context,
            "clinical_actionability": assoc.clinical_actionability,
            "marker_in_trial_criteria": marker_extracted,
        })

    # Sort: highest evidence first, then by effect size
    _ev_order = {"level_1": 0, "level_2": 1, "level_3": 2, "level_4": 3}
    _eff_order = {"strong": 0, "moderate": 1, "weak": 2, "variable": 3, "": 4}
    biomarker_therapy_matches.sort(key=lambda a: (
        _ev_order.get(a["evidence_level"], 99),
        _eff_order.get(a["effect_size"], 99),
    ))

    # Build arm / sub-group info for the response
    arm_info = None
    if selected_arm is not None:
        arm_iv_names = [n.strip() for n in (selected_arm.intervention_names or "").split(",") if n.strip()]
        arm_info = {
            "arm_id": selected_arm.id,
            "label": selected_arm.label,
            "type": selected_arm.type,
            "description": selected_arm.description,
            "intervention_names": arm_iv_names,
        }

    # Build a human-readable label for the left panel
    left_label = "Standard clinical trial"
    if selected_subgroup:
        left_label = f"Trial criteria — {selected_subgroup['group_title']}"
    elif selected_arm:
        left_label = f"Trial criteria — {selected_arm.label}"

    return {
        "nct_id": nct_id,
        "drug": drug_name,
        "standard_drug_name": drug_name,
        "intervention_id": primary_drug.id,
        "selected_arm": arm_info,
        "selected_subgroup": selected_subgroup,
        "moa_category": moa_category,
        "learned_dcna_threshold": learned_threshold,
        "expression_threshold": expression_threshold,
        "drug_targets": target_genes_in_expr,
        "extracted_biomarkers": mapped_markers,
        "unmapped_biomarkers": unmapped_markers,
        "observed_response_rate": observed_response_rate,
        "biomarker_therapy_associations": biomarker_therapy_matches,
        "left_panel": {
            "label": left_label,
            "points": left_points,
            "stats": {
                "enrolled": left_enrolled,
                "responders": left_responders,
                "response_rate": round(left_rate, 4),
                "responders_missed": left_missed,
            },
        },
        "right_panel": {
            "label": "SATGBM molecular selection",
            "points": right_points,
            "stats": {
                "responders": right_responders,
                "response_rate": round(right_rate, 4),
                "responders_missed": 0,
            },
        },
        "diff": {
            "response_rate_pp": round((right_rate - left_rate) * 100.0, 2),
            "responders_recovered": left_missed,
            "pct_responders_recovered": round(pct_responders_recovered, 2),
            "fold_change": None if fold_change is None else round(fold_change, 3),
            "nonresponders_spared": nonresponders_spared,
        },
    }


@router.post("/{nct_id}/refresh")
async def refresh_trial_results(nct_id: str, db: Session = Depends(get_db)):
    """Re-fetch a trial from CT.gov to update outcome results data."""
    from connectors.clinicaltrials import _http_get_trial_details

    # Verify trial exists in DB
    record = db.get(TrialRecord, nct_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Trial {nct_id} not found in database")

    try:
        details = await _http_get_trial_details(nct_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from CT.gov: {e}")

    # Check if CT.gov has any results at all for this trial
    total_outcomes_with_results = sum(
        1 for oc in details.get("outcomes", []) if oc.get("results")
    )
    has_results_on_ctgov = total_outcomes_with_results > 0

    # Update outcome results_json from fresh data
    updated_count = 0
    for oc_data in details.get("outcomes", []):
        results = oc_data.get("results", [])
        if not results:
            continue
        measure = oc_data.get("measure", "")
        # Find matching outcome record in DB
        outcome_rec = (
            db.query(OutcomeRecord)
            .filter_by(trial_nct_id=nct_id, measure=measure)
            .first()
        )
        if outcome_rec:
            outcome_rec.results_json = json.dumps(results)
            updated_count += 1

    db.commit()
    return {
        "nct_id": nct_id,
        "outcomes_updated": updated_count,
        "has_results_on_ctgov": has_results_on_ctgov,
    }


@router.post("/backfill-results")
async def backfill_results(
    limit: int = Query(50, ge=1, le=500, description="Max trials to process"),
    db: Session = Depends(get_db),
):
    """Backfill outcome results for trials that have outcomes but no results_json.

    Fetches fresh data from CT.gov for each trial. Rate-limited to avoid API throttling.
    """
    import time
    from connectors.clinicaltrials import _http_get_trial_details

    # Find trials with outcomes but no results_json populated
    trials_to_update = (
        db.query(TrialRecord.nct_id)
        .join(OutcomeRecord, TrialRecord.nct_id == OutcomeRecord.trial_nct_id)
        .filter(
            (OutcomeRecord.results_json.is_(None)) | (OutcomeRecord.results_json == "")
        )
        .distinct()
        .limit(limit)
        .all()
    )

    total = len(trials_to_update)
    success = 0
    failed = 0

    for (nct_id,) in trials_to_update:
        try:
            details = await _http_get_trial_details(nct_id)
            updated = 0
            for oc_data in details.get("outcomes", []):
                results = oc_data.get("results", [])
                if not results:
                    continue
                measure = oc_data.get("measure", "")
                outcome_rec = (
                    db.query(OutcomeRecord)
                    .filter_by(trial_nct_id=nct_id, measure=measure)
                    .first()
                )
                if outcome_rec:
                    outcome_rec.results_json = json.dumps(results)
                    updated += 1
            if updated:
                db.commit()
                success += 1
            # Rate limit: 200ms between requests
            await asyncio.sleep(0.2)
        except Exception as e:
            logger.warning("Failed to backfill %s: %s", nct_id, e)
            db.rollback()
            failed += 1

    return {
        "total_attempted": total,
        "success": success,
        "failed": failed,
    }


@router.post("/refresh-categorical")
async def refresh_categorical_outcomes(
    limit: int = Query(200, ge=1, le=2000, description="Max trials to refresh"),
    db: Session = Depends(get_db),
):
    """Re-fetch CT.gov outcome data for trials whose stored results contain
    binary categorical (Yes/No) measurements that lack a "category" field.
    Required after upgrading the connector to start capturing class/category
    titles, so existing rows can disambiguate Tumor Response Yes/No outcomes.
    """
    import time
    from connectors.clinicaltrials import _http_get_trial_details

    rows = (
        db.query(OutcomeRecord.trial_nct_id, OutcomeRecord.results_json)
        .filter(OutcomeRecord.results_json.isnot(None))
        .filter(func.length(OutcomeRecord.results_json) > 2)
        .all()
    )
    affected: set[str] = set()
    for nct_id, raw in rows:
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            continue
        if not isinstance(data, list) or len(data) < 2:
            continue
        if any("category" in e and e.get("category") for e in data):
            continue  # already migrated
        # Detect Yes/No-style integer pairs per group_title that sum to participants
        from collections import defaultdict
        bg: dict[str, list] = defaultdict(list)
        for e in data:
            bg[e.get("group_title", "")].append(e)
        ambiguous = False
        for entries in bg.values():
            if len(entries) < 2:
                continue
            try:
                vals = [float(str(e.get("value", "")).strip()) for e in entries]
            except Exception:
                continue
            if not all(v.is_integer() for v in vals):
                continue
            participants = max((e.get("participants_count") or 0) for e in entries)
            if participants > 0 and abs(sum(vals) - participants) <= 1:
                ambiguous = True
                break
        if ambiguous:
            affected.add(nct_id)
        if len(affected) >= limit:
            break

    success = 0
    failed = 0
    for nct_id in list(affected)[:limit]:
        try:
            details = await _http_get_trial_details(nct_id)
            updated = 0
            for oc_data in details.get("outcomes", []):
                results = oc_data.get("results", [])
                if not results:
                    continue
                measure = oc_data.get("measure", "")
                outcome_rec = (
                    db.query(OutcomeRecord)
                    .filter_by(trial_nct_id=nct_id, measure=measure)
                    .first()
                )
                if outcome_rec:
                    outcome_rec.results_json = json.dumps(results)
                    updated += 1
            if updated:
                db.commit()
                success += 1
            await asyncio.sleep(0.2)
        except Exception as e:
            logger.warning("Failed to refresh categorical outcomes for %s: %s", nct_id, e)
            db.rollback()
            failed += 1

    return {
        "candidates_found": len(affected),
        "success": success,
        "failed": failed,
    }
