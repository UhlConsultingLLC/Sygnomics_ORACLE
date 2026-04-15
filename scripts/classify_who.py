"""Run WHO 2021 CNS classification across all trials in the database.

Usage:
    python -m scripts.classify_who [--limit N] [--verbose]

Classifies each trial's eligibility criteria and conditions to determine
which WHO 2021 glioma subtypes the trial targets. Results are stored in
the `who_classifications` table.
"""

import argparse
import logging
import sys
from pathlib import Path

# Ensure project root is on sys.path
project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from config.schema import load_config
from database.engine import create_db_engine, get_session_factory, init_db


def main():
    parser = argparse.ArgumentParser(description="WHO 2021 CNS classification for all trials")
    parser.add_argument("--limit", type=int, default=None, help="Max trials to process")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger = logging.getLogger(__name__)

    # Load config and connect to DB
    config = load_config()
    engine = create_db_engine(config.database)
    init_db(engine)  # Ensures who_classifications table exists
    Session = get_session_factory(engine)

    with Session() as session:
        from analysis.who_extractor import classify_all_trials, save_who_profiles

        logger.info("Starting WHO 2021 classification...")
        profiles = classify_all_trials(session, limit=args.limit)

        if not profiles:
            logger.warning("No trials found to classify")
            return

        # Save to database
        saved = save_who_profiles(session, profiles)
        logger.info("Saved %d WHO classification records", saved)

        # Print summary report
        print("\n" + "=" * 70)
        print("WHO 2021 CNS CLASSIFICATION REPORT")
        print("=" * 70)
        print(f"Total trials classified: {len(profiles)}")

        # Type distribution
        type_counts: dict[str, int] = {}
        for p in profiles:
            for t in p.target_who_types:
                type_counts[t] = type_counts.get(t, 0) + 1

        print("\nWHO 2021 Subtype Distribution (trials may target multiple types):")
        for t, count in sorted(type_counts.items(), key=lambda x: -x[1]):
            pct = 100 * count / len(profiles)
            print(f"  {t:55s}  {count:4d}  ({pct:5.1f}%)")

        # Confidence distribution
        conf_counts: dict[str, int] = {}
        for p in profiles:
            conf_counts[p.confidence] = conf_counts.get(p.confidence, 0) + 1

        print("\nClassification Confidence:")
        for c in ["high", "medium", "low"]:
            count = conf_counts.get(c, 0)
            pct = 100 * count / len(profiles)
            print(f"  {c:10s}  {count:4d}  ({pct:5.1f}%)")

        # IDH status distribution
        idh_counts: dict[str, int] = {}
        for p in profiles:
            idh_counts[p.idh_status] = idh_counts.get(p.idh_status, 0) + 1

        print("\nIDH Status Requirement:")
        for status in ["required", "excluded", "any", "mentioned", "unknown"]:
            count = idh_counts.get(status, 0)
            if count:
                pct = 100 * count / len(profiles)
                print(f"  {status:12s}  {count:4d}  ({pct:5.1f}%)")

        # Molecular stratification summary
        mol_fields = [
            ("idh_status", "IDH"),
            ("codeletion_1p19q", "1p/19q"),
            ("mgmt_status", "MGMT"),
            ("cdkn2a_status", "CDKN2A"),
            ("h3k27m_status", "H3K27M"),
        ]
        print("\nMolecular Requirement Summary:")
        print(f"  {'Marker':12s}  {'Required':>8s}  {'Excluded':>8s}  {'Any':>8s}  {'Mentioned':>9s}  {'Unknown':>7s}")
        for field, label in mol_fields:
            counts = {}
            for p in profiles:
                val = getattr(p, field)
                counts[val] = counts.get(val, 0) + 1
            print(
                f"  {label:12s}  "
                f"{counts.get('required', 0):>8d}  "
                f"{counts.get('excluded', 0):>8d}  "
                f"{counts.get('any', 0):>8d}  "
                f"{counts.get('mentioned', 0):>9d}  "
                f"{counts.get('unknown', 0):>7d}"
            )

        # Grade range distribution
        grade_counts: dict[str, int] = {}
        for p in profiles:
            key = f"{p.who_grade_min}-{p.who_grade_max}"
            grade_counts[key] = grade_counts.get(key, 0) + 1

        print("\nGrade Range Distribution:")
        for grade_range, count in sorted(grade_counts.items(), key=lambda x: -x[1])[:10]:
            pct = 100 * count / len(profiles)
            print(f"  {grade_range:25s}  {count:4d}  ({pct:5.1f}%)")

        # High-confidence examples
        high_conf = [p for p in profiles if p.confidence == "high"]
        if high_conf:
            print("\nSample High-Confidence Classifications (up to 10):")
            for p in high_conf[:10]:
                types_str = ", ".join(p.target_who_types)
                print(f"  {p.nct_id:15s}  IDH={p.idh_status:8s}  -> {types_str}")
                if p.evidence:
                    print(f"  {'':15s}  Evidence: {p.evidence[0]}")

        print("\n" + "=" * 70)


if __name__ == "__main__":
    main()
