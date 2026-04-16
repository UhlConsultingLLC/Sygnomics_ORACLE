#!/usr/bin/env python3
"""Seed the database with a curated set of GBM demo trials.

Usage:
    python scripts/load_demo_data.py

Reads ``data/demo_trials.json`` (15 representative GBM clinical trials)
and **inserts only trials that don't already exist** in the local SQLite
database. Existing records are left untouched — this prevents the sparse
demo fixtures from overwriting richer records ingested from CT.gov
(which include arms, outcomes, sponsor data, and outcome results that
the demo JSON intentionally omits for brevity).

After running, start the backend (``uvicorn api.main:app --reload``) and
browse to http://localhost:5173 — the Trial Explorer, Disease Search,
and Analysis Dashboard pages will show data immediately.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure the repo root is on the Python path so imports work when
# running the script directly (``python scripts/load_demo_data.py``).
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from connectors.models.trial import Trial  # noqa: E402
from database.engine import create_db_engine, init_db  # noqa: E402
from database.etl import load_trials  # noqa: E402
from database.models import TrialRecord  # noqa: E402

DEMO_FILE = REPO_ROOT / "data" / "demo_trials.json"


def main() -> None:
    if not DEMO_FILE.exists():
        print(f"Demo file not found: {DEMO_FILE}")
        sys.exit(1)

    with open(DEMO_FILE, encoding="utf-8") as f:
        raw = json.load(f)

    engine = create_db_engine()
    init_db(engine)

    from sqlalchemy.orm import Session

    with Session(engine) as session:
        # Check which demo trials already exist so we don't overwrite
        # richer CT.gov-sourced records with sparse demo stubs.
        existing_ids = {
            nct_id
            for (nct_id,) in session.query(TrialRecord.nct_id)
            .filter(TrialRecord.nct_id.in_([t["nct_id"] for t in raw]))
            .all()
        }

        new_trials = [Trial(**t) for t in raw if t["nct_id"] not in existing_ids]
        skipped = len(raw) - len(new_trials)

        if skipped:
            print(f"Skipping {skipped} demo trial(s) already in the database.")
        if not new_trials:
            print("All demo trials already exist. Nothing to insert.")
            return

        print(f"Inserting {len(new_trials)} new demo trial(s)...")
        records = load_trials(session, new_trials)
        session.commit()
        print(f"Inserted {len(records)} trial records.")
        print("Done. Start the backend and browse to the UI to see the data.")


if __name__ == "__main__":
    main()
