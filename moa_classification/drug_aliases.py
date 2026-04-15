"""Drug name alias resolution.

Maps code names, branded formulations, and dosage-stamped names to their
canonical generic (INN) display names.  Used when presenting drug lists
in the UI so that, e.g., "PARP Inhibitor BGB-290" renders as
"Pamiparib (BGB-290)".

Usage::

    from moa_classification.drug_aliases import resolve_drug_name

    resolve_drug_name("PARP Inhibitor BGB-290")  # -> "Pamiparib (BGB-290)"
    resolve_drug_name("Axitinib 1 MG")            # -> "Axitinib"
    resolve_drug_name("Some Unknown Drug")         # -> "Some Unknown Drug"
"""

# ── Canonical alias table ────────────────────────────────────────────
# Keys are UPPERCASE.  Values are the preferred display name.
_DRUG_NAME_ALIASES: dict[str, str] = {
    # ── PARP Inhibitors ──────────────────────────────────────────────
    "BGB-290":                  "Pamiparib (BGB-290)",
    "PARP INHIBITOR BGB-290":   "Pamiparib (BGB-290)",
    "OLAPARIB 150 MG":          "Olaparib",
    "OLAPARIB; 177LU-DOTATATE": "Olaparib + 177Lu-DOTATATE",

    # ── EGFR / HER2 / ErbB Pathway ──────────────────────────────────
    "ABT-414":                  "Depatuxizumab Mafodotin (ABT-414)",
    "DEPATUXIZUMAB MAFODOTIN":  "Depatuxizumab Mafodotin (ABT-414)",
    "AFATINIB":                 "Afatinib",
    "BIBW 2992":                "Afatinib",
    "BIBW 2992 PLUS TMZ":       "Afatinib",
    "BIBW2992":                 "Afatinib",
    "ERLOTINIB HCL (OSI-774)":  "Erlotinib",
    "ERLOTINIB HYDROCHLORIDE":  "Erlotinib",
    "ERLOTINIB + SIROLIMUS":    "Erlotinib + Sirolimus",
    "ERLOTINIB + DASATINIB":    "Erlotinib + Dasatinib",
    "ERLOTINIB AND DASATINIB":  "Erlotinib + Dasatinib",
    "TARCEVA":                  "Erlotinib",
    "CETUXIMAB-IRDYE 800CW":    "Cetuximab",
    "CETUXIMAB-IRDYE800":       "Cetuximab",
    "LAPATINIB DITOSYLATE":     "Lapatinib",
    "PANITUMUMAB-IRDYE800":     "Panitumumab",
    "AC480":                    "BMS-599626 (AC480)",
    "PF-299804 (DACOMITINIB)":  "Dacomitinib (PF-299804)",

    # ── VEGF / VEGFR / Angiogenesis ─────────────────────────────────
    "AVASTIN":                  "Bevacizumab (Avastin)",
    "BEV":                      "Bevacizumab",
    "ZIRABEV":                  "Bevacizumab (Zirabev)",
    "BEVACIZUMAB INJECTION":    "Bevacizumab",
    "BEVACIZUMAB STANDARD OF CARE": "Bevacizumab",
    "BEVACIZUMAB 25 MG IN 1 ML SUBCUTANEOUSLY DAILY": "Bevacizumab",
    "BEVACIZUMAB [AVASTIN]":    "Bevacizumab (Avastin)",
    "BIBF 1120":                "Nintedanib (BIBF-1120)",
    "CEDIRANIB MALEATE":        "Cediranib",
    "SUNITINIB 5 MG":           "Sunitinib",
    "SUNITINIB MALATE":         "Sunitinib",
    "SUTENT (SUNITINIB)":       "Sunitinib (Sutent)",
    "SORAFENIB TOSYLATE":       "Sorafenib",
    "PAZOPANIB 5 MG":           "Pazopanib",
    "PAZOPANIB HYDROCHLORIDE":  "Pazopanib",
    "AXITINIB 1 MG":            "Axitinib",
    "VANDETANIB":               "Vandetanib",
    "ZD6474":                   "Vandetanib",
    "ZD6474 (VANDETANIB)":      "Vandetanib",
    "CABOZANTINIB":             "Cabozantinib",
    "XL184":                    "Cabozantinib",
    "ANLOTINIB HYDROCHLORIDE":  "Anlotinib",
    "CT-322":                   "CT-322",

    # ── PI3K / mTOR / AKT Pathway ───────────────────────────────────
    "BKM120":                   "Buparlisib (BKM120)",
    "GDC-0084":                 "Paxalisib (GDC-0084)",
    "XL765 (SAR245409)":        "Voxtalisib (XL765)",
    "CC-115":                   "CC-115",
    "CC-223":                   "CC-223",
    "PQR309":                   "Bimiralisib (PQR309)",
    "AP23573":                  "Ridaforolimus (AP23573)",
    "AZD8055":                  "AZD8055",
    "MK-2206":                  "MK-2206",
    "RMC-5552":                 "RMC-5552",

    # ── Checkpoint Inhibitors (PD-1 / PD-L1 / CTLA-4) ──────────────
    "MK-3475":                  "Pembrolizumab",
    "MK - 3475":                "Pembrolizumab",
    "PEMBROLIZUMAB":            "Pembrolizumab",
    "PD-1":                     "Anti-PD-1",
    "ANTI-PD-1":                "Anti-PD-1",
    "NIVOLUMAB 240 MG IV":      "Nivolumab",
    "NIVOLUMAB 3 MG/KG":        "Nivolumab",
    "NIVOLUMAB":                "Nivolumab",
    "NIVOLUMAB 10 MG/1 ML INTRAVENOUS SOLUTION [OPDIVO]": "Nivolumab",
    "NIVOLUMAB MONOTHERAPY":    "Nivolumab",
    "NIVOLUMAB-IRDYE800":       "Nivolumab",
    "NIVOLUMAB-PLACEBO":        "Nivolumab",
    "ATEZOLIZUMAB":             "Atezolizumab",
    "ATEZOLIZUMAB (1200 MG EVERY THREE WEEKS)": "Atezolizumab",
    "ATEZOLIZUMAB + FSRT RADIATION": "Atezolizumab",
    "TECENTRIQ 1200 MG IN 20 ML INJECTION": "Atezolizumab",
    "IPILIMUMAB":               "Ipilimumab",
    "IPILIMUMAB (3 MG/KG)":     "Ipilimumab",
    "IPILIMUMAB 1 MG/KG":       "Ipilimumab",
    "IPILIMUMAB 3MG/KG":        "Ipilimumab",
    "IPILIMUMAB 1MG/KG":        "Ipilimumab",
    "IPILIMUMAB-PLACEBO":       "Ipilimumab",
    "CEMIPLIMAB (MAINTENANCE)":  "Cemiplimab",
    "CEMIPLIMAB (MONOTHERAPY)":  "Cemiplimab",
    "TISLELIZUMAB AND BEVACIZUMAB": "Tislelizumab + Bevacizumab",
    "TISLELIZUMAB PLUS BEVACIZUMAB": "Tislelizumab + Bevacizumab",
    "BMS-986016":               "Relatlimab (BMS-986016)",
    "ANTI-LAG-3 MONOCLONAL ANTIBODY BMS 986016": "Relatlimab (BMS-986016)",
    "ANTI-GITR MONOCLONAL ANTIBODY MK-4166": "MK-4166 (Anti-GITR)",

    # ── CDK Inhibitors ──────────────────────────────────────────────
    "PD 0332991":               "Palbociclib (PD-0332991)",
    "PD 0332991 (PRE-SURGERY)": "Palbociclib (PD-0332991)",
    "TG02":                     "Zotiraciclib (TG02)",

    # ── WEE1 / DNA Damage Response ──────────────────────────────────
    "AZD1775":                  "Adavosertib (AZD1775)",
    "ATM KINASE INHIBITOR AZD1390": "AZD1390",

    # ── MET Inhibitors ──────────────────────────────────────────────
    "INC280":                   "Capmatinib (INC280)",
    "PLB1001":                  "Vebreltinib (PLB1001)",
    "AMG 102":                  "Rilotumumab (AMG-102)",
    "AMG 102 AT 10 MG/KG":     "Rilotumumab (AMG-102)",
    "AMG 102 AT 20 MG/KG":     "Rilotumumab (AMG-102)",

    # ── Hedgehog Pathway ─────────────────────────────────────────────
    "LDE225":                   "Sonidegib (LDE225)",
    "PF-04449913":              "Glasdegib (PF-04449913)",

    # ── HDAC Inhibitors ──────────────────────────────────────────────
    "LBH589":                   "Panobinostat (LBH589)",
    "PCI 24781":                "Abexinostat (PCI-24781)",

    # ── BET Inhibitors ───────────────────────────────────────────────
    "CC-90010":                 "Trotabresib (CC-90010)",

    # ── Farnesyltransferase Inhibitors ───────────────────────────────
    "R115777":                  "Tipifarnib (R115777)",
    "SCH 66336":                "Lonafarnib (SCH-66336)",

    # ── BRAF / MEK Pathway ───────────────────────────────────────────
    "DABRAFENIB MESYLATE":      "Dabrafenib",
    "TRAMETINIB DIMETHYL SULFOXIDE": "Trametinib",
    "SELUMETINIB SULFATE":      "Selumetinib",
    "DABRAFENIB, TRAMETINIB, NIVOLUMAB": "Dabrafenib + Trametinib + Nivolumab",
    "TRAMETINIB AND NIVOLUMAB":  "Trametinib + Nivolumab",

    # ── TGF-beta Pathway ─────────────────────────────────────────────
    "LY2157299":                "Galunisertib (LY2157299)",

    # ── Integrin / Adhesion ──────────────────────────────────────────
    "CILENGITIDE EMD 121974":   "Cilengitide (EMD-121974)",

    # ── BTK Inhibitors ──────────────────────────────────────────────
    "ACP-196":                  "Acalabrutinib (ACP-196)",

    # ── GSK-3 Inhibitor ─────────────────────────────────────────────
    "9-ING-41":                 "Elraglusib (9-ING-41)",

    # ── ONC201 / DRD2 ───────────────────────────────────────────────
    "ONC201":                   "Dordaviprone (ONC201)",
    "DORDAVIPRONE (ONC201)":    "Dordaviprone (ONC201)",
    "AKT/ERK INHIBITOR ONC201": "Dordaviprone (ONC201)",

    # ── Tubulin / Microtubule ────────────────────────────────────────
    "BAL101553":                "Lisavanbulin (BAL101553)",
    "BAL101553 AT MTD":         "Lisavanbulin (BAL101553)",
    "ANG1005":                  "Paclitaxel Trevatide (ANG1005)",
    "ABT-751":                  "ABT-751",

    # ── Multi-kinase / Other Kinase Inhibitors ───────────────────────
    "IMATINIB MESYLATE":        "Imatinib",
    "DCC-2618":                 "Ripretinib (DCC-2618)",
    "ENZASTAURIN HYDROCHLORIDE": "Enzastaurin",
    "ENZASTAURIN (LY317615) MONOHYDRONCHLORIDE": "Enzastaurin (LY317615)",
    "MLN-518 (TANDUTINIB)":     "Tandutinib (MLN-518)",
    "ULIXERTINIB (BVD-523)":    "Ulixertinib (BVD-523)",
    "BAFETINIB":                "Bafetinib",

    # ── Hypoxia-Activated Prodrug ────────────────────────────────────
    "TH-302 (ESCALATING) WITH BEVACIZUMAB 10MG/KG": "Evofosfamide (TH-302)",
    "TH-302 PREOPERATIVE":      "Evofosfamide (TH-302)",

    # ── Cancer Stemness ──────────────────────────────────────────────
    "BBI608":                   "Napabucasin (BBI608)",

    # ── IDO Inhibitors ──────────────────────────────────────────────
    "IDO1 INHIBITOR INCB024360": "Epacadostat (INCB024360)",
    "CC-122":                   "Avadomide (CC-122)",

    # ── IL-2 pathway ─────────────────────────────────────────────────
    "NKTR-214":                 "Bempegaldesleukin (NKTR-214)",

    # ── CSF1R ────────────────────────────────────────────────────────
    "PLX3397":                  "Pexidartinib (PLX3397)",

    # ── IDH Inhibitors ──────────────────────────────────────────────
    "IDH305":                   "IDH305",
    "LY3410738":                "LY3410738",
    "OLUTASIDENIB + TMZ":       "Olutasidenib + TMZ",

    # ── Chemotherapy (branded / dosed variants) ──────────────────────
    "TEMODAR":                  "Temozolomide (Temodar)",
    "TEMODAR (TEMOZOLOMIDE)":   "Temozolomide",
    "TMZ":                      "Temozolomide",
    "TMZ (TEMOZOLOMIDE)":       "Temozolomide",
    "TEMOZOLOMIDE (TMZ)":       "Temozolomide",
    "LOMUSTINE (CCNU)":         "Lomustine",
    "CARMUSTINE(BCNU)":         "Carmustine",
    "CPT-11":                   "Irinotecan (CPT-11)",
    "IRINOTECAN HYDROCHLORIDE": "Irinotecan",
    "GLIADEL":                  "Carmustine Wafer (Gliadel)",
    "GLIADEL WAFER":            "Carmustine Wafer (Gliadel)",
    "GLIADEL WAFERS":           "Carmustine Wafer (Gliadel)",
    "PROCARBAZINE HYDROCHLORIDE": "Procarbazine",
    "ETOPOSIDE PHOSPHATE":      "Etoposide",
    "VINCRISTINE SULFATE":      "Vincristine",
    "LAROTRECTINIB SULFATE":    "Larotrectinib",

    # ── Combination entries (normalize separator) ────────────────────
    "BEVACIZUMAB / IRINOTECAN": "Bevacizumab + Irinotecan",
    "BEVACIZUMAB AND ETOPOSIDE": "Bevacizumab + Etoposide",
    "APATINIB AND IRINOTECAN":  "Apatinib + Irinotecan",
    "PEMBROLIZUMAB AND TEMOZOLOMIDE": "Pembrolizumab + Temozolomide",
    "COMBINATION OF VARLILUMAB AND NIVOLUMAB": "Varlilumab + Nivolumab",
    "CONTINUED IRINOTECAN HYDROCHLORIDE (HCI) TREATMENT": "Irinotecan",
    "BEVACIZUMAB AND ERLOTINIB": "Bevacizumab + Erlotinib",

    # ── Miscellaneous ────────────────────────────────────────────────
    "CANNABIDIOL (CBD)":        "Cannabidiol",
    "CELEBREX":                 "Celecoxib (Celebrex)",
    "STAT3 INHIBITOR WP1066":   "WP1066 (STAT3 Inhibitor)",
    "GAMMA-SECRETASE INHIBITOR RO4929097": "RO4929097",
    "CERITINIB (LDK378)":       "Ceritinib (LDK378)",

    # ── Normalize casing for remaining lowercase entries ─────────────
    "ANTI-EGFR CAR T":          "Anti-EGFR CAR-T",
    "MAB-425 RADIOLABELED WITH I-125": "MAb-425 (I-125)",
    "MAB-425":                  "MAb-425",
}


def resolve_drug_name(raw_name: str) -> str:
    """Return the canonical display name for a drug.

    Looks up the UPPERCASE version of *raw_name* in the alias table.
    Returns the original name unchanged if no alias is found.
    """
    return _DRUG_NAME_ALIASES.get(raw_name.strip().upper(), raw_name.strip())


def resolve_drug_list(names: list[str] | set[str]) -> list[str]:
    """Resolve and deduplicate a collection of drug names.

    Applies ``resolve_drug_name`` to every entry, then deduplicates
    (case-insensitive).  When duplicates exist (e.g. "veliparib" and
    "Veliparib"), prefers the version that starts with an uppercase
    letter so the display is consistently title-cased.

    Returns a sorted list of unique resolved names.
    """
    seen: dict[str, str] = {}
    for raw in sorted(names):
        resolved = resolve_drug_name(raw)
        key = resolved.upper()
        if key not in seen:
            seen[key] = resolved
        elif resolved[0].isupper() and seen[key][0].islower():
            # Prefer title-cased variant
            seen[key] = resolved
    return sorted(seen.values(), key=str.lower)
