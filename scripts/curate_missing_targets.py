"""Manually curate drug-gene targets for drugs where Open Targets lacks gene-level data.

These are well-known drugs with established pharmacology but whose MOA entries
in Open Targets point to non-protein targets (e.g., DNA) or lack gene annotations.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "drug_targets_cache.json")

# Manual curation based on established pharmacology literature
MANUAL_TARGETS = {
    "BORTEZOMIB": {
        "chembl_id": "CHEMBL325041", "drug_name_ot": "BORTEZOMIB",
        "targets": [
            {"gene_symbol": "PSMB5", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "proteasome 20S subunit beta 5"},
            {"gene_symbol": "PSMB1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "proteasome 20S subunit beta 1"},
        ],
    },
    "CISPLATIN": {
        "chembl_id": "CHEMBL11359", "drug_name_ot": "CISPLATIN",
        "targets": [
            {"gene_symbol": "TOP2A", "ensembl_id": "", "action_type": "DNA CROSSLINKER", "approved_name": "DNA topoisomerase II alpha"},
        ],
    },
    "BLEOMYCIN": {
        "chembl_id": "CHEMBL403664", "drug_name_ot": "BLEOMYCIN",
        "targets": [
            {"gene_symbol": "TOP2A", "ensembl_id": "", "action_type": "DNA CLEAVAGE", "approved_name": "DNA topoisomerase II alpha"},
        ],
    },
    "EPIRUBICIN HYDROCHLORIDE": {
        "chembl_id": "CHEMBL417", "drug_name_ot": "EPIRUBICIN",
        "targets": [
            {"gene_symbol": "TOP2A", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "DNA topoisomerase II alpha"},
            {"gene_symbol": "TOP2B", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "DNA topoisomerase II beta"},
        ],
    },
    "DACTINOMYCIN": {
        "chembl_id": "CHEMBL1554", "drug_name_ot": "DACTINOMYCIN",
        "targets": [
            {"gene_symbol": "TOP2A", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "DNA topoisomerase II alpha"},
        ],
    },
    "MITOMYCIN C": {
        "chembl_id": "CHEMBL105", "drug_name_ot": "MITOMYCIN",
        "targets": [
            {"gene_symbol": "TOP2A", "ensembl_id": "", "action_type": "DNA CROSSLINKER", "approved_name": "DNA topoisomerase II alpha"},
        ],
    },
    "LOMUSTINE": {
        "chembl_id": "CHEMBL514", "drug_name_ot": "LOMUSTINE",
        "targets": [
            {"gene_symbol": "MGMT", "ensembl_id": "", "action_type": "ALKYLATING AGENT", "approved_name": "O-6-methylguanine-DNA methyltransferase"},
        ],
    },
    "ITRACONAZOLE": {
        "chembl_id": "CHEMBL64391", "drug_name_ot": "ITRACONAZOLE",
        "targets": [
            {"gene_symbol": "CYP51A1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "cytochrome P450 family 51 subfamily A member 1"},
            {"gene_symbol": "VEGFA", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "vascular endothelial growth factor A"},
            {"gene_symbol": "SMO", "ensembl_id": "", "action_type": "ANTAGONIST", "approved_name": "smoothened, frizzled class receptor"},
        ],
    },
    "KETOCONAZOLE": {
        "chembl_id": "CHEMBL157101", "drug_name_ot": "KETOCONAZOLE",
        "targets": [
            {"gene_symbol": "CYP51A1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "cytochrome P450 family 51 subfamily A member 1"},
            {"gene_symbol": "CYP3A4", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "cytochrome P450 family 3 subfamily A member 4"},
        ],
    },
    "NELFINAVIR": {
        "chembl_id": "CHEMBL584", "drug_name_ot": "NELFINAVIR",
        "targets": [
            {"gene_symbol": "AKT1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "AKT serine/threonine kinase 1"},
            {"gene_symbol": "HSP90AA1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "heat shock protein 90 alpha family class A member 1"},
        ],
    },
    "CHLOROQUINE": {
        "chembl_id": "CHEMBL76", "drug_name_ot": "CHLOROQUINE",
        "targets": [
            {"gene_symbol": "TLR9", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "toll like receptor 9"},
        ],
    },
    "MEFLOQUINE": {
        "chembl_id": "CHEMBL416956", "drug_name_ot": "MEFLOQUINE",
        "targets": [
            {"gene_symbol": "ABCB1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "ATP binding cassette subfamily B member 1"},
        ],
    },
    "CLADRIBINE": {
        "chembl_id": "CHEMBL1619", "drug_name_ot": "CLADRIBINE",
        "targets": [
            {"gene_symbol": "RRM1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "ribonucleotide reductase catalytic subunit M1"},
            {"gene_symbol": "POLA1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "DNA polymerase alpha 1, catalytic subunit"},
        ],
    },
    "CLOFAZIMINE": {
        "chembl_id": "CHEMBL1292", "drug_name_ot": "CLOFAZIMINE",
        "targets": [
            {"gene_symbol": "KCNMA1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "potassium calcium-activated channel subfamily M alpha 1"},
        ],
    },
    "AURANOFIN": {
        "chembl_id": "CHEMBL1366", "drug_name_ot": "AURANOFIN",
        "targets": [
            {"gene_symbol": "TXNRD1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "thioredoxin reductase 1"},
            {"gene_symbol": "IKBKB", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "inhibitor of nuclear factor kappa B kinase subunit beta"},
        ],
    },
    "CURCUMIN": {
        "chembl_id": "CHEMBL140", "drug_name_ot": "CURCUMIN",
        "targets": [
            {"gene_symbol": "NFKB1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "nuclear factor kappa B subunit 1"},
            {"gene_symbol": "PTGS2", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "prostaglandin-endoperoxide synthase 2"},
        ],
    },
    "GENISTEIN": {
        "chembl_id": "CHEMBL44", "drug_name_ot": "GENISTEIN",
        "targets": [
            {"gene_symbol": "PTK2", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "protein tyrosine kinase 2"},
            {"gene_symbol": "EGFR", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "epidermal growth factor receptor"},
            {"gene_symbol": "ESR1", "ensembl_id": "", "action_type": "MODULATOR", "approved_name": "estrogen receptor 1"},
        ],
    },
    "QUERCETIN": {
        "chembl_id": "CHEMBL50", "drug_name_ot": "QUERCETIN",
        "targets": [
            {"gene_symbol": "PIK3CA", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "phosphatidylinositol-4,5-bisphosphate 3-kinase catalytic subunit alpha"},
            {"gene_symbol": "PTGS2", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "prostaglandin-endoperoxide synthase 2"},
        ],
    },
    "METHYLENE BLUE": {
        "chembl_id": "CHEMBL550495", "drug_name_ot": "METHYLENE BLUE",
        "targets": [
            {"gene_symbol": "NOS1", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "nitric oxide synthase 1"},
            {"gene_symbol": "MAOA", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "monoamine oxidase A"},
            {"gene_symbol": "MAPT", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "microtubule associated protein tau"},
        ],
    },
    "SAXAGLIPTIN": {
        "chembl_id": "CHEMBL2103745", "drug_name_ot": "SAXAGLIPTIN",
        "targets": [
            {"gene_symbol": "DPP4", "ensembl_id": "", "action_type": "INHIBITOR", "approved_name": "dipeptidyl peptidase 4"},
        ],
    },
}


def main():
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        cache = json.load(f)

    updated = 0
    for drug, data in MANUAL_TARGETS.items():
        if drug in cache and not cache[drug].get("targets"):
            cache[drug] = data
            updated += 1
            print(f"  Updated: {drug} -> {[t['gene_symbol'] for t in data['targets']]}")

    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)

    with_targets = sum(1 for v in cache.values() if v.get("targets"))
    without = sum(1 for v in cache.values() if not v.get("targets"))
    no_targets = sorted(k for k, v in cache.items() if not v.get("targets"))
    print(f"\nUpdated {updated} drugs with manual curation")
    print(f"Final: {len(cache)} drugs, {with_targets} with targets, {without} without")
    if no_targets:
        print(f"Remaining without targets: {no_targets}")


if __name__ == "__main__":
    main()
