"""Re-ingest GBM/glioma trials from ClinicalTrials.gov into the local database.

Runs the ClinicalTrialsConnector with MeSH expansion for "Glioblastoma" and
"Glioma", then upserts results via database.etl.load_trials.

Usage:
    python -m scripts.refresh_glioma_trials
"""
from __future__ import annotations

import asyncio
import logging
import sys
from types import SimpleNamespace

from connectors.clinicaltrials import ClinicalTrialsConnector
from database.engine import create_db_engine, get_session_factory, init_db
from database.etl import load_trials
from moa_classification.classifier import MOAClassifier
from scripts.backfill_outcome_results import run_backfill

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("refresh_glioma_trials")

DISEASES = ["Glioblastoma", "Glioma"]


async def fetch_all() -> list:
    connector = ClinicalTrialsConnector()
    seen: set[str] = set()
    merged: list = []
    for disease in DISEASES:
        logger.info("Fetching trials for %s", disease)
        trials = await connector.get_all_trials_for_disease(
            disease_input=disease,
            expand_terms=True,
        )
        for t in trials:
            if t.nct_id not in seen:
                seen.add(t.nct_id)
                merged.append(t)
        logger.info("Cumulative unique trials: %d", len(merged))
    return merged


async def _async_main() -> int:
    trials = await fetch_all()
    logger.info("Fetched %d unique trials total. Writing to database...", len(trials))

    engine = create_db_engine()
    SessionFactory = get_session_factory(engine)
    with SessionFactory() as session:
        records = load_trials(session, trials)
    logger.info("Persisted %d trial records.", len(records))

    logger.info("Backfilling outcome results from CT.gov v2 API...")
    backfill_args = SimpleNamespace(
        batch_size=25,
        delay=0.3,
        max_errors=10,
        resume=False,
        dry_run=False,
    )
    await run_backfill(backfill_args)

    logger.info("Classifying MOA for new interventions...")
    with SessionFactory() as session:
        classifier = MOAClassifier()
        moa_stats = await classifier.classify_all(session, force_reclassify=False)
        session.commit()
    logger.info("MOA classification stats: %s", moa_stats)

    logger.info("Running WHO 2021 CNS classification...")
    init_db(engine)  # ensures who_classifications table exists
    from analysis.who_extractor import classify_all_trials, save_who_profiles
    with SessionFactory() as session:
        profiles = classify_all_trials(session)
        if profiles:
            saved = save_who_profiles(session, profiles)
            session.commit()
            logger.info("Saved %d WHO classification records", saved)
        else:
            logger.warning("No trials found for WHO classification")

    logger.info("Refresh pipeline complete.")
    return 0


def main() -> int:
    return asyncio.run(_async_main())


if __name__ == "__main__":
    sys.exit(main())
