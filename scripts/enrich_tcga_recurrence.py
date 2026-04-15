"""
One-shot script: enrich data/tcga_patient_biomarkers.json with recurrence
information pulled from the GDC API.

For TCGA-GBM, recurrence status is captured at the follow-up level
(`follow_ups.new_tumor_events.new_tumor_event_after_initial_treatment`),
not on the diagnosis record. The original tcga_biomarkers connector only
fetched the diagnosis-level field which is empty for nearly all GBM cases.

This script:
  1. Loads the existing patient biomarker JSON
  2. For every TCGA-GBM case it queries GDC's /cases endpoint asking for
     follow_ups.new_tumor_events
  3. Sets `clinical.progression_or_recurrence` to "yes" if any new tumor
     event is recorded, else "no" (so the value is no longer empty)
  4. Writes the file back in place

Usage:
    python scripts/enrich_tcga_recurrence.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
BIO_PATH = ROOT / "data" / "tcga_patient_biomarkers.json"
GDC_API_BASE = "https://api.gdc.cancer.gov"
PROJECT = "TCGA-GBM"
PAGE_SIZE = 100


def fetch_recurrence_map() -> dict[str, str]:
    """Return {submitter_id: 'yes' | 'no'} based on follow-up new-tumor events."""
    out: dict[str, str] = {}
    offset = 0
    while True:
        params = {
            "filters": json.dumps({
                "op": "=",
                "content": {"field": "project.project_id", "value": PROJECT},
            }),
            "fields": ",".join([
                "submitter_id",
                "diagnoses.progression_or_recurrence",
                "follow_ups.new_tumor_events.new_tumor_event_after_initial_treatment",
                "follow_ups.new_tumor_events.new_neoplasm_event_type",
                "follow_ups.disease_response",
                "follow_ups.progression_or_recurrence",
            ]),
            "size": PAGE_SIZE,
            "from": offset,
        }
        resp = httpx.get(f"{GDC_API_BASE}/cases", params=params, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        hits = data.get("data", {}).get("hits", []) or []
        if not hits:
            break

        for hit in hits:
            sid = hit.get("submitter_id", "")
            if not sid:
                continue

            recurred = False

            # 1) Diagnosis-level field (rarely populated for GBM, but check it)
            for diag in hit.get("diagnoses") or []:
                v = (diag.get("progression_or_recurrence") or "").strip().lower()
                if v in ("yes", "true", "recurr", "recurrent"):
                    recurred = True
                    break

            # 2) Follow-up records
            if not recurred:
                for fu in hit.get("follow_ups") or []:
                    fu_pr = (fu.get("progression_or_recurrence") or "").strip().lower()
                    if fu_pr in ("yes", "true"):
                        recurred = True
                        break
                    fu_dr = (fu.get("disease_response") or "").strip().lower()
                    if "progressive" in fu_dr or "recurr" in fu_dr:
                        recurred = True
                        break
                    for nte in (fu.get("new_tumor_events") or []):
                        flag = (nte.get("new_tumor_event_after_initial_treatment") or "").strip().lower()
                        if flag in ("yes", "true"):
                            recurred = True
                            break
                        et = (nte.get("new_neoplasm_event_type") or "").strip().lower()
                        if et and et != "not reported":
                            recurred = True
                            break
                    if recurred:
                        break

            out[sid] = "yes" if recurred else "no"

        offset += PAGE_SIZE
        pagination = data.get("data", {}).get("pagination", {}) or {}
        total = pagination.get("total", 0)
        print(f"  fetched {min(offset, total)}/{total}")
        if offset >= total:
            break
    return out


def main() -> int:
    if not BIO_PATH.exists():
        print(f"ERROR: {BIO_PATH} not found", file=sys.stderr)
        return 1

    print(f"Loading {BIO_PATH} ...")
    with open(BIO_PATH, "r", encoding="utf-8") as f:
        bio = json.load(f)
    patients = bio.get("patients") or {}
    print(f"  {len(patients)} patient records")

    print(f"Querying GDC for {PROJECT} follow-up recurrence data ...")
    rec_map = fetch_recurrence_map()
    print(f"  GDC returned recurrence flags for {len(rec_map)} cases")

    yes_n = sum(1 for v in rec_map.values() if v == "yes")
    no_n = sum(1 for v in rec_map.values() if v == "no")
    print(f"  yes={yes_n}  no={no_n}")

    matched = 0
    for pid, prof in patients.items():
        case_id = prof.get("case_id") or pid.rsplit("-", 1)[0]
        flag = rec_map.get(case_id)
        if flag is None:
            continue
        clinical = prof.setdefault("clinical", {})
        clinical["progression_or_recurrence"] = flag
        matched += 1

    meta = bio.setdefault("_meta", {})
    meta["recurrence_enrichment"] = {
        "source": "GDC follow_ups.new_tumor_events",
        "matched_patients": matched,
        "yes": sum(1 for p in patients.values() if (p.get("clinical") or {}).get("progression_or_recurrence") == "yes"),
        "no": sum(1 for p in patients.values() if (p.get("clinical") or {}).get("progression_or_recurrence") == "no"),
    }

    print(f"  updated {matched} patient records")
    print(f"Writing {BIO_PATH} ...")
    with open(BIO_PATH, "w", encoding="utf-8") as f:
        json.dump(bio, f, indent=2)
    print("Done.")
    print(f"Final counts: {meta['recurrence_enrichment']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
