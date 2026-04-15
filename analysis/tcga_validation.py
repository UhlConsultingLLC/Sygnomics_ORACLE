"""Validate SATGBM predictions against real-world TCGA outcomes.

Given a drug name, this module:

    1. Classifies every TCGA patient as a SATGBM-predicted *responder* or
       *non-responder* using the same DCNA + expression + threshold rule
       that drives the trial simulations.
    2. Builds a survival cohort from the ``tcga_treatments`` + ``tcga_patients``
       tables — only patients actually exposed to the drug contribute.
    3. Runs Kaplan-Meier, log-rank, and Cox proportional-hazards analyses
       to test whether predicted responders have longer overall survival.

The core function is :func:`validate_drug`.
"""
from __future__ import annotations

import csv
import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import (
    InterventionRecord,
    MOAAnnotationRecord,
    TCGAPatient,
    TCGATreatment,
)

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
DCNA_PATH = ROOT / "data" / "tcga_dcna.csv"
EXPR_PATH = ROOT / "data" / "tcga_gene_expression.csv"
DRUG_TARGETS_PATH = ROOT / "data" / "drug_targets_cache.json"
THRESHOLD_CACHE_PATH = ROOT / "data" / "moa_threshold_cache.json"


# ── Data loaders (cached) ────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _load_dcna() -> tuple[tuple[str, ...], dict[str, np.ndarray]]:
    """Return ``(patient_barcodes, {drug_upper: values_array})``."""
    with open(DCNA_PATH, newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r)
        patients = tuple(header[1:])
        data: dict[str, np.ndarray] = {}
        for row in r:
            drug = row[0].upper().strip()
            data[drug] = np.array([float(v) if v else 0.0 for v in row[1:]])
    logger.info("Loaded DCNA: %d patients × %d drugs", len(patients), len(data))
    return patients, data


@lru_cache(maxsize=1)
def _load_expression() -> tuple[tuple[str, ...], dict[str, np.ndarray]]:
    """Return ``(patient_barcodes, {gene_symbol: values_array})``."""
    with open(EXPR_PATH, newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r)
        patients = tuple(header[2:])
        data: dict[str, np.ndarray] = {}
        for row in r:
            gene = row[1] or row[0]
            data[gene] = np.array([float(v) if v else 0.0 for v in row[2:]])
    logger.info("Loaded expression: %d patients × %d genes", len(patients), len(data))
    return patients, data


