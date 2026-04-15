"""Screen all trials in the database for response-rate parsing issues.

Re-parses every trial outcome's results_json with the (now fixed)
``extract_response_rate`` and ``_extract_rr_from_group_entries`` functions
and prints any trials whose computed RR looks suspicious — specifically
trials where the unit string contains "percent" but the resulting rate is
outside a reasonable range, or where the rate appears to have been
divided twice (rate < 0.01 with a non-trivial raw value).

Run from the project root:

    python -m scripts.screen_response_rates [--csv out.csv]

Response rates are NOT stored in the database — they are recomputed on
demand from ``OutcomeRecord.results_json``.  This means the bug fix in
``analysis/moa_simulation.py`` automatically applies to every existing
trial without requiring a database migration.  This script just verifies
that the corrected parser produces sane values across the whole corpus.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter

from api.dependencies import get_engine, get_session_factory
from analysis.moa_simulation import (
    extract_response_rate,
    _classify_unit,
)
from database.models import OutcomeRecord, TrialRecord


RESPONSE_KEYWORDS = (
    "response", "responder", "remission", "ORR", "objective response",
    "complete response", "partial response", "disease control",
)


def looks_like_response_outcome(measure: str) -> bool:
    m = (measure or "").lower()
    return any(k.lower() in m for k in RESPONSE_KEYWORDS)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", help="Optional path to write a CSV report")
    ap.add_argument("--limit", type=int, default=None, help="Stop after N trials")
    args = ap.parse_args()

    engine = get_engine()
    Session = get_session_factory(engine)
    db = Session()

    rows = (
        db.query(TrialRecord.nct_id, OutcomeRecord.measure, OutcomeRecord.results_json)
        .join(OutcomeRecord, OutcomeRecord.trial_nct_id == TrialRecord.nct_id)
        .filter(OutcomeRecord.results_json != "")
        .all()
    )
    print(f"Loaded {len(rows)} outcome rows from {db.query(TrialRecord).count()} trials")

    suspicious: list[dict] = []
    unit_counts: Counter = Counter()
    parsed_count = 0
    response_outcome_count = 0
    seen = 0

    for nct, measure, rj in rows:
        seen += 1
        if args.limit and seen > args.limit:
            break
        if not looks_like_response_outcome(measure):
            continue
        response_outcome_count += 1
        try:
            data = json.loads(rj) if isinstance(rj, str) else rj
        except Exception:
            continue
        if not isinstance(data, list) or not data:
            continue

        # Track unit usage
        for g in data:
            unit_counts[(g.get("unit") or "").strip()] += 1

        rate = extract_response_rate(rj, measure)
        if rate is None:
            continue
        parsed_count += 1

        # Heuristic checks for the original bug
        first_value = None
        first_unit = ""
        first_pcount = None
        for g in data:
            try:
                first_value = float(str(g.get("value", "")).strip())
                first_unit = (g.get("unit") or "").lower()
                first_pcount = g.get("participants_count")
                break
            except Exception:
                continue
        if first_value is None:
            continue
        unit_class = _classify_unit(first_unit)

        flag = None
        # Bug signature: percentage unit + rate suspiciously small (would
        # indicate the value was divided twice).
        if unit_class == "percentage" and first_value > 1 and rate < first_value / 100.0 * 0.5:
            flag = "percentage divided twice"
        # Sanity: unit says percentage but parsed rate < 0.001 with a real value
        elif unit_class == "percentage" and first_value >= 1 and rate < 0.005:
            flag = "percentage parsed near zero"
        # Sanity: parsed rate > 1 (proportions must be 0-1)
        elif rate > 1:
            flag = "rate > 1"

        if flag:
            suspicious.append({
                "nct_id": nct,
                "measure": measure,
                "unit": first_unit,
                "raw_value": first_value,
                "participants_count": first_pcount,
                "parsed_rate": rate,
                "flag": flag,
            })

    print(f"\nResponse-keyword outcomes scanned: {response_outcome_count}")
    print(f"Successfully parsed RR:           {parsed_count}")
    print(f"Suspicious entries:               {len(suspicious)}")

    print("\nTop unit strings observed:")
    for unit, n in unit_counts.most_common(15):
        print(f"  {n:>6}  {unit!r:<40} -> classified as '{_classify_unit(unit)}'")

    if suspicious:
        print("\n--- Suspicious entries ---")
        for s in suspicious[:25]:
            print(
                f"  {s['nct_id']:<14} flag={s['flag']:<28} "
                f"unit={s['unit']!r:<32} value={s['raw_value']} "
                f"pcount={s['participants_count']} rate={s['parsed_rate']}"
            )
        if len(suspicious) > 25:
            print(f"  … and {len(suspicious) - 25} more")
    else:
        print("\nNo suspicious entries detected.  Parser is producing sane values for all response outcomes.")

    if args.csv and suspicious:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(suspicious[0].keys()))
            writer.writeheader()
            writer.writerows(suspicious)
        print(f"\nReport written to {args.csv}")

    db.close()
    return 0 if not suspicious else 1


if __name__ == "__main__":
    sys.exit(main())
