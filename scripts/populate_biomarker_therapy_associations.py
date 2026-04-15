"""
Populate the biomarker_therapy_associations table with curated literature-backed
biomarker-therapy response associations relevant to GBM and CNS tumors.

Sources include landmark clinical trials (EORTC 26981, INDIGO, ROAR, etc.),
NCCN guidelines, and key preclinical/translational publications.

Usage:
    python scripts/populate_biomarker_therapy_associations.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running from project root
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from database.engine import create_db_engine, get_session_factory, init_db
from database.models import BiomarkerTherapyAssociation

# ── Curated associations ─────────────────────────────────────────────────
# Each dict maps to one BiomarkerTherapyAssociation row.
# fmt: off
ASSOCIATIONS = [
    # ═══════════════════════════════════════════════════════════════════════
    # MGMT METHYLATION
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "MGMT methylated",
        "biomarker_status": "methylated",
        "biomarker_category": "methylation",
        "therapy_name": "Temozolomide",
        "therapy_class": "Alkylating Agent",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "MGMT promoter methylation silences the MGMT DNA repair enzyme. "
            "Without MGMT, O6-methylguanine lesions induced by temozolomide persist, "
            "leading to futile mismatch repair cycles and cell death."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "Hegi et al. NEJM 2005; Stupp et al. Lancet Oncol 2009; "
            "Stupp et al. NEJM 2005 (EORTC 26981/NCIC CE.3)"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "MGMT unmethylated",
        "biomarker_status": "unmethylated",
        "biomarker_category": "methylation",
        "therapy_name": "Temozolomide",
        "therapy_class": "Alkylating Agent",
        "response_effect": "decreased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "Active MGMT enzyme rapidly repairs TMZ-induced O6-methylguanine "
            "adducts, conferring intrinsic resistance to alkylating chemotherapy."
        ),
        "evidence_level": "level_1",
        "evidence_sources": "Hegi et al. NEJM 2005; Weller et al. Lancet Oncol 2019",
        "disease_context": "GBM",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "MGMT methylated",
        "biomarker_status": "methylated",
        "biomarker_category": "methylation",
        "therapy_name": "Lomustine (CCNU)",
        "therapy_class": "Alkylating Agent",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "Lomustine is a nitrosourea alkylating agent; MGMT silencing prevents "
            "repair of chloroethyl-DNA adducts, enhancing cytotoxicity."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "Herrlinger et al. Lancet 2019 (CeTeG/NOA-09); "
            "Wick et al. NEJM 2012 (NOA-08)"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "MGMT methylated",
        "biomarker_status": "methylated",
        "biomarker_category": "methylation",
        "therapy_name": "Lomustine + Temozolomide",
        "therapy_class": "Alkylating Agent",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "Dual alkylating therapy benefits patients with MGMT-silenced tumors; "
            "CeTeG trial showed OS benefit for combined TMZ/CCNU in MGMT-methylated GBM."
        ),
        "evidence_level": "level_1",
        "evidence_sources": "Herrlinger et al. Lancet 2019 (CeTeG/NOA-09)",
        "disease_context": "GBM",
        "clinical_actionability": "guideline_recommended",
    },
    {
        "biomarker": "MGMT methylated",
        "biomarker_status": "methylated",
        "biomarker_category": "methylation",
        "therapy_name": "PARP inhibitors",
        "therapy_class": "PARP inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "MGMT-silenced tumors rely more heavily on base excision repair (BER). "
            "PARP inhibition blocks BER, creating synthetic lethality with TMZ-induced "
            "lesions in MGMT-methylated tumors."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "Gupta et al. Clin Cancer Res 2014; "
            "Parrish et al. Neuro-Oncol 2015"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # IDH MUTATION
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "IDH mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "Vorasidenib",
        "therapy_class": "IDH inhibitor",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "Vorasidenib is a brain-penetrant dual IDH1/IDH2 inhibitor. "
            "In IDH-mutant gliomas it blocks oncometabolite 2-HG production, "
            "restoring normal cellular differentiation."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "Mellinghoff et al. NEJM 2023 (INDIGO trial); "
            "FDA approved Aug 2024 for IDH-mutant grade 2 glioma"
        ),
        "disease_context": "Low-grade glioma",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "IDH1 mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "Ivosidenib",
        "therapy_class": "IDH inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "Ivosidenib selectively inhibits mutant IDH1 (R132H/C/G/S/L), "
            "reducing 2-HG levels. Phase I showed durable responses in "
            "IDH1-mutant gliomas."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Mellinghoff et al. JCO 2020 (AG-120 Phase I); "
            "Tap et al. Cancer Discov 2020"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "investigational",
    },
    {
        "biomarker": "IDH mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "Temozolomide",
        "therapy_class": "Alkylating Agent",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "IDH-mutant gliomas frequently harbor MGMT methylation and exhibit "
            "a hypermethylator phenotype (G-CIMP), contributing to better "
            "chemotherapy response and overall prognosis."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Yan et al. NEJM 2009; "
            "Cancer Genome Atlas Research Network. NEJM 2015"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "IDH mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "PARP inhibitors",
        "therapy_class": "PARP inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "IDH-mutant cells have impaired homologous recombination due to "
            "2-HG-mediated suppression of ATM/BRCA pathway components, creating "
            "a BRCAness phenotype sensitive to PARP inhibition."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Lu et al. Cancer Cell 2017; "
            "Sulkowski et al. Sci Transl Med 2017; "
            "Higuchi et al. Neuro-Oncol 2020 (OLAGLI trial)"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "investigational",
    },
    {
        "biomarker": "IDH wild-type",
        "biomarker_status": "wild-type",
        "biomarker_category": "mutation",
        "therapy_name": "IDH inhibitors",
        "therapy_class": "IDH inhibitor",
        "response_effect": "no_effect",
        "effect_size": "strong",
        "mechanism_summary": (
            "IDH inhibitors target the neomorphic enzyme activity of mutant IDH. "
            "Wild-type IDH tumors do not produce excess 2-HG and are not "
            "expected to respond."
        ),
        "evidence_level": "level_1",
        "evidence_sources": "Mellinghoff et al. NEJM 2023",
        "disease_context": "GBM",
        "clinical_actionability": "standard_of_care",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # EGFR / EGFRvIII
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "EGFR amplification",
        "biomarker_status": "amplified",
        "biomarker_category": "amplification",
        "therapy_name": "Depatuxizumab mafodotin (ABT-414)",
        "therapy_class": "Antibody-drug conjugate",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "Depatuxizumab mafodotin is an ADC targeting EGFR-amplified cells. "
            "EGFR amplification drives receptor overexpression, increasing "
            "ADC binding and internalization."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "van den Bent et al. Lancet Oncol 2017 (INTELLANCE-1); "
            "Lassman et al. Lancet Oncol 2019"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    {
        "biomarker": "EGFRvIII",
        "biomarker_status": "present",
        "biomarker_category": "mutation",
        "therapy_name": "Rindopepimut (CDX-110)",
        "therapy_class": "Cancer Vaccine",
        "response_effect": "sensitivity",
        "effect_size": "variable",
        "mechanism_summary": (
            "Rindopepimut is a peptide vaccine targeting the EGFRvIII neoantigen. "
            "Only EGFRvIII-expressing tumors present the target epitope. "
            "Phase III (ACT IV) did not meet primary endpoint."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Weller et al. Lancet Oncol 2017 (ACT IV); "
            "Schuster et al. JCO 2015"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    {
        "biomarker": "EGFR amplification",
        "biomarker_status": "amplified",
        "biomarker_category": "amplification",
        "therapy_name": "Erlotinib",
        "therapy_class": "EGFR inhibitor",
        "response_effect": "decreased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "First-generation EGFR TKIs have limited efficacy in GBM despite "
            "EGFR amplification, likely due to co-activation of redundant "
            "signaling pathways, poor BBB penetration, and intratumoral "
            "heterogeneity of EGFR expression."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "van den Bent et al. JCO 2009; "
            "Raizer et al. Neuro-Oncol 2010"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "EGFR amplification",
        "biomarker_status": "amplified",
        "biomarker_category": "amplification",
        "therapy_name": "EGFR-targeted CAR-T",
        "therapy_class": "CAR-T Cell Therapy",
        "response_effect": "sensitivity",
        "effect_size": "moderate",
        "mechanism_summary": (
            "EGFR-targeted CAR-T cells are engineered to recognize EGFR or "
            "EGFRvIII. EGFR-amplified tumors overexpress the target antigen, "
            "potentially improving CAR-T efficacy."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "O'Rourke et al. Sci Transl Med 2017; "
            "Bagley et al. JAMA Oncol 2024"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # BRAF
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "BRAF V600E",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "Dabrafenib + Trametinib",
        "therapy_class": "BRAF inhibitor + MEK inhibitor",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "BRAF V600E drives constitutive MAPK pathway activation. Combined "
            "BRAF + MEK inhibition achieves durable responses by blocking both "
            "the driver mutation and adaptive MEK-dependent resistance."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "Wen et al. Lancet Oncol 2022 (ROAR basket trial); "
            "FDA Breakthrough Therapy Designation 2023"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "guideline_recommended",
    },
    {
        "biomarker": "BRAF V600E",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "Vemurafenib",
        "therapy_class": "BRAF inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "Vemurafenib selectively inhibits BRAF V600E kinase activity. "
            "Single-agent responses observed in V600E-mutant gliomas, though "
            "combination with MEK inhibitor preferred to delay resistance."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Kaley et al. Neuro-Oncol 2018 (VE-BASKET); "
            "Hargrave et al. Lancet Oncol 2019"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "guideline_recommended",
    },
    {
        "biomarker": "BRAF mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "MEK inhibitors",
        "therapy_class": "MEK inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "BRAF mutations (V600E and non-V600E) activate MAPK signaling. "
            "MEK inhibitors (trametinib, selumetinib) block downstream MEK1/2 "
            "and show activity in BRAF-altered pediatric low-grade gliomas."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Fangusaro et al. Lancet Oncol 2019 (selumetinib in pLGG); "
            "Bouffet et al. NEJM 2023 (tovorafenib in pLGG)"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "guideline_recommended",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # CDK4/6 / CDKN2A / RB1
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "CDKN2A deletion",
        "biomarker_status": "deleted",
        "biomarker_category": "amplification",
        "therapy_name": "CDK4/6 inhibitors",
        "therapy_class": "CDK inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "CDKN2A encodes p16INK4a, a natural CDK4/6 inhibitor. CDKN2A "
            "homozygous deletion removes this brake on CDK4/6, making "
            "tumors dependent on CDK4/6 activity and sensitive to pharmacologic "
            "inhibition (palbociclib, ribociclib, abemaciclib)."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Taylor et al. Neuro-Oncol 2018; "
            "Tien et al. Cancer Discov 2019; "
            "Sepulveda-Sanchez et al. Neuro-Oncol 2020"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    {
        "biomarker": "CDK4 amplification",
        "biomarker_status": "amplified",
        "biomarker_category": "amplification",
        "therapy_name": "CDK4/6 inhibitors",
        "therapy_class": "CDK inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "CDK4 amplification drives excessive CDK4 kinase activity and "
            "RB1 hyperphosphorylation. CDK4/6 inhibitors directly target the "
            "amplified driver, restoring cell cycle control."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Cen et al. JCO 2020; "
            "Wiedemeyer et al. Oncogene 2010"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    {
        "biomarker": "CDKN2A deletion",
        "biomarker_status": "deleted",
        "biomarker_category": "amplification",
        "therapy_name": "Temozolomide",
        "therapy_class": "Alkylating Agent",
        "response_effect": "decreased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "CDKN2A homozygous deletion is associated with more aggressive "
            "disease biology, higher proliferative index, and worse prognosis "
            "in IDH-mutant astrocytomas (WHO grade 4 upgrade criterion)."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "WHO 2021 CNS Classification; "
            "Shirahata et al. Acta Neuropathol 2018; "
            "Appay et al. Acta Neuropathol 2019"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "standard_of_care",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # PTEN / PI3K / mTOR PATHWAY
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "PTEN loss",
        "biomarker_status": "deleted",
        "biomarker_category": "expression",
        "therapy_name": "PI3K/mTOR inhibitors",
        "therapy_class": "PI3K/mTOR inhibitor",
        "response_effect": "sensitivity",
        "effect_size": "moderate",
        "mechanism_summary": (
            "PTEN loss derepresses PI3K/AKT/mTOR signaling. Tumors with PTEN "
            "loss are hyper-dependent on this pathway and may be more sensitive "
            "to PI3K or mTOR inhibitors."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "Cloughesy et al. PLoS Med 2008; "
            "Wen et al. JCO 2014 (buparlisib)"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    {
        "biomarker": "PIK3CA mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "PI3K inhibitors",
        "therapy_class": "PI3K/mTOR inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "Activating PIK3CA mutations (e.g., H1047R, E545K) constitutively "
            "activate PI3K signaling. PI3K inhibitors directly target the "
            "mutant driver kinase."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "Weber et al. Mol Cancer Ther 2011; "
            "Zhao et al. PNAS 2017"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # NF1
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "NF1 mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "MEK inhibitors",
        "therapy_class": "MEK inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "NF1 loss-of-function removes a key negative regulator of RAS/MAPK "
            "signaling. MEK inhibitors block the hyperactivated downstream "
            "pathway, showing activity in NF1-associated gliomas."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Gross et al. Ann Neurol 2020 (selumetinib in NF1-pLGG); "
            "Fangusaro et al. Lancet Oncol 2019"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "guideline_recommended",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # H3K27M (Diffuse Midline Glioma)
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "H3K27M mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "ONC201 (Dordaviprone)",
        "therapy_class": "DRD2 antagonist / ClpP agonist",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "ONC201 activates the mitochondrial protease ClpP and antagonizes "
            "DRD2. H3K27M-mutant diffuse midline gliomas show preferential "
            "sensitivity, with sustained radiographic responses and survival "
            "benefit in multiple studies."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Chi et al. Neuro-Oncol 2023; "
            "Arrillaga-Romany et al. Neuro-Oncol 2022; "
            "Gardner et al. ASCO 2023"
        ),
        "disease_context": "DMG",
        "clinical_actionability": "guideline_recommended",
    },
    {
        "biomarker": "H3K27M mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "HDAC inhibitors",
        "therapy_class": "HDAC inhibitor",
        "response_effect": "sensitivity",
        "effect_size": "moderate",
        "mechanism_summary": (
            "H3K27M mutation inhibits PRC2 complex, leading to global loss of "
            "H3K27me3. HDAC inhibitors (panobinostat, vorinostat) restore "
            "H3K27 acetylation patterns and reduce tumor viability in preclinical "
            "models of H3K27M-mutant glioma."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "Grasso et al. Nat Med 2015; "
            "Hashizume et al. Nat Med 2014"
        ),
        "disease_context": "DMG",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # 1p/19q CODELETION
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "1p/19q codeletion",
        "biomarker_status": "codeleted",
        "biomarker_category": "codeletion",
        "therapy_name": "PCV (Procarbazine + CCNU + Vincristine)",
        "therapy_class": "Alkylating Agent",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "1p/19q-codeleted oligodendrogliomas are exquisitely chemosensitive. "
            "Adjuvant PCV after radiation significantly extends overall survival "
            "by over a decade in codeleted tumors."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "Cairncross et al. JCO 2013 (RTOG 9402); "
            "van den Bent et al. JCO 2013 (EORTC 26951); "
            "Buckner et al. NEJM 2016 (RTOG 9802)"
        ),
        "disease_context": "Oligodendroglioma",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "1p/19q codeletion",
        "biomarker_status": "codeleted",
        "biomarker_category": "codeletion",
        "therapy_name": "Temozolomide",
        "therapy_class": "Alkylating Agent",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "1p/19q-codeleted tumors show high chemosensitivity to alkylating "
            "agents. TMZ is commonly used as an alternative to PCV in "
            "oligodendrogliomas with similar efficacy."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Jaeckle et al. Neuro-Oncol 2021 (CODEL); "
            "Baumert et al. Lancet 2016 (EORTC 22033)"
        ),
        "disease_context": "Oligodendroglioma",
        "clinical_actionability": "standard_of_care",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # PDGFRA
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "PDGFRA amplification",
        "biomarker_status": "amplified",
        "biomarker_category": "amplification",
        "therapy_name": "PDGFR inhibitors",
        "therapy_class": "Kinase Inhibitor",
        "response_effect": "sensitivity",
        "effect_size": "weak",
        "mechanism_summary": (
            "PDGFRA amplification is seen in ~15% of proneural GBM. "
            "Multi-kinase inhibitors targeting PDGFR (dasatinib, sunitinib) "
            "have shown limited single-agent activity in unselected GBM, "
            "though biomarker-selected approaches remain under investigation."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "Lassman et al. Neurology 2011; "
            "Reardon et al. Cancer 2012 (dasatinib)"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # MET
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "MET amplification",
        "biomarker_status": "amplified",
        "biomarker_category": "amplification",
        "therapy_name": "MET inhibitors",
        "therapy_class": "Kinase Inhibitor",
        "response_effect": "sensitivity",
        "effect_size": "moderate",
        "mechanism_summary": (
            "MET amplification or overexpression activates HGF/MET signaling, "
            "promoting invasion and therapeutic resistance. MET inhibitors "
            "(capmatinib, tepotinib) target this driver alteration."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "Wen et al. Neuro-Oncol 2011 (onartuzumab); "
            "Cloughesy et al. Neuro-Oncol 2017 (capmatinib)"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # FGFR
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "FGFR alteration",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "FGFR inhibitors",
        "therapy_class": "Kinase Inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "FGFR fusions (e.g., FGFR3-TACC3) and activating mutations drive "
            "oncogenic signaling. FGFR-selective inhibitors (futibatinib, "
            "erdafitinib, infigratinib) show activity in FGFR-altered gliomas."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Di Stefano et al. Clin Cancer Res 2015; "
            "Lassman et al. Neuro-Oncol 2022 (infigratinib)"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # NTRK FUSIONS
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "NTRK fusion",
        "biomarker_status": "present",
        "biomarker_category": "fusion",
        "therapy_name": "Larotrectinib",
        "therapy_class": "NTRK inhibitor",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "NTRK fusions produce constitutively active TRK kinases. "
            "Larotrectinib is a selective pan-TRK inhibitor with >75% ORR "
            "across NTRK-fusion tumors including CNS tumors."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "Drilon et al. NEJM 2018; "
            "Hong et al. Lancet Oncol 2020; "
            "FDA approved Nov 2018 (tumor-agnostic)"
        ),
        "disease_context": "Solid tumors",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "NTRK fusion",
        "biomarker_status": "present",
        "biomarker_category": "fusion",
        "therapy_name": "Entrectinib",
        "therapy_class": "NTRK inhibitor",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "Entrectinib is a CNS-penetrant TRK/ROS1/ALK inhibitor with "
            "demonstrated intracranial activity. NTRK-fusion CNS tumors "
            "show durable responses."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "Doebele et al. Lancet Oncol 2020; "
            "FDA approved Aug 2019 (tumor-agnostic)"
        ),
        "disease_context": "Solid tumors",
        "clinical_actionability": "standard_of_care",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # ALK / ROS1 FUSIONS
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "ALK fusion",
        "biomarker_status": "present",
        "biomarker_category": "fusion",
        "therapy_name": "ALK inhibitors",
        "therapy_class": "Kinase Inhibitor",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "ALK fusions drive constitutive kinase activity. ALK inhibitors "
            "(crizotinib, alectinib, lorlatinib) show activity across "
            "ALK-fusion tumors. Lorlatinib has CNS penetration."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Bender et al. Cancer Discov 2023 (infantile glioma); "
            "Drilon et al. NEJM 2023 (lorlatinib)"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "investigational",
    },
    {
        "biomarker": "ROS1 fusion",
        "biomarker_status": "present",
        "biomarker_category": "fusion",
        "therapy_name": "ROS1 inhibitors",
        "therapy_class": "Kinase Inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "ROS1 fusions produce constitutively active kinase signaling. "
            "ROS1 inhibitors (entrectinib, crizotinib) target this driver. "
            "Entrectinib preferred for CNS tumors due to BBB penetration."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Doebele et al. Lancet Oncol 2020; "
            "Davare et al. Cancer Cell 2018"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # IMMUNE / TMB / MSI
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "High TMB",
        "biomarker_status": "high",
        "biomarker_category": "other",
        "therapy_name": "Immune checkpoint inhibitors",
        "therapy_class": "Immune Checkpoint Inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "High tumor mutational burden generates more neoantigens, increasing "
            "tumor immunogenicity and response to PD-1/PD-L1 blockade. "
            "In GBM, hypermutated tumors (often post-TMZ) may benefit from "
            "checkpoint inhibition."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Marabelle et al. Ann Oncol 2020 (KEYNOTE-158); "
            "Touat et al. Nature 2020 (hypermutated glioma); "
            "FDA approved pembrolizumab for TMB-H tumors June 2020"
        ),
        "disease_context": "Solid tumors",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "MSI-H",
        "biomarker_status": "high",
        "biomarker_category": "other",
        "therapy_name": "Immune checkpoint inhibitors",
        "therapy_class": "Immune Checkpoint Inhibitor",
        "response_effect": "increased_response",
        "effect_size": "strong",
        "mechanism_summary": (
            "Microsatellite instability-high tumors have defective mismatch "
            "repair, generating abundant frameshift neoantigens and high "
            "immune infiltration. MSI-H is rare in primary GBM but can occur "
            "in hypermutated recurrent cases."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "Le et al. NEJM 2015; Le et al. Science 2017; "
            "FDA approved pembrolizumab for MSI-H tumors May 2017"
        ),
        "disease_context": "Solid tumors",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "PD-L1 expression",
        "biomarker_status": "high",
        "biomarker_category": "expression",
        "therapy_name": "Immune checkpoint inhibitors",
        "therapy_class": "Immune Checkpoint Inhibitor",
        "response_effect": "sensitivity",
        "effect_size": "weak",
        "mechanism_summary": (
            "PD-L1 expression on tumor cells can indicate an inflamed tumor "
            "microenvironment. In GBM, PD-L1 is a weak predictive biomarker; "
            "CheckMate-143 showed no benefit for nivolumab in unselected "
            "recurrent GBM regardless of PD-L1 status."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Reardon et al. JAMA Oncol 2020 (CheckMate-143); "
            "Nduom et al. Neuro-Oncol 2016"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # TP53 / MDM2
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "TP53 mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "MDM2 inhibitors",
        "therapy_class": "MDM2 inhibitor",
        "response_effect": "resistance",
        "effect_size": "strong",
        "mechanism_summary": (
            "MDM2 inhibitors work by releasing wild-type p53 from MDM2-mediated "
            "degradation. TP53-mutant tumors express a non-functional p53 protein "
            "that cannot be reactivated, conferring intrinsic resistance."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Verreault et al. Neuro-Oncol 2016; "
            "Patnaik et al. Cancer Discov 2015"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    {
        "biomarker": "MDM2 amplification",
        "biomarker_status": "amplified",
        "biomarker_category": "amplification",
        "therapy_name": "MDM2 inhibitors",
        "therapy_class": "MDM2 inhibitor",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "MDM2 amplification drives excessive p53 degradation in tumors "
            "retaining wild-type TP53. MDM2 inhibitors (idasanutlin, milademetan) "
            "release p53 to restore apoptosis."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "Verreault et al. Neuro-Oncol 2016; "
            "Cancer Genome Atlas Research Network. Cell 2013"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # ATRX
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "ATRX mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "PARP inhibitors",
        "therapy_class": "PARP inhibitor",
        "response_effect": "sensitivity",
        "effect_size": "moderate",
        "mechanism_summary": (
            "ATRX loss leads to alternative lengthening of telomeres (ALT) and "
            "impaired homologous recombination at telomeres. ATRX-deficient "
            "tumors may be more vulnerable to PARP inhibition through "
            "replication stress and DNA repair defects."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "Deeg et al. Clin Cancer Res 2017; "
            "Hanna et al. Nat Commun 2021"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # TERT PROMOTER
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "TERT promoter mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "Temozolomide",
        "therapy_class": "Alkylating Agent",
        "response_effect": "decreased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "In IDH-wild-type GBM, TERT promoter mutations are associated with "
            "aggressive biology and poorer prognosis. Combined with EGFR "
            "amplification and +7/-10, they define the molecular GBM subtype "
            "with generally poor response to standard therapy."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Killela et al. PNAS 2013; "
            "Eckel-Passow et al. NEJM 2015; "
            "Labussiere et al. Neuro-Oncol 2014"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "standard_of_care",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # ANGIOGENESIS / VEGF
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "EGFR amplification",
        "biomarker_status": "amplified",
        "biomarker_category": "amplification",
        "therapy_name": "Bevacizumab",
        "therapy_class": "Angiogenesis Inhibitor",
        "response_effect": "no_effect",
        "effect_size": "moderate",
        "mechanism_summary": (
            "EGFR amplification status does not predict differential benefit "
            "from bevacizumab in GBM. Phase III trials (AVAglio, RTOG 0825) "
            "showed no OS benefit regardless of EGFR status."
        ),
        "evidence_level": "level_1",
        "evidence_sources": (
            "Chinot et al. NEJM 2014 (AVAglio); "
            "Gilbert et al. NEJM 2014 (RTOG 0825)"
        ),
        "disease_context": "GBM",
        "clinical_actionability": "standard_of_care",
    },
    {
        "biomarker": "IDH mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "Bevacizumab",
        "therapy_class": "Angiogenesis Inhibitor",
        "response_effect": "decreased_response",
        "effect_size": "weak",
        "mechanism_summary": (
            "IDH-mutant gliomas typically have lower vascularity and less "
            "angiogenic drive compared to IDH-wild-type GBM, potentially "
            "reducing the benefit of anti-VEGF therapy."
        ),
        "evidence_level": "level_3",
        "evidence_sources": (
            "Lai et al. Neuro-Oncol 2011; "
            "Baumert et al. Lancet 2016 (EORTC 22033)"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "investigational",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # G-CIMP / EXPRESSION SUBTYPES
    # ═══════════════════════════════════════════════════════════════════════
    {
        "biomarker": "IDH mutation",
        "biomarker_status": "mutant",
        "biomarker_category": "mutation",
        "therapy_name": "Radiation therapy",
        "therapy_class": "Radiation",
        "response_effect": "increased_response",
        "effect_size": "moderate",
        "mechanism_summary": (
            "IDH-mutant gliomas (especially those with G-CIMP phenotype) show "
            "better overall prognosis and response to radiotherapy compared to "
            "IDH-wild-type tumors, partly due to impaired DNA damage repair "
            "from 2-HG-mediated effects."
        ),
        "evidence_level": "level_2",
        "evidence_sources": (
            "Cairncross et al. JCO 2014; "
            "Li et al. Cell Reports 2016"
        ),
        "disease_context": "Glioma",
        "clinical_actionability": "standard_of_care",
    },
]
# fmt: on


def main() -> int:
    engine = create_db_engine()
    init_db(engine)  # ensures table exists
    SessionFactory = get_session_factory(engine)

    with SessionFactory() as session:
        # Clear existing associations to allow re-population
        existing = session.query(BiomarkerTherapyAssociation).count()
        if existing > 0:
            print(f"Clearing {existing} existing associations...")
            session.query(BiomarkerTherapyAssociation).delete()
            session.commit()

        print(f"Inserting {len(ASSOCIATIONS)} curated biomarker-therapy associations...")
        for assoc_data in ASSOCIATIONS:
            record = BiomarkerTherapyAssociation(**assoc_data)
            session.add(record)

        session.commit()
        final_count = session.query(BiomarkerTherapyAssociation).count()
        print(f"Done. {final_count} associations in database.")

        # Summary by category
        from collections import Counter
        cats = Counter()
        effects = Counter()
        evidence = Counter()
        for a in ASSOCIATIONS:
            cats[a["biomarker_category"]] += 1
            effects[a["response_effect"]] += 1
            evidence[a["evidence_level"]] += 1

        print(f"\nBy biomarker category: {dict(cats)}")
        print(f"By response effect: {dict(effects)}")
        print(f"By evidence level: {dict(evidence)}")

        # List unique biomarkers
        biomarkers = sorted(set(a["biomarker"] for a in ASSOCIATIONS))
        print(f"\n{len(biomarkers)} unique biomarkers: {biomarkers}")

        therapies = sorted(set(a["therapy_name"] for a in ASSOCIATIONS))
        print(f"\n{len(therapies)} unique therapies: {therapies}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
