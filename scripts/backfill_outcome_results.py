#!/usr/bin/env python3
"""Bulk-fetch outcome results data from ClinicalTrials.gov for all trials in the DB.

Iterates through every trial that has outcome records but missing results_json,
fetches the full study record from CT.gov's v2 API, and populates results_json
for any outcomes whose measure titles match.

Usage:
    python scripts/backfill_outcome_results.py [OPTIONS]

Options:
    --batch-size N     Trials per commit batch (default: 25)
    --delay SECONDS    Delay between API requests (default: 0.3)
    --max-errors N     Stop after N consecutive failures (default: 10)
    --resume           Skip trials already attempted this run (uses progress file)
    --dry-run          Fetch but don't write to DB
"""

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from sqlalchemy import distinct, func

from connectors.clinicaltrials import _fetch_json, _parse_outcome_results
from database.engine import create_db_engine, get_session_factory, init_db
from database.models import OutcomeRecord

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

PROGRESS_FILE = PROJECT_ROOT / "data" / "backfill_progress.json"


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"completed": [], "no_results": [], "failed": []}


def save_progress(progress: dict):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)


def fetch_results_section(nct_id: str) -> dict:
    """Fetch only the resultsSection for a trial from CT.gov v2 API.

    Uses a targeted field query to minimize bandwidth.
    """
    url = f"https://clinicaltrials.gov/api/v2/studies/{nct_id}"
    params = {
        "format": "json",
        "fields": "NCTId,ResultsSection",
    }
    data = _fetch_json(url, params)
    return data.get("resultsSection", {})


def get_trials_needing_results(session) -> list[str]:
    """Find all trial NCT IDs that have outcomes but no results_json populated."""
    rows = (
        session.query(distinct(OutcomeRecord.trial_nct_id))
        .filter(
            (OutcomeRecord.results_json.is_(None))
            | (OutcomeRecord.results_json == "")
            | (func.length(OutcomeRecord.results_json) < 3)
        )
        .filter(~OutcomeRecord.trial_nct_id.like("EUCT-%"))
        .all()
    )
    return [r[0] for r in rows]


def update_trial_outcomes(session, nct_id: str, result_data: dict[str, list[dict]]) -> int:
    """Write results_json for matching outcome records. Returns count updated."""
    updated = 0
    outcomes = (
        session.query(OutcomeRecord)
        .filter_by(trial_nct_id=nct_id)
        .all()
    )
    for outcome in outcomes:
        results = result_data.get(outcome.measure)
        if results:
            outcome.results_json = json.dumps(results)
            updated += 1
    return updated


async def run_backfill(args):
    engine = create_db_engine()
    init_db(engine)
    SessionFactory = get_session_factory(engine)
    session = SessionFactory()

    progress = load_progress() if args.resume else {"completed": [], "no_results": [], "failed": []}
    skip_set = set(progress["completed"] + progress["no_results"] + progress["failed"])

    # Get list of trials to process
    all_nct_ids = get_trials_needing_results(session)
    logger.info("Found %d trials with outcomes missing results_json", len(all_nct_ids))

    if args.resume and skip_set:
        all_nct_ids = [nid for nid in all_nct_ids if nid not in skip_set]
        logger.info("Resuming — %d trials remaining after skipping %d already processed",
                     len(all_nct_ids), len(skip_set))

    if not all_nct_ids:
        logger.info("Nothing to do — all outcome records already have results or no trials need processing.")
        session.close()
        return

    total = len(all_nct_ids)
    updated_total = 0
    no_results_total = 0
    failed_total = 0
    consecutive_failures = 0
    batch_count = 0

    start_time = time.time()

    for i, nct_id in enumerate(all_nct_ids, 1):
        try:
            # Fetch from CT.gov (synchronous urllib, run in thread for cleanliness)
            loop = asyncio.get_event_loop()
            results_section = await loop.run_in_executor(None, fetch_results_section, nct_id)

            if not results_section:
                # Trial has no results posted on CT.gov
                progress["no_results"].append(nct_id)
                no_results_total += 1
                consecutive_failures = 0
                if i % 50 == 0 or i == total:
                    logger.info(
                        "[%d/%d] %s — no results on CT.gov  (updated: %d, no_results: %d, failed: %d)",
                        i, total, nct_id, updated_total, no_results_total, failed_total,
                    )
            else:
                # Parse outcome results
                result_data = _parse_outcome_results(results_section)

                if not args.dry_run:
                    count = update_trial_outcomes(session, nct_id, result_data)
                    batch_count += count
                    updated_total += count if count > 0 else 0
                else:
                    count = len(result_data)
                    updated_total += count

                progress["completed"].append(nct_id)
                consecutive_failures = 0

                if count > 0:
                    logger.info(
                        "[%d/%d] %s — updated %d outcome(s)  (total updated: %d)",
                        i, total, nct_id, count, updated_total,
                    )
                else:
                    # Has results section but no measures matched our DB records
                    progress["no_results"].append(nct_id)
                    no_results_total += 1

        except Exception as e:
            progress["failed"].append(nct_id)
            failed_total += 1
            consecutive_failures += 1
            logger.warning("[%d/%d] %s — FAILED: %s", i, total, nct_id, e)

            if consecutive_failures >= args.max_errors:
                logger.error(
                    "Stopping after %d consecutive failures. Last error: %s",
                    args.max_errors, e,
                )
                break

        # Commit in batches
        if not args.dry_run and batch_count >= args.batch_size:
            session.commit()
            batch_count = 0

        # Save progress periodically
        if i % 50 == 0:
            save_progress(progress)

        # Rate limiting
        await asyncio.sleep(args.delay)

    # Final commit and progress save
    if not args.dry_run:
        session.commit()
    save_progress(progress)

    elapsed = time.time() - start_time
    logger.info("=" * 60)
    logger.info("Backfill complete in %.1f minutes", elapsed / 60)
    logger.info("  Trials processed:    %d / %d", i, total)
    logger.info("  Outcomes updated:    %d", updated_total)
    logger.info("  No results on CT.gov: %d", no_results_total)
    logger.info("  Failed:              %d", failed_total)
    logger.info("  Progress saved to:   %s", PROGRESS_FILE)

    session.close()


def main():
    parser = argparse.ArgumentParser(
        description="Backfill outcome results from ClinicalTrials.gov for all trials in the database."
    )
    parser.add_argument(
        "--batch-size", type=int, default=25,
        help="Number of trials to process before committing to DB (default: 25)",
    )
    parser.add_argument(
        "--delay", type=float, default=0.3,
        help="Seconds to wait between API requests (default: 0.3)",
    )
    parser.add_argument(
        "--max-errors", type=int, default=10,
        help="Stop after N consecutive API failures (default: 10)",
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Resume from previous run using progress file",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Fetch data but don't write to the database",
    )
    args = parser.parse_args()

    asyncio.run(run_backfill(args))


if __name__ == "__main__":
    main()
