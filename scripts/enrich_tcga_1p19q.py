"""
One-shot script: enrich data/tcga_patient_biomarkers.json with 1p/19q
codeletion status inferred from GDC gene-level CNV data.

Strategy:
  1p/19q codeletion is inferred by checking sentinel genes on each arm:
    - 1p arm: FUBP1, CAMTA1, CHD5 (commonly lost in 1p deletion)
    - 19q arm: CIC, TGFB1 (commonly lost in 19q deletion)
  If at least one gene on each arm shows "Loss", the patient is marked
  as "codeleted". Otherwise "intact".

  As a secondary check, IDH1/IDH2 mutation status is considered since
  1p/19q codeletion in gliomas is essentially always IDH-mutant.

This script:
  1. Loads the existing patient biomarker JSON
  2. Queries GDC for CNV data on sentinel 1p and 19q genes
  3. Sets `clinical.codeletion_1p19q` to "codeleted" or "intact"
  4. Updates the CNV dict with the new gene data
  5. Writes the file back in place

Usage:
    python scripts/enrich_tcga_1p19q.py
"""
from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
BIO_PATH = ROOT / "data" / "tcga_patient_biomarkers.json"
GDC_API_BASE = "https://api.gdc.cancer.gov"
PROJECT = "TCGA-GBM"
PAGE_SIZE = 5000

# Sentinel genes for 1p/19q codeletion inference
GENES_1P = ["FUBP1", "CAMTA1", "CHD5"]   # located on chromosome 1p
GENES_19Q = ["CIC", "TGFB1"]              # located on chromosome 19q
ALL_SENTINEL_GENES = GENES_1P + GENES_19Q


def fetch_sentinel_cnv() -> dict[str, dict[str, str]]:
    """Query GDC for CNV on sentinel 1p/19q genes.

    Returns: {submitter_id: {gene: cnv_change, ...}}
    """
    cnv_data: dict[str, dict[str, str]] = defaultdict(dict)
    offset = 0

    while True:
        params = {
            "filters": json.dumps({
                "op": "and",
                "content": [
                    {
                        "op": "=",
                        "content": {
                            "field": "case.project.project_id",
                            "value": PROJECT,
                        },
                    },
                    {
                        "op": "in",
                        "content": {
                            "field": "cnv.consequence.gene.symbol",
                            "value": ALL_SENTINEL_GENES,
                        },
                    },
                ],
            }),
            "fields": ",".join([
                "case.submitter_id",
                "cnv.cnv_change",
                "cnv.consequence.gene.symbol",
            ]),
            "size": PAGE_SIZE,
            "from": offset,
        }

        resp = httpx.get(f"{GDC_API_BASE}/cnv_occurrences", params=params, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        hits = data.get("data", {}).get("hits", []) or []
        if not hits:
            break

        for hit in hits:
            case_id = (hit.get("case") or {}).get("submitter_id", "")
            if not case_id:
                continue
            cnv = hit.get("cnv") or {}
            cnv_change = cnv.get("cnv_change", "")
            for csq in (cnv.get("consequence") or []):
                gene = (csq.get("gene") or {}).get("symbol", "")
                if gene and cnv_change:
                    # Keep "Loss" over other changes
                    existing = cnv_data[case_id].get(gene, "")
                    if not existing or cnv_change == "Loss":
                        cnv_data[case_id][gene] = cnv_change

        offset += PAGE_SIZE
        pagination = data.get("data", {}).get("pagination", {}) or {}
        total = pagination.get("total", 0)
        print(f"  fetched {min(offset, total)}/{total} CNV occurrences")
        if offset >= total:
            break
        time.sleep(0.3)

    return dict(cnv_data)


def infer_codeletion(sentinel_cnv: dict[str, str]) -> str:
    """Given a patient's sentinel gene CNV dict, infer 1p/19q status.

    Returns 'codeleted' if at least one gene on each arm shows Loss,
    otherwise 'intact'.
    """
    has_1p_loss = any(
        sentinel_cnv.get(g, "").lower() == "loss" for g in GENES_1P
    )
    has_19q_loss = any(
        sentinel_cnv.get(g, "").lower() == "loss" for g in GENES_19Q
    )
    return "codeleted" if (has_1p_loss and has_19q_loss) else "intact"


def main() -> int:
    if not BIO_PATH.exists():
        print(f"ERROR: {BIO_PATH} not found", file=sys.stderr)
        return 1

    print(f"Loading {BIO_PATH} ...")
    with open(BIO_PATH, "r", encoding="utf-8") as f:
        bio = json.load(f)
    patients = bio.get("patients") or {}
    print(f"  {len(patients)} patient records")

    print(f"Querying GDC for {PROJECT} sentinel 1p/19q CNV data ...")
    print(f"  1p genes: {GENES_1P}")
    print(f"  19q genes: {GENES_19Q}")
    sentinel_map = fetch_sentinel_cnv()
    print(f"  GDC returned CNV data for {len(sentinel_map)} cases")

    # Show breakdown
    codeleted = 0
    intact = 0
    matched = 0

    for pid, prof in patients.items():
        case_id = prof.get("case_id") or pid.rsplit("-", 1)[0]
        sentinel_cnv = sentinel_map.get(case_id, {})

        # Merge sentinel genes into patient's existing CNV dict
        existing_cnv = prof.setdefault("cnv", {})
        for gene, change in sentinel_cnv.items():
            if gene not in existing_cnv:
                existing_cnv[gene] = change

        # Infer codeletion status
        status = infer_codeletion(sentinel_cnv)
        clinical = prof.setdefault("clinical", {})
        clinical["codeletion_1p19q"] = status
        matched += 1

        if status == "codeleted":
            codeleted += 1
        else:
            intact += 1

    # Also check IDH correlation for validation
    idh_and_codel = 0
    for pid, prof in patients.items():
        clin = prof.get("clinical", {})
        muts = prof.get("mutations", {})
        if clin.get("codeletion_1p19q") == "codeleted":
            if "IDH1" in muts or "IDH2" in muts:
                idh_and_codel += 1

    print("\nResults:")
    print(f"  codeleted: {codeleted}")
    print(f"  intact: {intact}")
    print(f"  codeleted + IDH-mutant: {idh_and_codel}/{codeleted}")

    meta = bio.setdefault("_meta", {})
    meta["codeletion_1p19q_enrichment"] = {
        "source": "GDC CNV sentinel genes (FUBP1, CAMTA1, CHD5 on 1p; CIC, TGFB1 on 19q)",
        "matched_patients": matched,
        "codeleted": codeleted,
        "intact": intact,
        "codeleted_with_idh_mutation": idh_and_codel,
    }

    print(f"\n  updated {matched} patient records")
    print(f"Writing {BIO_PATH} ...")
    with open(BIO_PATH, "w", encoding="utf-8") as f:
        json.dump(bio, f, indent=2)
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
