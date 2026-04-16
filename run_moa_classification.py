"""Run MOA classification for all interventions in the database.

Uses Open Targets Platform API as the primary MOA source, with ChEMBL
as a fallback. Converts long-form MOA descriptions to short-hand names
(e.g., "Poly [ADP-ribose] polymerase 1 inhibitor" -> "PARP1 inhibitor").

Usage:
    python run_moa_classification.py                  # classify new interventions only
    python run_moa_classification.py --force           # re-classify all interventions
    python run_moa_classification.py --lookup Erlotinib  # preview MOA for a single drug
    python run_moa_classification.py --config path/to/config.yaml  # custom config
"""

import argparse
import asyncio
import logging

from config.schema import load_config
from connectors.open_targets import OpenTargetsClient
from database.engine import create_db_engine, get_session_factory, init_db
from moa_classification.classifier import MOAClassifier
from moa_classification.moa_shorthand import group_moa_shorthands, resolve_shorthand


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def lookup_drug(drug_name: str) -> None:
    """Preview MOA resolution for a single drug (does not touch the database)."""
    print(f"\n{'='*60}")
    print(f"  Looking up: {drug_name}")
    print(f"{'='*60}")

    client = OpenTargetsClient()
    result = client.lookup_drug_moa(drug_name)

    if not result:
        print(f"  No results found in Open Targets for '{drug_name}'")
        return

    print(f"  ChEMBL ID:  {result.chembl_id}")
    print(f"  Drug Name:  {result.drug_name}")
    print(f"  MOAs found: {len(result.rows)}")
    print()

    shorthands = []
    for i, row in enumerate(result.rows, 1):
        gene_symbols = [t.approved_symbol for t in row.targets if t.approved_symbol]
        sh = resolve_shorthand(
            row.mechanism_of_action, row.action_type, gene_symbols
        )
        shorthands.append(sh)

        print(f"  [{i}] {row.mechanism_of_action}")
        print(f"      Action Type:    {row.action_type}")
        print(f"      Target:         {row.target_name}")
        print(f"      Gene Symbols:   {', '.join(gene_symbols) or '-'}")
        print(f"      Short Form:     {sh.short_form}")
        print(f"      Broad Category: {sh.broad_category}")
        print()

    groups = group_moa_shorthands(shorthands)
    print("  Grouped by broad category:")
    for broad, specifics in groups.items():
        print(f"    {broad}: {', '.join(specifics)}")
    print()


def run_classification(config_path: str | None, force: bool) -> None:
    """Run MOA classification for all interventions in the database."""
    config = load_config(config_path)

    engine = create_db_engine(config.database)
    init_db(engine)
    SessionFactory = get_session_factory(engine)

    session = SessionFactory()

    try:
        # Show intervention counts
        from database.models import InterventionRecord, MOAAnnotationRecord

        total_interventions = session.query(InterventionRecord).count()
        already_classified = (
            session.query(InterventionRecord.id)
            .join(MOAAnnotationRecord)
            .distinct()
            .count()
        )

        print(f"\n{'='*60}")
        print("  MOA Classification")
        print(f"{'='*60}")
        print(f"  Database:              {config.database.url}")
        print(f"  Total interventions:   {total_interventions}")
        print(f"  Already classified:    {already_classified}")
        print(f"  Unclassified:          {total_interventions - already_classified}")
        print(f"  Force re-classify:     {force}")
        print("  Primary source:        Open Targets Platform API")
        print("  Fallback source:       ChEMBL REST API")
        print(f"{'='*60}\n")

        if total_interventions == 0:
            print("  No interventions in database. Load trial data first.")
            return

        if not force and already_classified == total_interventions:
            print("  All interventions already classified. Use --force to re-classify.")
            return

        # Create classifier with defaults (Open Targets primary, ChEMBL fallback)
        classifier = MOAClassifier()

        # Run async classification
        stats = asyncio.run(classifier.classify_all(session, force_reclassify=force))

        print(f"\n{'='*60}")
        print("  Classification Results")
        print(f"{'='*60}")
        print(f"  Classified:  {stats['classified']}")
        print(f"  Skipped:     {stats['skipped']}")
        print(f"  Failed:      {stats['failed']}")
        print(f"{'='*60}\n")

        # Show summary of MOA categories
        from sqlalchemy import func

        moa_summary = (
            session.query(
                MOAAnnotationRecord.moa_category,
                MOAAnnotationRecord.moa_broad_category,
                func.count(MOAAnnotationRecord.id),
            )
            .group_by(
                MOAAnnotationRecord.moa_category,
                MOAAnnotationRecord.moa_broad_category,
            )
            .order_by(func.count(MOAAnnotationRecord.id).desc())
            .all()
        )

        if moa_summary:
            print("  MOA Category Summary:")
            print(f"  {'Category':<35} {'Broad':<25} {'Count':>5}")
            print(f"  {'-'*35} {'-'*25} {'-'*5}")
            for cat, broad, count in moa_summary:
                broad_str = broad if broad else "-"
                print(f"  {cat:<35} {broad_str:<25} {count:>5}")
            print()

        # Show data source breakdown
        source_summary = (
            session.query(
                MOAAnnotationRecord.data_source,
                func.count(MOAAnnotationRecord.id),
            )
            .group_by(MOAAnnotationRecord.data_source)
            .all()
        )
        if source_summary:
            print("  Data Source Breakdown:")
            for source, count in source_summary:
                print(f"    {source or 'unknown'}: {count}")
            print()

    finally:
        session.close()


def main():
    parser = argparse.ArgumentParser(
        description="Run MOA classification using Open Targets + ChEMBL"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-classify all interventions, even if already classified",
    )
    parser.add_argument(
        "--lookup", type=str, metavar="DRUG_NAME",
        help="Preview MOA for a single drug without modifying the database",
    )
    parser.add_argument(
        "--config", type=str, default=None,
        help="Path to pipeline config YAML (default: config/default_config.yaml)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Enable debug logging",
    )

    args = parser.parse_args()
    setup_logging(args.verbose)

    if args.lookup:
        lookup_drug(args.lookup)
    else:
        run_classification(args.config, args.force)


if __name__ == "__main__":
    main()
