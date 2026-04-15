"""Batch-lookup drug-gene target associations via Open Targets Platform.

Reads all drugs from the TCGA DCNA CSV, queries Open Targets for each,
and saves results to data/drug_targets_cache.json.

Supports resuming — skips drugs already in the cache file.

Usage:
    python scripts/build_drug_targets_cache.py
"""

import csv
import json
import os
import sys
import time

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from connectors.open_targets import OpenTargetsClient

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DCNA_PATH = os.path.join(DATA_DIR, "tcga_dcna.csv")
CACHE_PATH = os.path.join(DATA_DIR, "drug_targets_cache.json")

# Rate limiting: Open Targets public API is generous but let's be polite
DELAY_BETWEEN_DRUGS = 0.15  # seconds between drug lookups


def load_dcna_drugs() -> list[str]:
    """Load all drug names from the DCNA CSV."""
    with open(DCNA_PATH, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        return [row[0] for row in reader]


def load_existing_cache() -> dict:
    """Load existing cache file if present."""
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict):
    """Save cache to disk."""
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


def lookup_drug(client: OpenTargetsClient, drug_name: str) -> dict:
    """Look up a single drug and return target info dict."""
    # Try the drug name as-is first (uppercase from CSV), then title case
    moa = client.lookup_drug_moa(drug_name)
    if not moa and drug_name != drug_name.title():
        moa = client.lookup_drug_moa(drug_name.title())
    if not moa and drug_name != drug_name.lower():
        moa = client.lookup_drug_moa(drug_name.lower())

    if not moa or not moa.rows:
        return {"chembl_id": moa.chembl_id if moa else "", "targets": []}

    targets = []
    seen = set()
    for row in moa.rows:
        for t in row.targets:
            key = (t.approved_symbol, row.action_type)
            if key not in seen and t.approved_symbol:
                seen.add(key)
                targets.append({
                    "gene_symbol": t.approved_symbol,
                    "ensembl_id": t.ensembl_id,
                    "action_type": row.action_type or "",
                    "approved_name": t.approved_name or "",
                })

    return {
        "chembl_id": moa.chembl_id,
        "drug_name_ot": moa.drug_name,
        "targets": targets,
    }


def main():
    drugs = load_dcna_drugs()
    cache = load_existing_cache()
    client = OpenTargetsClient()

    # Determine which drugs still need lookup
    pending = [d for d in drugs if d not in cache]
    total = len(drugs)
    already_done = total - len(pending)

    print(f"Total DCNA drugs: {total}")
    print(f"Already cached: {already_done}")
    print(f"Pending lookup: {len(pending)}")
    print()

    if not pending:
        # Print summary
        with_targets = sum(1 for d in cache.values() if d.get("targets"))
        print(f"All drugs cached. {with_targets}/{total} have gene targets.")
        return

    found_count = 0
    error_count = 0
    save_interval = 50  # Save to disk every N drugs

    for i, drug in enumerate(pending):
        try:
            result = lookup_drug(client, drug)
            cache[drug] = result

            n_targets = len(result.get("targets", []))
            if n_targets > 0:
                found_count += 1
                symbols = [t["gene_symbol"] for t in result["targets"]]
                suffix = "..." if len(symbols) > 5 else ""
                print(f"[{already_done + i + 1}/{total}] {drug}: {n_targets} targets ({', '.join(symbols[:5])}{suffix})")
            else:
                if (i + 1) % 100 == 0:
                    print(f"[{already_done + i + 1}/{total}] {drug}: no targets (progress update)")

        except Exception as e:
            cache[drug] = {"chembl_id": "", "targets": [], "error": str(e)}
            error_count += 1
            if error_count % 10 == 0:
                print(f"[{already_done + i + 1}/{total}] {drug}: ERROR - {e}")

        # Periodic save
        if (i + 1) % save_interval == 0:
            save_cache(cache)

        time.sleep(DELAY_BETWEEN_DRUGS)

    # Final save
    save_cache(cache)

    with_targets = sum(1 for d in cache.values() if d.get("targets"))
    print()
    print(f"Done! {with_targets}/{total} drugs have gene targets.")
    print(f"Errors: {error_count}")
    print(f"Cache saved to: {CACHE_PATH}")


if __name__ == "__main__":
    main()
