#!/usr/bin/env python3
"""Seed the database with a curated set of GBM demo trials.

Usage:
    python scripts/load_demo_data.py

Reads ``data/demo_trials.json`` (15 representative GBM clinical trials)
and upserts them into the local SQLite database via the existing ETL
pipeline. Existing records with the same NCT ID are updated in place;
new records are inserted. The script is idempotent — running it twice
produces the same result.

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

DEMO_FILE = REPO_ROOT / "data" / "demo_trials.json"


def main() -> None:
    if not DEMO_FILE.exists():
        print(f"Demo file not found: {DEMO_FILE}")
        sys.exit(1)

    with open(DEMO_FILE, encoding="utf-8") as f:
        raw = json.load(f)

    trials = [Trial(**t) for t in raw]
    print(f"Loaded {len(trials)} demo trials from {DEMO_FILE.name}")

    engine = create_db_engine()
    init_db(engine)

    from sqlalchemy.orm import Session

    with Session(engine) as session:
        records = load_trials(session, trials)
        session.commit()
        print(f"Upserted {len(records)} trial records into the database.")
        print("Done. Start the backend and browse to the UI to see the data.")


if __name__ == "__main__":
    main()
