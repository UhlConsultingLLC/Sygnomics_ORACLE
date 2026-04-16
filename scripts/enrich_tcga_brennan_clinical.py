"""
One-shot script: enrich data/tcga_patient_biomarkers.json with clinical
and molecular data from Brennan et al. 2013 Cell Supplemental Table S7
(NIHMS530933-supplement-09.xlsx).

Fields imported:
  - MGMT methylation status  (METHYLATED / UNMETHYLATED / unknown)
  - IDH1 clinical status     (mutant / wild-type / unknown)
  - G-CIMP methylation       (G-CIMP / non-G-CIMP / unknown)
  - Expression subclass      (Classical / Mesenchymal / Neural / Proneural / unknown)

Also derives:
  - idh_status: combines IDH1 from Brennan S7 with IDH2 mutation data
    already in the patient profiles. A patient is "mutant" if either S7
    says R132H/R132G/R132C OR if IDH1/IDH2 somatic mutations are present.

Usage:
    python scripts/enrich_tcga_brennan_clinical.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
BIO_PATH = ROOT / "data" / "tcga_patient_biomarkers.json"
S7_PATH = ROOT / "data" / "brennan2013" / "NIHMS530933-supplement-09.xlsx"


def parse_s7() -> dict[str, dict]:
    """Parse Brennan S7 clinical table.

    Returns: {case_id: {mgmt, idh1, gcimp, expression_subclass}}
    Case IDs are like 'TCGA-02-0001'.
    """
    wb = openpyxl.load_workbook(str(S7_PATH), data_only=True)
    ws = wb["Clinical Data"]
    rows = list(ws.iter_rows(values_only=True))
    # Header at row index 2; data starts at row index 3
    data_rows = rows[3:]

    out: dict[str, dict] = {}
    for row in data_rows:
        if not row or not row[0]:
            continue
        case_id = str(row[0]).strip()  # e.g. TCGA-02-0001

        mgmt_raw = str(row[5]).strip() if row[5] else ""
        idh1_raw = str(row[8]).strip() if row[8] else ""
        gcimp_raw = str(row[7]).strip() if row[7] else ""
        expr_raw = str(row[9]).strip() if row[9] else ""

        # Normalize MGMT
        mgmt_upper = mgmt_raw.upper()
        if mgmt_upper in ("METHYLATED",):
            mgmt = "methylated"
        elif mgmt_upper in ("UNMETHYLATED",):
            mgmt = "unmethylated"
        else:
            mgmt = ""  # unknown

        # Normalize IDH1 status
        if idh1_raw.upper() == "WT":
            idh1 = "wild-type"
        elif idh1_raw.upper().startswith("R132"):
            idh1 = "mutant"
        else:
            idh1 = ""  # unknown

        # Normalize G-CIMP
        gcimp_upper = gcimp_raw.upper().replace("-", "").replace(" ", "")
        if gcimp_upper == "GCIMP":
            gcimp = "G-CIMP"
        elif gcimp_upper == "NONGCIMP":
            gcimp = "non-G-CIMP"
        else:
            gcimp = ""

        # Expression subclass (keep as-is if present)
        expr = expr_raw if expr_raw and expr_raw.upper() not in ("", "NA", "NONE") else ""

        out[case_id] = {
            "mgmt_methylation": mgmt,
            "idh1_clinical": idh1,
            "gcimp_methylation": gcimp,
            "expression_subclass": expr,
        }

    return out


def main() -> int:
    if not BIO_PATH.exists():
        print(f"ERROR: {BIO_PATH} not found", file=sys.stderr)
        return 1
    if not S7_PATH.exists():
        print(f"ERROR: {S7_PATH} not found", file=sys.stderr)
        return 1

    print(f"Loading {BIO_PATH} ...")
    with open(BIO_PATH, "r", encoding="utf-8") as f:
        bio = json.load(f)
    patients = bio.get("patients") or {}
    print(f"  {len(patients)} patient records")

    print(f"Parsing Brennan S7 from {S7_PATH} ...")
    s7_data = parse_s7()
    print(f"  {len(s7_data)} cases in S7")

    matched = 0
    mgmt_meth = 0
    mgmt_unmeth = 0
    idh_mut = 0
    idh_wt = 0

    for pid, prof in patients.items():
        case_id = prof.get("case_id") or pid.rsplit("-", 1)[0]
        s7 = s7_data.get(case_id, {})
        clinical = prof.setdefault("clinical", {})

        # MGMT methylation
        if s7.get("mgmt_methylation"):
            clinical["mgmt_methylation"] = s7["mgmt_methylation"]
            if s7["mgmt_methylation"] == "methylated":
                mgmt_meth += 1
            else:
                mgmt_unmeth += 1

        # G-CIMP
        if s7.get("gcimp_methylation"):
            clinical["gcimp_methylation"] = s7["gcimp_methylation"]

        # Expression subclass
        if s7.get("expression_subclass"):
            clinical["expression_subclass"] = s7["expression_subclass"]

        # IDH status: combine Brennan S7 IDH1 annotation with existing
        # somatic mutation data for IDH1/IDH2
        has_idh1_mut = bool((prof.get("mutations") or {}).get("IDH1"))
        has_idh2_mut = bool((prof.get("mutations") or {}).get("IDH2"))
        s7_idh = s7.get("idh1_clinical", "")

        if s7_idh == "mutant" or has_idh1_mut or has_idh2_mut:
            clinical["idh_status"] = "mutant"
            idh_mut += 1
        elif s7_idh == "wild-type":
            clinical["idh_status"] = "wild-type"
            idh_wt += 1
        else:
            # No S7 annotation and no somatic mutations — leave as unknown
            # but if we have WES data with no IDH mutations, likely wild-type
            muts = prof.get("mutations") or {}
            if muts:
                # Patient has WES data but no IDH mutations → likely wild-type
                clinical["idh_status"] = "wild-type"
                idh_wt += 1
            else:
                clinical["idh_status"] = ""

        if s7:
            matched += 1

    print("\nResults:")
    print(f"  Matched to S7: {matched}")
    print(f"  MGMT methylated: {mgmt_meth}")
    print(f"  MGMT unmethylated: {mgmt_unmeth}")
    print(f"  MGMT unknown: {len(patients) - mgmt_meth - mgmt_unmeth}")
    print(f"  IDH mutant: {idh_mut}")
    print(f"  IDH wild-type: {idh_wt}")
    print(f"  IDH unknown: {len(patients) - idh_mut - idh_wt}")

    meta = bio.setdefault("_meta", {})
    meta["brennan_clinical_enrichment"] = {
        "source": "Brennan et al. 2013 Cell Supplemental Table S7",
        "s7_cases": len(s7_data),
        "matched_patients": matched,
        "mgmt_methylated": mgmt_meth,
        "mgmt_unmethylated": mgmt_unmeth,
        "idh_mutant": idh_mut,
        "idh_wild_type": idh_wt,
    }

    print(f"\nWriting {BIO_PATH} ...")
    with open(BIO_PATH, "w", encoding="utf-8") as f:
        json.dump(bio, f, indent=2)
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
