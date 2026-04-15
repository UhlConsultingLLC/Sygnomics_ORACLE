"""Screen every outcome result row in the DB through the same Rate-column
logic the Trial Explorer UI uses, and flag any row where the computed Rate
would be inconsistent with the reported Value when the unit is a
percentage.

Mirrors ``computeRate()`` in ``frontend/src/pages/TrialDetail.tsx``:
  - If unit contains 'percent'/'%'/'proportion'/'fraction'/'rate':
      use value directly (×100 if 0–1 fractional).
  - Otherwise treat value as a count and divide by participants.

Run from project root:
    python -m scripts.screen_outcome_rates
"""

from __future__ import annotations

import json
import sys
from collections import Counter

from api.dependencies import get_engine, get_session_factory
from database.models import OutcomeRecord, TrialRecord


PERCENT_TOKENS = ("percent", "%", "proportion", "fraction", "rate")


def compute_rate(value, participants, unit):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    u = (unit or "").lower()
    if any(tok in u for tok in PERCENT_TOKENS):
        if 0 <= num <= 1:
            return num * 100.0
        if 1 < num <= 100:
            return num
        return None
    if not participants or participants == 0:
        return None
    if num != int(num) or num > participants:
        return None
    return (num / participants) * 100.0


def main():
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

    total_result_rows = 0
    percent_rows = 0
    suspicious: list[dict] = []
    unit_counts: Counter = Counter()

    for nct, measure, rj in rows:
        try:
            data = json.loads(rj) if isinstance(rj, str) else rj
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        for g in data:
            if not isinstance(g, dict):
                continue
            total_result_rows += 1
            unit = (g.get("unit") or "").strip()
            unit_counts[unit] += 1
            value = g.get("value")
            participants = g.get("participants_count")
            param_type = (g.get("param_type") or "").upper()

            u_low = unit.lower()
            is_percent = any(tok in u_low for tok in PERCENT_TOKENS)
            if not is_percent:
                continue
            percent_rows += 1

            try:
                num = float(value)
            except (TypeError, ValueError):
                continue

            rate = compute_rate(value, participants, unit)
            flag = None
            # Sanity 1: percentage value but rate is None (out of range)
            if rate is None and not (num == 0):
                flag = "percent unit but value out of 0-100 range"
            # Sanity 2: percentage value 1-100 but rate doesn't match value
            elif 1 < num <= 100 and rate is not None and abs(rate - num) > 0.01:
                flag = "percent rate != value"
            # Sanity 3: param_type COUNT_OF_PARTICIPANTS with percent unit —
            # the original bug. Verify rate uses value, not count division.
            elif param_type in ("COUNT_OF_PARTICIPANTS", "NUMBER") and participants:
                count_div = (num / participants) * 100.0 if num <= participants else None
                if count_div is not None and rate is not None and abs(rate - count_div) < 0.01 and abs(rate - num) > 0.01 and not (0 <= num <= 1):
                    flag = "rate computed via count-division instead of percent"

            if flag:
                suspicious.append({
                    "nct_id": nct,
                    "measure": measure,
                    "unit": unit,
                    "value": value,
                    "participants_count": participants,
                    "param_type": param_type,
                    "computed_rate": rate,
                    "flag": flag,
                })

    print(f"\nTotal result rows scanned:        {total_result_rows}")
    print(f"Rows with percentage-style unit:  {percent_rows}")
    print(f"Suspicious rows:                  {len(suspicious)}")

    print("\nTop unit strings (any):")
    for unit, n in unit_counts.most_common(15):
        marker = " *" if any(t in unit.lower() for t in PERCENT_TOKENS) else ""
        print(f"  {n:>6}  {unit!r}{marker}")

    if suspicious:
        print("\n--- Suspicious rows ---")
        for s in suspicious[:30]:
            print(
                f"  {s['nct_id']:<14} flag={s['flag']:<55} "
                f"unit={s['unit']!r} value={s['value']} pcount={s['participants_count']} "
                f"param_type={s['param_type']} rate={s['computed_rate']}"
            )
        if len(suspicious) > 30:
            print(f"  … and {len(suspicious) - 30} more")
        return 1
    print("\nNo suspicious rows. Rate column logic produces sane values for every percentage-unit row.")

    db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
