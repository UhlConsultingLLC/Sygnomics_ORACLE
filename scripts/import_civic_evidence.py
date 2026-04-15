"""
Import CIViC predictive evidence into the biomarker_therapy_associations table.

Downloads the CIViC nightly evidence export, filters for CNS-tumor-relevant
and tumor-agnostic (Level A/B) predictive evidence matching our target genes,
and inserts new associations alongside the manually curated entries.

CIViC-sourced entries are tagged with data_source='civic' in the
evidence_sources field prefix for easy identification.

Usage:
    python scripts/import_civic_evidence.py [--force-download]
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from connectors.civic import (
    CIViCEvidence,
    download_nightly_evidence,
    filter_relevant_evidence,
)
from database.engine import create_db_engine, get_session_factory, init_db
from database.models import BiomarkerTherapyAssociation


def _effect_size_from_level(evidence: CIViCEvidence) -> str:
    """Infer effect size from evidence level and rating."""
    if evidence.evidence_level == "A":
        return "strong"
    if evidence.evidence_level == "B":
        return "moderate" if evidence.rating >= 3 else "moderate"
    if evidence.evidence_level == "C":
        return "moderate"
    if evidence.evidence_level == "D":
        return "weak"
    return "variable"


def _clinical_actionability(evidence: CIViCEvidence) -> str:
    """Infer clinical actionability from evidence level."""
    if evidence.evidence_level == "A":
        return "standard_of_care"
    if evidence.evidence_level == "B":
        return "guideline_recommended"
    if evidence.evidence_level in ("C", "D"):
        return "investigational"
    return "emerging"


def _therapy_class_from_therapies(therapies: str, biomarker: str) -> str:
    """Best-effort mapping of therapy names to therapy class."""
    tl = therapies.lower()

    if "temozolomide" in tl or "carmustine" in tl or "pcv" in tl or "lomustine" in tl:
        return "Alkylating Agent"
    if "dabrafenib" in tl or "vemurafenib" in tl or "tovorafenib" in tl:
        if "trametinib" in tl:
            return "BRAF inhibitor + MEK inhibitor"
        return "BRAF inhibitor"
    if "trametinib" in tl or "selumetinib" in tl or "cobimetinib" in tl or "binimetinib" in tl:
        return "MEK inhibitor"
    if "vorasidenib" in tl:
        return "IDH inhibitor"
    if "ivosidenib" in tl:
        return "IDH inhibitor"
    if "enasidenib" in tl:
        return "IDH inhibitor"
    if "entrectinib" in tl or "larotrectinib" in tl:
        return "NTRK inhibitor"
    if "crizotinib" in tl or "alectinib" in tl or "lorlatinib" in tl or "ceritinib" in tl or "brigatinib" in tl:
        return "ALK inhibitor"
    if "erlotinib" in tl or "gefitinib" in tl or "afatinib" in tl or "osimertinib" in tl or "dacomitinib" in tl:
        return "EGFR inhibitor"
    if "rindopepimut" in tl:
        return "Cancer Vaccine"
    if "bevacizumab" in tl:
        return "Angiogenesis Inhibitor"
    if "nivolumab" in tl or "pembrolizumab" in tl or "atezolizumab" in tl:
        return "Immune Checkpoint Inhibitor"
    if "palbociclib" in tl or "ribociclib" in tl or "abemaciclib" in tl:
        return "CDK inhibitor"
    if "olaparib" in tl or "niraparib" in tl or "pamiparib" in tl:
        return "PARP inhibitor"
    if "dordaviprone" in tl or "onc201" in tl or "onc-201" in tl:
        return "DRD2 antagonist / ClpP agonist"
    if "erdafitinib" in tl or "infigratinib" in tl or "pemigatinib" in tl or "futibatinib" in tl:
        return "FGFR inhibitor"
    if "capmatinib" in tl or "tepotinib" in tl:
        return "MET inhibitor"
    if "alpelisib" in tl or "buparlisib" in tl or "inavolisib" in tl:
        return "PI3K inhibitor"
    if "everolimus" in tl:
        return "mTOR inhibitor"
    if "imatinib" in tl or "sunitinib" in tl or "dasatinib" in tl:
        return "Kinase Inhibitor"

    # Fallback based on biomarker
    biomarker_class_hints = {
        "EGFR": "EGFR inhibitor",
        "BRAF": "BRAF inhibitor",
        "IDH": "IDH inhibitor",
        "NTRK": "NTRK inhibitor",
        "ALK": "ALK inhibitor",
        "ROS1": "ROS1 inhibitor",
        "FGFR": "FGFR inhibitor",
        "MET": "MET inhibitor",
    }
    for keyword, cls in biomarker_class_hints.items():
        if keyword in biomarker.upper():
            return cls

    return ""


def evidence_to_association(ev: CIViCEvidence) -> dict:
    """Convert a CIViCEvidence to BiomarkerTherapyAssociation field dict."""
    biomarker = ev.biomarker_name
    return {
        "biomarker": biomarker,
        "biomarker_status": ev.biomarker_status,
        "biomarker_category": ev.biomarker_category,
        "therapy_name": ev.therapies,
        "therapy_class": _therapy_class_from_therapies(ev.therapies, biomarker),
        "response_effect": ev.response_effect,
        "effect_size": _effect_size_from_level(ev),
        "mechanism_summary": ev.evidence_statement[:2000] if ev.evidence_statement else "",
        "evidence_level": ev.mapped_evidence_level,
        "evidence_sources": (
            f"[CIViC EID{ev.evidence_id}] {ev.citation}"
            + (f" (PMID:{ev.citation_id})" if ev.citation_id else "")
        ),
        "disease_context": ev.disease,
        "clinical_actionability": _clinical_actionability(ev),
    }


def _dedup_key(assoc: dict) -> tuple:
    """Create dedup key from biomarker + therapy + effect."""
    return (
        assoc["biomarker"].lower(),
        assoc["therapy_name"].lower(),
        assoc["response_effect"],
        assoc["disease_context"].lower(),
    )


def main() -> int:
    force = "--force-download" in sys.argv

    print("Downloading CIViC nightly evidence...")
    all_evidence = download_nightly_evidence(force=force)
    print(f"  {len(all_evidence)} total evidence items")

    print("Filtering for relevant predictive evidence...")
    relevant = filter_relevant_evidence(all_evidence, include_non_glioma_gene_matches=True)
    print(f"  {len(relevant)} relevant items after filtering")

    # Convert to association dicts
    associations = [evidence_to_association(ev) for ev in relevant]

    # Deduplicate — keep highest evidence level per unique key
    level_priority = {"level_1": 0, "level_2": 1, "level_3": 2, "level_4": 3}
    best: dict[tuple, dict] = {}
    for assoc in associations:
        key = _dedup_key(assoc)
        if key not in best:
            best[key] = assoc
        else:
            # Keep higher evidence level
            existing_pri = level_priority.get(best[key]["evidence_level"], 99)
            new_pri = level_priority.get(assoc["evidence_level"], 99)
            if new_pri < existing_pri:
                best[key] = assoc

    deduped = list(best.values())
    print(f"  {len(deduped)} unique associations after dedup")

    # Insert into database
    engine = create_db_engine()
    init_db(engine)
    SessionFactory = get_session_factory(engine)

    with SessionFactory() as session:
        # Remove previous CIViC imports (preserve manual entries)
        civic_existing = (
            session.query(BiomarkerTherapyAssociation)
            .filter(BiomarkerTherapyAssociation.evidence_sources.like("[CIViC%"))
            .count()
        )
        if civic_existing > 0:
            print(f"  Removing {civic_existing} previous CIViC entries...")
            session.query(BiomarkerTherapyAssociation).filter(
                BiomarkerTherapyAssociation.evidence_sources.like("[CIViC%")
            ).delete(synchronize_session="fetch")
            session.commit()

        # Also check for duplicates against manually curated entries
        manual_keys: set[tuple] = set()
        for row in session.query(BiomarkerTherapyAssociation).all():
            manual_keys.add((
                row.biomarker.lower(),
                row.therapy_name.lower(),
                row.response_effect,
            ))

        inserted = 0
        skipped_dup = 0
        for assoc in deduped:
            # Check if a manual entry already covers this biomarker+therapy+effect
            check_key = (
                assoc["biomarker"].lower(),
                assoc["therapy_name"].lower(),
                assoc["response_effect"],
            )
            if check_key in manual_keys:
                skipped_dup += 1
                continue

            record = BiomarkerTherapyAssociation(**assoc)
            session.add(record)
            inserted += 1

        session.commit()
        total = session.query(BiomarkerTherapyAssociation).count()
        civic_count = (
            session.query(BiomarkerTherapyAssociation)
            .filter(BiomarkerTherapyAssociation.evidence_sources.like("[CIViC%"))
            .count()
        )

    print(f"\nResults:")
    print(f"  Inserted: {inserted} CIViC associations")
    print(f"  Skipped (duplicate of manual): {skipped_dup}")
    print(f"  Total associations in DB: {total} ({total - civic_count} manual + {civic_count} CIViC)")

    # Summary by biomarker
    from collections import Counter
    biomarkers = Counter(a["biomarker"] for a in deduped)
    print(f"\nCIViC biomarker coverage ({len(biomarkers)} unique):")
    for bm, cnt in biomarkers.most_common():
        print(f"  {bm}: {cnt}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
