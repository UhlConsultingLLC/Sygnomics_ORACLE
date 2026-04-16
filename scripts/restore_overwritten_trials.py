#!/usr/bin/env python3
"""One-off repair: delete the 15 demo-overwritten trial records so they
can be re-ingested from ClinicalTrials.gov with full arms + outcomes.

Background: load_demo_data.py (before the non-destructive fix) ran
ETL upsert on all 15 demo trials, overwriting the existing CT.gov
records that had rich arm, outcome, and sponsor data with the sparse
demo stubs (which carry only title, phase, and conditions).

This script:
1. Deletes the 15 affected trial records (+ all children) from the DB
   using raw SQL with proper FK ordering.
2. Prints the deleted NCT IDs so the user can re-ingest them via the
   Disease Search page or by re-running the conditions pipeline.

Usage:
    python scripts/restore_overwritten_trials.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from database.engine import create_db_engine, init_db  # noqa: E402

DEMO_FILE = REPO_ROOT / "data" / "demo_trials.json"

# Child tables that reference trials.nct_id — delete from these first
# to avoid FK violations. Order: deepest children first.
CHILD_TABLES = [
    "outcome_results",
    "outcomes",
    "arms",
    "eligibility",
    "locations",
    "trial_conditions",
    "trial_interventions",
    "moa_annotations",
    "who_classifications",
]


def main() -> None:
    if not DEMO_FILE.exists():
        print(f"Demo file not found: {DEMO_FILE}")
        sys.exit(1)

    with open(DEMO_FILE, encoding="utf-8") as f:
        demo_ids = [t["nct_id"] for t in json.load(f)]

    engine = create_db_engine()
    init_db(engine)

    from sqlalchemy import text

    with engine.begin() as conn:
        # Disable FK enforcement for the duration of this cleanup.
        # Re-enabled automatically at connection close.
        conn.execute(text("PRAGMA foreign_keys = OFF"))
        # Check which demo trials exist
        placeholders = ",".join(f"'{nid}'" for nid in demo_ids)
        existing = conn.execute(
            text(f"SELECT nct_id FROM trials WHERE nct_id IN ({placeholders})"),
        ).fetchall()
        found_ids = [row[0] for row in existing]

        if not found_ids:
            print("No demo-overwritten trials found in the database.")
            return

        print(f"Found {len(found_ids)} trial(s) to remove and re-ingest.")

        # Delete children first, then parent
        del_ph = ",".join(f"'{nid}'" for nid in found_ids)
        for table in CHILD_TABLES:
            try:
                conn.execute(text(f"DELETE FROM {table} WHERE trial_nct_id IN ({del_ph})"))
            except Exception:
                pass  # Table may not exist or have different FK name

        # Delete the trial records themselves
        conn.execute(text(f"DELETE FROM trials WHERE nct_id IN ({del_ph})"))

        print(f"Deleted {len(found_ids)} sparse trial records:")
        for nct_id in found_ids:
            print(f"  {nct_id}")

    print()
    print("To restore with full arms + outcomes, re-ingest from CT.gov:")
    print("  1. Open the app -> Disease Search -> type 'glioblastoma' -> Expand")
    print("  2. Click 'View matching trials in Trial Explorer'")
    print("  3. The app will re-fetch each trial with complete data from CT.gov")
    print()
    print("Or re-ingest a single trial:")
    print("  Trial Explorer -> enter NCT ID -> the detail page fetches fresh data")


if __name__ == "__main__":
    main()
