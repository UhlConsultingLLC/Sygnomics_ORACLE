"""
Import EGFRvIII (EGFR delta exon 2-7) calls from Brennan et al. 2013
Cell Supplemental Table S5 (NIHMS530933-supplement-07.xlsx) into
data/tcga_patient_biomarkers.json.

Calls a patient EGFRvIII-positive if either:
  - delta 2-7 allele fraction > 0.01 (excluding "<0.01" string), or
  - delta 2-7 raw read count >= 5

Sample IDs in S5 are short forms like "TCGA.5218" (only the trailing digits
of the patient barcode). Matching is done by zero-stripped suffix against the
existing TCGA-GBM patients in tcga_patient_biomarkers.json (verified 1:1
unique for the 164 S5 samples).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
BIO_PATH = ROOT / "data" / "tcga_patient_biomarkers.json"
S5_PATH = ROOT / "data" / "brennan2013" / "NIHMS530933-supplement-07.xlsx"


def parse_af(v) -> float:
    """Parse an allele-fraction cell that may be a number, '', None, or '<0.01'."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return 0.0
    if s.startswith("<"):
        return 0.0  # below threshold → treat as no signal
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_reads(v) -> int:
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(str(v).strip() or 0)
    except ValueError:
        return 0


def main() -> int:
    if not BIO_PATH.exists():
        print(f"ERROR: {BIO_PATH} not found", file=sys.stderr)
        return 1
    if not S5_PATH.exists():
        print(f"ERROR: {S5_PATH} not found", file=sys.stderr)
        return 1

    print(f"Loading {BIO_PATH} ...")
    with open(BIO_PATH, "r", encoding="utf-8") as f:
        bio = json.load(f)
    patients = bio.get("patients") or {}

    # Build suffix → patient_id map (suffix = stripped trailing digits of barcode)
    suffix_map: dict[str, list[str]] = {}
    for pid, prof in patients.items():
        cid = prof.get("case_id") or pid.rsplit("-", 1)[0]
        parts = cid.split("-")
        if len(parts) >= 3:
            suf = parts[2].lstrip("0") or "0"
            suffix_map.setdefault(suf, []).append(pid)

    print(f"Loading {S5_PATH} ...")
    wb = openpyxl.load_workbook(S5_PATH, data_only=True)
    ws = wb.active

    # Header layout (verified from inspection):
    #   col 0: Sample
    #   col 1: EGFR CNA
    #   col 3: delta 2-7 allele fraction
    #   col 8: delta 2-7 raw read count
    rows = list(ws.iter_rows(values_only=True))
    data_rows = rows[4:]

    pos = 0
    neg = 0
    matched_patients: set[str] = set()
    unmatched_samples: list[str] = []

    for row in data_rows:
        if not row or not row[0]:
            continue
        sample = str(row[0]).strip()
        suf = sample.replace("TCGA.", "").replace("TCGA-", "").lstrip("0") or "0"
        pids = suffix_map.get(suf)
        if not pids:
            unmatched_samples.append(sample)
            continue

        af = parse_af(row[3])
        reads = parse_reads(row[8])
        is_positive = af > 0.01 or reads >= 5
        flag = "yes" if is_positive else "no"
        if is_positive:
            pos += 1
        else:
            neg += 1

        for pid in pids:
            clinical = patients[pid].setdefault("clinical", {})
            clinical["egfrviii_status"] = flag
            clinical["egfrviii_af_delta_2_7"] = af
            clinical["egfrviii_reads_delta_2_7"] = reads
            matched_patients.add(pid)

    meta = bio.setdefault("_meta", {})
    meta["egfrviii_enrichment"] = {
        "source": "Brennan et al. 2013 Cell Supplemental Table S5 (delta 2-7)",
        "matched_patients": len(matched_patients),
        "positive": pos,
        "negative": neg,
        "unmatched_s5_samples": len(unmatched_samples),
    }

    print(f"Matched {len(matched_patients)} patients from {len(data_rows)} S5 rows")
    print(f"  EGFRvIII positive: {pos}")
    print(f"  EGFRvIII negative: {neg}")
    if unmatched_samples:
        print(f"  Unmatched S5 samples: {len(unmatched_samples)} (first 5: {unmatched_samples[:5]})")

    print(f"Writing {BIO_PATH} ...")
    with open(BIO_PATH, "w", encoding="utf-8") as f:
        json.dump(bio, f, indent=2)
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