@lru_cache(maxsize=1)
def _load_drug_targets() -> dict:
    if DRUG_TARGETS_PATH.exists():
        with open(DRUG_TARGETS_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


@lru_cache(maxsize=1)
def _load_threshold_cache() -> dict:
    if THRESHOLD_CACHE_PATH.exists():
        with open(THRESHOLD_CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _aliquot_to_case(barcode: str) -> str:
    """``TCGA-06-0125-02`` -> ``TCGA-06-0125``."""
    parts = barcode.split("-")
    return "-".join(parts[:3]) if len(parts) >= 3 else barcode


# ── Drug matching ────────────────────────────────────────────────────────────

def _match_drug_to_dcna(drug_name: str) -> Optional[str]:
    """Return the canonical DCNA key for a drug, or None."""
    _, dcna = _load_dcna()
    keys = set(dcna.keys())
    upper = drug_name.upper().strip()
    if upper in keys:
        return upper

    # Strip common salts
    SALTS = (" HYDROCHLORIDE", " MESYLATE", " PHOSPHATE", " SULFATE", " TOSYLATE",
             " MALEATE", " SUCCINATE", " CITRATE", " FUMARATE", " HCL", " HBR")
    stripped = upper
    for salt in SALTS:
        if stripped.endswith(salt):
            stripped = stripped[:-len(salt)].strip()
            break
    if stripped != upper and stripped in keys:
        return stripped

    # Try first word (base name)
    base = upper.split()[0] if " " in upper else None
    if base and base in keys:
        return base

    return None


# ── Scoring ──────────────────────────────────────────────────────────────────

@dataclass
class PatientScore:
    aliquot_barcode: str
    case_id: str
    dcna: float
    expression: float
    is_responder: bool


def score_patients_for_drug(
    drug_name: str,
    dcna_threshold: float,
    expression_threshold: float = 0.0,
) -> list[PatientScore]:
    """Score every TCGA patient for a given drug against the SATGBM rule.

    A patient is classified as a predicted *responder* iff::

        dcna_score > dcna_threshold AND avg_target_expression > expression_threshold

    This mirrors the upper-right-quadrant criterion used by the MOA simulation
    engine (see ``find_dcna_threshold`` in analysis/moa_simulation.py).
    """
    dcna_patients, dcna = _load_dcna()
    expr_patients, expr = _load_expression()
    targets = _load_drug_targets()

    canonical = _match_drug_to_dcna(drug_name)
    if canonical is None:
        logger.warning("Drug %r not found in DCNA data", drug_name)
        return []

    dcna_values = dcna[canonical]

    # Gene targets for this drug (case-insensitive match on expression keys)
    expr_keys_upper = {g.upper(): g for g in expr}
    target_genes: list[str] = []
    entry = targets.get(canonical) or targets.get(drug_name.upper()) or {}
    for t in entry.get("targets", []):
        gene = t.get("gene_symbol", "")
        key = expr_keys_upper.get(gene.upper())
        if key:
            target_genes.append(key)

    # Average expression across all target genes, per DCNA patient
    expr_idx = {p: i for i, p in enumerate(expr_patients)}
    if target_genes:
        gene_arrays = np.vstack([expr[g] for g in target_genes])  # (n_genes × n_patients)
        avg_expr_by_patient = gene_arrays.mean(axis=0)
    else:
        avg_expr_by_patient = None  # No expression signal -> treat as 0

    scores: list[PatientScore] = []
    for i, barcode in enumerate(dcna_patients):
        dcna_val = float(dcna_values[i])
        if avg_expr_by_patient is not None and barcode in expr_idx:
            exp_val = float(avg_expr_by_patient[expr_idx[barcode]])
        else:
            exp_val = 0.0

        is_resp = (dcna_val > dcna_threshold) and (exp_val > expression_threshold)
        scores.append(PatientScore(
            aliquot_barcode=barcode,
            case_id=_aliquot_to_case(barcode),
            dcna=dcna_val,
            expression=exp_val,
            is_responder=is_resp,
        ))
    return scores


def resolve_threshold_for_drug(
    drug_name: str,
    session: Session,
    moa_category: Optional[str] = None,
) -> tuple[float, Optional[str]]:
    """Find the best-available DCNA threshold for a drug.

    Strategy (first non-empty match wins):
      1. Explicit ``moa_category`` argument (with or without ``group:`` prefix).
      2. The drug's MOA from ``moa_annotations`` joined on ``interventions``.
      3. Median DCNA score for the drug (fallback; logs a warning).

    Returns ``(threshold, moa_category_used)``.
    """
    cache = _load_threshold_cache()

    def _lookup(key: str) -> Optional[float]:
        entry = cache.get(key) or cache.get(f"group:{key}")
        if entry and "threshold" in entry:
            return float(entry["threshold"])
        return None

    # 1. Explicit moa_category
    if moa_category:
        t = _lookup(moa_category)
        if t is not None:
            return t, moa_category

    # 2. Drug -> MOA via DB (a drug name may appear in multiple interventions)
    interventions = session.execute(
        select(InterventionRecord).where(InterventionRecord.name.ilike(drug_name))
    ).scalars().all()
    for intervention in interventions:
        annotations = session.execute(
            select(MOAAnnotationRecord).where(
                MOAAnnotationRecord.intervention_id == intervention.id
            )
        ).scalars().all()
        for ann in annotations:
            for key in (ann.moa_broad_category, ann.moa_short_form, ann.moa_category):
                if not key:
                    continue
                t = _lookup(key)
                if t is not None:
                    return t, key

    # 3. Fallback: median of the drug's own DCNA distribution
    canonical = _match_drug_to_dcna(drug_name)
    if canonical:
        _, dcna = _load_dcna()
        median = float(np.median(dcna[canonical]))
        logger.warning(
            "No cached MOA threshold for %r; falling back to median DCNA = %.4f",
            drug_name, median,
        )
        return median, None

    return 0.0, None


# ── Cohort + survival ────────────────────────────────────────────────────────

@dataclass
class ValidationResult:
    drug: str
    matched_dcna_drug: Optional[str]
    moa_category: Optional[str]
    dcna_threshold: float
    expression_threshold: float

    total_treated_patients: int      # unique cases that received this drug
    patients_in_cohort: int          # scored + survival present + in drug arm
    n_predicted_responders: int
    n_predicted_nonresponders: int

    # Events
    n_deaths_responders: int
    n_deaths_nonresponders: int

    # Medians (days)
    median_os_responders: Optional[float]
    median_os_nonresponders: Optional[float]

    # Tests
    logrank_p: Optional[float]
    hazard_ratio: Optional[float]        # HR of responder vs non-responder; <1 favours responders
    hr_ci_lower: Optional[float]
    hr_ci_upper: Optional[float]
    cox_p: Optional[float]

    # KM curves (survival probabilities over time); one entry per timepoint
    km_responders: list[dict] = field(default_factory=list)
    km_nonresponders: list[dict] = field(default_factory=list)

    warnings: list[str] = field(default_factory=list)


def _build_cohort_df(
    drug_name: str,
    session: Session,
    score_by_case: dict[str, PatientScore],
) -> pd.DataFrame:
    """Assemble patient-level rows: case_id, responder, time, event."""
    # All treatments for the drug (free-text match on raw agent string)
    drug_upper = drug_name.upper()
    treatments = session.execute(select(TCGATreatment)).scalars().all()
    treated_cases: set[str] = set()
    for t in treatments:
        raw = (t.therapeutic_agents_raw or "").upper().strip()
        if not raw:
            continue
        # Fuzzy match: drug_upper in raw OR raw in drug_upper (covers "IRINOTECAN" vs
        # "IRINOTECAN HYDROCHLORIDE")
        if drug_upper in raw or raw in drug_upper:
            treated_cases.add(t.case_submitter_id)

    # Pull patient survival data
    rows: list[dict] = []
    patients = session.execute(
        select(TCGAPatient).where(TCGAPatient.case_submitter_id.in_(treated_cases))
    ).scalars().all()

    for p in patients:
        score = score_by_case.get(p.case_submitter_id)
        if score is None:
            continue

        # Event time / status
        if p.vital_status == "Dead" and p.days_to_death is not None:
            time = float(p.days_to_death)
            event = 1
        elif p.days_to_last_follow_up is not None:
            time = float(p.days_to_last_follow_up)
            event = 0
        else:
            continue  # No usable survival info

        if time <= 0:
            continue

        rows.append(dict(
            case_id=p.case_submitter_id,
            responder=int(score.is_responder),
            time=time,
            event=event,
            dcna=score.dcna,
            expression=score.expression,
        ))

    return pd.DataFrame(rows)


def _km_curve_points(times: np.ndarray, events: np.ndarray) -> list[dict]:
    """Return [(time, survival_prob, n_at_risk), ...] — Kaplan-Meier estimator.

    Uses lifelines.KaplanMeierFitter.
    """
    from lifelines import KaplanMeierFitter

    if len(times) == 0:
        return []
    kmf = KaplanMeierFitter()
    kmf.fit(durations=times, event_observed=events)
    df = kmf.survival_function_.reset_index()
    df.columns = ["time", "survival"]
    # Attach n_at_risk
    # Use lifelines' estimate of subjects at risk
    events_table = kmf.event_table.reset_index()[["event_at", "at_risk"]]
    events_table.columns = ["time", "at_risk"]
    merged = df.merge(events_table, on="time", how="left").ffill()
    return [
        {"time": float(r["time"]), "survival": float(r["survival"]),
         "at_risk": int(r["at_risk"] or 0)}
        for _, r in merged.iterrows()
    ]


def validate_drug(
    drug_name: str,
    session: Session,
    *,
    moa_category: Optional[str] = None,
    dcna_threshold: Optional[float] = None,
    expression_threshold: float = 0.0,
) -> ValidationResult:
    """Run the full validation pipeline for a single drug.

    Parameters
    ----------
    drug_name
        Free-text drug name (e.g. "Bevacizumab"). Matched against DCNA data
        with salt-stripping and first-word fallback.
    session
        SQLAlchemy session bound to the pipeline DB.
    moa_category
        Optional override of the MOA category used to look up a threshold.
    dcna_threshold
        Optional explicit threshold; overrides any MOA lookup.
    expression_threshold
        Minimum average target-gene expression to call a responder (default 0).
    """
    warnings: list[str] = []

    # 1. Resolve drug
    canonical = _match_drug_to_dcna(drug_name)
    if canonical is None:
        return ValidationResult(
            drug=drug_name, matched_dcna_drug=None, moa_category=None,
            dcna_threshold=0.0, expression_threshold=expression_threshold,
            total_treated_patients=0, patients_in_cohort=0,
            n_predicted_responders=0, n_predicted_nonresponders=0,
            n_deaths_responders=0, n_deaths_nonresponders=0,
            median_os_responders=None, median_os_nonresponders=None,
            logrank_p=None, hazard_ratio=None,
            hr_ci_lower=None, hr_ci_upper=None, cox_p=None,
            warnings=[f"Drug {drug_name!r} not found in DCNA data"],
        )

    # 2. Resolve threshold
    if dcna_threshold is None:
        dcna_threshold, moa_used = resolve_threshold_for_drug(
            drug_name, session, moa_category=moa_category
        )
    else:
        moa_used = moa_category

    # 3. Score every TCGA patient
    scores = score_patients_for_drug(drug_name, dcna_threshold, expression_threshold)
    # Keep only one aliquot per case (first wins) to avoid dupes
    score_by_case: dict[str, PatientScore] = {}
    for s in scores:
        score_by_case.setdefault(s.case_id, s)

    # 4. Build cohort of patients who actually received the drug AND have survival data
    df = _build_cohort_df(drug_name, session, score_by_case)

    # count treated (before requiring survival data)
    total_treated = session.execute(
        select(TCGATreatment.case_submitter_id).where(
            TCGATreatment.therapeutic_agents_raw.ilike(f"%{drug_name}%")
        ).distinct()
    ).all()
    n_treated = len(total_treated)

    if df.empty:
        warnings.append("No treated patients have both scoring + survival data")
        return ValidationResult(
            drug=drug_name, matched_dcna_drug=canonical, moa_category=moa_used,
            dcna_threshold=dcna_threshold, expression_threshold=expression_threshold,
            total_treated_patients=n_treated, patients_in_cohort=0,
            n_predicted_responders=0, n_predicted_nonresponders=0,
            n_deaths_responders=0, n_deaths_nonresponders=0,
            median_os_responders=None, median_os_nonresponders=None,
            logrank_p=None, hazard_ratio=None,
            hr_ci_lower=None, hr_ci_upper=None, cox_p=None,
            warnings=warnings,
        )

    resp_df = df[df.responder == 1]
    nonresp_df = df[df.responder == 0]

    # 5. Survival stats
    from lifelines import CoxPHFitter, KaplanMeierFitter
    from lifelines.statistics import logrank_test

    median_resp = median_nonresp = None
    km_resp: list[dict] = []
    km_nonresp: list[dict] = []

    if len(resp_df) >= 1:
        kmf = KaplanMeierFitter()
        kmf.fit(resp_df.time.values, resp_df.event.values)
        median_resp = float(kmf.median_survival_time_) if not np.isnan(kmf.median_survival_time_) else None
        km_resp = _km_curve_points(resp_df.time.values, resp_df.event.values)

    if len(nonresp_df) >= 1:
        kmf = KaplanMeierFitter()
        kmf.fit(nonresp_df.time.values, nonresp_df.event.values)
        median_nonresp = float(kmf.median_survival_time_) if not np.isnan(kmf.median_survival_time_) else None
        km_nonresp = _km_curve_points(nonresp_df.time.values, nonresp_df.event.values)

    # Log-rank
    logrank_p = None
    if len(resp_df) >= 2 and len(nonresp_df) >= 2:
        try:
            lr = logrank_test(
                resp_df.time.values, nonresp_df.time.values,
                event_observed_A=resp_df.event.values,
                event_observed_B=nonresp_df.event.values,
            )
            logrank_p = float(lr.p_value)
        except Exception as e:
            warnings.append(f"Log-rank test failed: {e}")

    # Cox PH for hazard ratio
    hr = hr_lo = hr_hi = cox_p = None
    if len(resp_df) >= 2 and len(nonresp_df) >= 2:
        try:
            cph = CoxPHFitter()
            cph.fit(df[["time", "event", "responder"]], duration_col="time", event_col="event")
            summary = cph.summary.loc["responder"]
            hr = float(summary["exp(coef)"])
            hr_lo = float(summary["exp(coef) lower 95%"])
            hr_hi = float(summary["exp(coef) upper 95%"])
            cox_p = float(summary["p"])
        except Exception as e:
            warnings.append(f"Cox PH fit failed: {e}")

    return ValidationResult(
        drug=drug_name,
        matched_dcna_drug=canonical,
        moa_category=moa_used,
        dcna_threshold=dcna_threshold,
        expression_threshold=expression_threshold,
        total_treated_patients=n_treated,
        patients_in_cohort=len(df),
        n_predicted_responders=int((df.responder == 1).sum()),
        n_predicted_nonresponders=int((df.responder == 0).sum()),
        n_deaths_responders=int(resp_df.event.sum()),
        n_deaths_nonresponders=int(nonresp_df.event.sum()),
        median_os_responders=median_resp,
        median_os_nonresponders=median_nonresp,
        logrank_p=logrank_p,
        hazard_ratio=hr,
        hr_ci_lower=hr_lo,
        hr_ci_upper=hr_hi,
        cox_p=cox_p,
        km_responders=km_resp,
        km_nonresponders=km_nonresp,
        warnings=warnings,
    )
