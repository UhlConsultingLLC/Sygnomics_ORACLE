#!/usr/bin/env python3
"""Re-ingest the 15 demo trials from ClinicalTrials.gov with full data.

Companion to scripts/restore_overwritten_trials.py. After that script deletes
the sparse demo records, this one re-fetches each NCT ID from CT.gov's v2 API
(so arms, outcomes, sponsors, eligibility, and locations come back) and then
runs outcome-results backfill, MOA classification, and WHO 2021 classification
scoped to just those 15 trials.

Usage:
    python -m scripts.reingest_demo_trials
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from connectors.clinicaltrials import (  # noqa: E402
    ClinicalTrialsConnector,
    _fetch_json,
    _parse_outcome_results,
)
from database.engine import create_db_engine, get_session_factory, init_db  # noqa: E402
from database.etl import load_trials  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("reingest_demo_trials")

DEMO_FILE = PROJECT_ROOT / "data" / "demo_trials.json"


async def fetch_demo_trials(nct_ids: list[str]) -> list:
    """Fetch full trial records for the given NCT IDs."""
    connector = ClinicalTrialsConnector()
    trials = []
    for nct_id in nct_ids:
        logger.info("Fetching %s", nct_id)
        trial = await connector.get_trial_details(nct_id)
        if trial is None:
            logger.warning("  %s not returned by CT.gov — skipping", nct_id)
            continue
        trials.append(trial)
    return trials


def backfill_outcome_results(session, nct_ids: list[str]) -> int:
    """Populate results_json on OutcomeRecord rows for the given trials."""
    from database.models import OutcomeRecord

    updated = 0
    for nct_id in nct_ids:
        url = f"https://clinicaltrials.gov/api/v2/studies/{nct_id}"
        try:
            data = _fetch_json(url, {"format": "json", "fields": "NCTId,ResultsSection"})
        except Exception as e:  # noqa: BLE001
            logger.warning("  %s: failed to fetch results section: %s", nct_id, e)
            continue

        results_section = data.get("resultsSection") or {}
        if not results_section:
            logger.info("  %s: no results posted on CT.gov", nct_id)
            continue

        result_data = _parse_outcome_results(results_section)
        outcomes = session.query(OutcomeRecord).filter_by(trial_nct_id=nct_id).all()
        trial_updated = 0
        for outcome in outcomes:
            results = result_data.get(outcome.measure)
            if results:
                outcome.results_json = json.dumps(results)
                trial_updated += 1
        if trial_updated:
            logger.info("  %s: updated %d outcome(s) with results_json", nct_id, trial_updated)
            updated += trial_updated

    return updated


async def run_moa_classification(session) -> dict:
    """Classify any interventions lacking MOA annotations (naturally scoped)."""
    from moa_classification.classifier import MOAClassifier

    classifier = MOAClassifier()
    stats = await classifier.classify_all(session, force_reclassify=False)
    return stats


def run_who_classification(session, nct_ids: list[str]) -> int:
    """WHO 2021 classify only the given trials; upsert into who_classifications."""
    from analysis.who_extractor import classify_trial_who, save_who_profiles
    from database.models import EligibilityRecord, TrialRecord

    profiles = []
    for nct_id in nct_ids:
        trial = session.query(TrialRecord).filter_by(nct_id=nct_id).first()
        if trial is None:
            continue
        elig = session.query(EligibilityRecord).filter_by(trial_nct_id=nct_id).first()
        criteria_text = elig.criteria_text if elig else ""
        profile = classify_trial_who(
            criteria_text=criteria_text,
            nct_id=trial.nct_id,
            title=trial.title,
            conditions=[c.name for c in trial.conditions],
        )
        profiles.append(profile)

    if not profiles:
        return 0
    return save_who_profiles(session, profiles)


async def _async_main() -> int:
    if not DEMO_FILE.exists():
        logger.error("Demo file not found: %s", DEMO_FILE)
        return 1

    with open(DEMO_FILE, encoding="utf-8") as f:
        nct_ids = [t["nct_id"] for t in json.load(f)]

    logger.info("Re-ingesting %d demo trials", len(nct_ids))

    # Step 1: fetch full records from CT.gov
    trials = await fetch_demo_trials(nct_ids)
    if not trials:
        logger.error("No trials fetched from CT.gov — aborting")
        return 1
    logger.info("Fetched %d/%d trial records", len(trials), len(nct_ids))

    engine = create_db_engine()
    init_db(engine)
    SessionFactory = get_session_factory(engine)

    # Step 2: upsert via ETL
    with SessionFactory() as session:
        records = load_trials(session, trials)
        logger.info("Persisted %d trial records", len(records))

    # Step 3: backfill outcome_results for just these NCT IDs
    with SessionFactory() as session:
        updated = backfill_outcome_results(session, nct_ids)
        session.commit()
        logger.info("Backfilled outcome_results: %d rows updated", updated)

    # Step 4: MOA classification (skip-existing default scopes to new interventions)
    with SessionFactory() as session:
        moa_stats = await run_moa_classification(session)
        logger.info("MOA classification stats: %s", moa_stats)

    # Step 5: WHO 2021 classification — scoped to these 15
    with SessionFactory() as session:
        saved = run_who_classification(session, nct_ids)
        session.commit()
        logger.info("WHO classifications saved/updated: %d", saved)

    logger.info("Re-ingest complete.")
    return 0


def main() -> int:
    return asyncio.run(_async_main())


if __name__ == "__main__":
    sys.exit(main())
