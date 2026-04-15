"""Pull TCGA patient demographics, diagnoses, and drug-level treatment records
from the GDC API and persist them to the pipeline SQLite database.

Populates two tables:

    * ``tcga_patients``   — one row per TCGA case (submitter_id)
    * ``tcga_treatments`` — one row per GDC treatment record (many-per-case)

The goal is to enable real-world outcome validation of SATGBM predictions
against TCGA patients' actual drug exposure and survival.

Idempotent: uses SQLite upsert semantics keyed by ``case_submitter_id``
(patients) and ``treatment_id`` (treatments) so the script can safely be
re-run.

Usage:
    python scripts/pull_tcga_treatments.py [--project TCGA-GBM]
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Iterator

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

# Ensure the project root is importable
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config.schema import DatabaseConfig  # noqa: E402
from database.engine import create_db_engine, get_session_factory, init_db  # noqa: E402
from database.models import TCGAPatient, TCGATreatment  # noqa: E402

GDC_API_BASE = "https://api.gdc.cancer.gov"
PAGE_SIZE = 100
REQUEST_TIMEOUT = 120.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("pull_tcga_treatments")


# ── GDC query ────────────────────────────────────────────────────────────────

def iter_cases(project: str) -> Iterator[dict]:
    """Yield every case in ``project`` with diagnoses, treatments, demographic, follow-ups."""
    offset = 0
    fields = ",".join([
        "submitter_id",
        "case_id",
        "demographic.gender",
        "demographic.race",
        "demographic.ethnicity",
        "demographic.vital_status",
        "demographic.days_to_death",
    ])
    expand = ",".join(["diagnoses", "diagnoses.treatments", "follow_ups", "demographic"])

    while True:
        params = {
            "filters": json.dumps(
                {"op": "=", "content": {"field": "project.project_id", "value": project}}
            ),
            "expand": expand,
            "fields": fields,
            "size": PAGE_SIZE,
            "from": offset,
            "format": "json",
        }
        resp = httpx.get(f"{GDC_API_BASE}/cases", params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        hits = data.get("data", {}).get("hits", []) or []
        if not hits:
            break
        for hit in hits:
            yield hit

        pagination = data.get("data", {}).get("pagination", {}) or {}
        total = pagination.get("total", 0)
        offset += PAGE_SIZE
        logger.info("Fetched %d / %d cases", min(offset, total), total)
        if offset >= total:
            break
        time.sleep(0.2)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _to_int(v) -> int | None:
    if v in (None, "", "not reported"):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _to_float(v) -> float | None:
    if v in (None, "", "not reported"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _route_list_to_str(v) -> str:
    if not v:
        return ""
    if isinstance(v, list):
        return ", ".join(str(x) for x in v if x)
    return str(v)


def _last_follow_up_days(case: dict) -> int | None:
    """Pick the maximum ``days_to_follow_up`` value across all follow_ups."""
    vals: list[int] = []
    for fu in case.get("follow_ups", []) or []:
        d = _to_int(fu.get("days_to_follow_up"))
        if d is not None:
            vals.append(d)
    return max(vals) if vals else None


# ── Upsert ───────────────────────────────────────────────────────────────────

def upsert_patient(session: Session, case: dict) -> None:
    sid = case.get("submitter_id", "")
    if not sid:
        return

    demo = case.get("demographic") or {}
    diagnoses = case.get("diagnoses") or []
    diag = diagnoses[0] if diagnoses else {}

    values = dict(
        case_submitter_id=sid,
        case_uuid=case.get("case_id", "") or "",
        project=(case.get("project") or {}).get("project_id") or "TCGA-GBM",
        primary_diagnosis=diag.get("primary_diagnosis", "") or "",
        tumor_grade=diag.get("tumor_grade", "") or "",
        age_at_diagnosis_days=_to_int(diag.get("age_at_diagnosis")),
        progression_or_recurrence=diag.get("progression_or_recurrence", "") or "",
        prior_treatment=diag.get("prior_treatment", "") or "",
        gender=demo.get("gender", "") or "",
        race=demo.get("race", "") or "",
        ethnicity=demo.get("ethnicity", "") or "",
        vital_status=demo.get("vital_status", "") or "",
        days_to_death=_to_int(demo.get("days_to_death")),
        days_to_last_follow_up=_last_follow_up_days(case),
    )

    stmt = sqlite_insert(TCGAPatient).values(**values)
    # On conflict on the PK (case_submitter_id), update every non-PK column
    update_cols = {k: stmt.excluded[k] for k in values if k != "case_submitter_id"}
    stmt = stmt.on_conflict_do_update(
        index_elements=["case_submitter_id"], set_=update_cols
    )
    session.execute(stmt)


def upsert_treatments(session: Session, case: dict) -> int:
    """Upsert every treatment row under ``case``. Returns count inserted/updated."""
    sid = case.get("submitter_id", "")
    if not sid:
        return 0

    n = 0
    for diag in case.get("diagnoses") or []:
        for tx in diag.get("treatments") or []:
            tid = tx.get("treatment_id") or ""
            if not tid:
                # Some records have no stable UUID — skip to avoid anonymous duplicates
                continue

            values = dict(
                case_submitter_id=sid,
                treatment_id=tid,
                treatment_submitter_id=tx.get("submitter_id", "") or "",
                therapeutic_agents_raw=(tx.get("therapeutic_agents") or "") or "",
                normalized_drug_name="",  # filled later by name-resolver pass
                treatment_type=tx.get("treatment_type", "") or "",
                treatment_or_therapy=tx.get("treatment_or_therapy", "") or "",
                initial_disease_status=tx.get("initial_disease_status", "") or "",
                number_of_cycles=_to_int(tx.get("number_of_cycles")),
                treatment_dose=_to_float(tx.get("treatment_dose")),
                treatment_dose_units=tx.get("treatment_dose_units", "") or "",
                route_of_administration=_route_list_to_str(tx.get("route_of_administration")),
                days_to_treatment_start=_to_int(tx.get("days_to_treatment_start")),
                days_to_treatment_end=_to_int(tx.get("days_to_treatment_end")),
            )

            stmt = sqlite_insert(TCGATreatment).values(**values)
            update_cols = {k: stmt.excluded[k] for k in values if k != "treatment_id"}
            stmt = stmt.on_conflict_do_update(
                index_elements=["treatment_id"], set_=update_cols
            )
            session.execute(stmt)
            n += 1
    return n


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project", default="TCGA-GBM", help="GDC project id (default: TCGA-GBM)"
    )
    args = parser.parse_args()

    # DB setup — init_db() will create_all() the new tables if absent
    cfg = DatabaseConfig()
    engine = create_db_engine(cfg)
    init_db(engine)
    Session = get_session_factory(engine)

    n_cases = 0
    n_tx = 0
    with Session() as session:
        for case in iter_cases(args.project):
            upsert_patient(session, case)
            n_tx += upsert_treatments(session, case)
            n_cases += 1
            # Commit every 50 cases so the DB isn't wiped by a transient crash
            if n_cases % 50 == 0:
                session.commit()
        session.commit()

    logger.info("Done. Upserted %d patients, %d treatment rows.", n_cases, n_tx)

    # Short verification summary
    with Session() as session:
        n_patients = session.execute(
            select(TCGAPatient).with_only_columns(TCGAPatient.case_submitter_id)
        ).all()
        n_with_vital = session.execute(
            select(TCGAPatient).where(TCGAPatient.vital_status != "")
        ).all()
        n_with_drug = session.execute(
            select(TCGATreatment).where(TCGATreatment.therapeutic_agents_raw != "")
        ).all()
    logger.info(
        "tcga_patients: %d  (%d with vital_status)   tcga_treatments: %d",
        len(n_patients),
        len(n_with_vital),
        n_tx,
    )
    logger.info("tcga_treatments with named drug: %d", len(n_with_drug))
    return 0


if __name__ == "__main__":
    sys.exit(main())
