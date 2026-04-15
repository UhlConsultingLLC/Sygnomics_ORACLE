"""Screen all trials for intercavitary delivery mechanisms and flag them in the DB.

Classification:
  - "confirmed": The trial ACTIVELY USES intercavitary delivery as its treatment
    approach.  Evidence found in the trial title, arms, interventions, or the
    brief summary describing the study design.
  - "mentioned": Intercavitary delivery is REFERENCED but only in eligibility
    criteria (often as exclusion of prior therapy) or only in the detailed
    description as background context.  The trial itself may not use
    intercavitary delivery.
  - "none": No intercavitary delivery signal detected.
"""

import re
import sys

from database.engine import create_db_engine, get_session_factory, init_db
from database.models import (
    ArmRecord,
    EligibilityRecord,
    InterventionRecord,
    TrialRecord,
    trial_interventions,
)
from config.schema import load_config

# ── Intercavitary delivery regex patterns ────────────────────────────────

PATTERN_LABELS = {
    "intracavitary": [r"intracavit", r"intra[\s-]?cavit"],
    "tumor_cavity": [
        r"into\s+(?:the\s+)?(?:surgical\s+)?(?:resection\s+)?cavit",
        r"tumor\s+cavit",
        r"tumou?r[\s-]?bed\s+(?:deliver|implant|inject|treat|infus)",
    ],
    "CED": [r"convection[\s-]?enhanced[\s-]?deliver", r"\bCED\b"],
    "gliadel_wafer": [
        r"gliadel",
        r"carmustine\s+wafer",
        r"bcnu\s+wafer",
        r"polymer\s+wafer",
        r"drug[\s-]?eluting\s+wafer",
        r"wafer\s+implant",
    ],
    "intratumoral": [r"intratumor", r"intra[\s-]?tumou?ral"],
    "ommaya": [r"ommaya"],
    "intracerebral_delivery": [r"intracerebral\s+(?:infus|deliver|inject|admin)"],
    "intraventricular_delivery": [
        r"intraventricular\s+(?:infus|deliver|inject|admin|chemother)",
    ],
    "stereotactic_injection": [r"stereotactic\s+(?:inject|infus|deliver)"],
    "catheter_delivery": [
        r"intracranial\s+catheter",
        r"catheter.*(?:intracranial|intracerebral).*(?:deliver|infus)",
    ],
    "local_delivery": [
        r"local\s+(?:drug\s+)?deliver.*(?:brain|tumor|tumour|glioma|glioblastoma|cavity)",
        r"direct\s+(?:inject|infus|deliver).*(?:brain|tumor|tumour|cavity)",
    ],
    "interstitial_chemo": [r"interstitial\s+(?:chemother|brachy|deliver|infus)"],
    "implanted_device": [
        r"(?:implant|microchip|depot).*(?:deliver|release).*(?:brain|tumor|tumour|intracranial)",
    ],
    "ultrasound_delivery": [
        r"sonocloud",
        r"focused\s+ultrasound.*(?:deliver|open.*barrier|BBB|permeab)",
        r"blood[\s-]?brain\s+barrier\s+(?:open|disrupt).*(?:deliver|chemother)",
    ],
    "intra_arterial": [
        r"intra[\s-]?arterial.*(?:brain|cerebr|intracranial|glioma|glioblastoma)",
    ],
}


def classify_text(text: str) -> set[str]:
    """Return set of intercavitary delivery mechanism labels found in text."""
    if not text:
        return set()
    labels = set()
    for label, patterns in PATTERN_LABELS.items():
        for p in patterns:
            if re.search(p, text, re.IGNORECASE):
                labels.add(label)
                break
    return labels


def screen_trial(db, nct_id: str) -> dict | None:
    """Screen a single trial for intercavitary delivery.

    Returns a dict with 'flag' ("confirmed" or "mentioned"), 'mechanisms',
    and 'match_locations', or None if no signal found.
    """
    record = db.get(TrialRecord, nct_id)
    if not record:
        return None

    # ── "Confirmed" sources: title, summary, arms, interventions ──
    # These indicate the trial itself uses intercavitary delivery.
    confirmed_labels = set()
    confirmed_locations = set()

    for field_name, text in [
        ("title", record.title),
        ("summary", record.brief_summary),
    ]:
        labels = classify_text(text)
        if labels:
            confirmed_labels |= labels
            confirmed_locations.add(field_name)

    # Arms — if it's in the arm label/description, the trial uses it
    for arm in db.query(ArmRecord).filter_by(trial_nct_id=nct_id).all():
        text = f"{arm.label} {arm.description}"
        labels = classify_text(text)
        if labels:
            confirmed_labels |= labels
            confirmed_locations.add("arms")

    # Interventions — if the drug/intervention itself is intercavitary
    ivs = (
        db.query(InterventionRecord)
        .join(trial_interventions, InterventionRecord.id == trial_interventions.c.intervention_id)
        .filter(trial_interventions.c.trial_nct_id == nct_id)
        .all()
    )
    for iv in ivs:
        text = f"{iv.name} {iv.description}"
        labels = classify_text(text)
        if labels:
            confirmed_labels |= labels
            confirmed_locations.add("interventions")

    # ── "Mentioned" sources: eligibility, detailed description ──
    # Often these are exclusion criteria or background context.
    mentioned_labels = set()
    mentioned_locations = set()

    # Detailed description — may be background context
    desc_labels = classify_text(record.detailed_description)
    if desc_labels:
        mentioned_labels |= desc_labels
        mentioned_locations.add("description")

    # Eligibility criteria
    elig = db.query(EligibilityRecord).filter_by(trial_nct_id=nct_id).first()
    if elig and elig.criteria_text:
        labels = classify_text(elig.criteria_text)
        if labels:
            mentioned_labels |= labels
            mentioned_locations.add("eligibility")

    all_labels = confirmed_labels | mentioned_labels
    if not all_labels:
        return None

    # Determine flag level
    if confirmed_labels:
        flag = "confirmed"
    else:
        flag = "mentioned"

    all_locations = confirmed_locations | mentioned_locations

    return {
        "nct_id": nct_id,
        "source": record.source,
        "title": record.title,
        "flag": flag,
        "mechanisms": sorted(all_labels),
        "confirmed_mechanisms": sorted(confirmed_labels),
        "mentioned_only_mechanisms": sorted(mentioned_labels - confirmed_labels),
        "match_locations": sorted(all_locations),
    }


def main():
    config = load_config()
    engine = create_db_engine(config.database)
    init_db(engine)  # Ensure new columns exist
    sf = get_session_factory(engine)
    db = sf()

    all_trials = db.query(TrialRecord.nct_id, TrialRecord.source).order_by(TrialRecord.nct_id).all()
    print(f"Screening {len(all_trials)} trials for intercavitary delivery mechanisms...\n")

    confirmed_results = []
    mentioned_results = []

    for nct_id, source in all_trials:
        hit = screen_trial(db, nct_id)
        if hit:
            if hit["flag"] == "confirmed":
                confirmed_results.append(hit)
            else:
                mentioned_results.append(hit)

            # ── Write flag to database ──
            record = db.get(TrialRecord, nct_id)
            if record:
                record.intercavitary_delivery = hit["flag"]
                record.intercavitary_mechanisms = ", ".join(hit["mechanisms"])

    # Reset any previously flagged trials that no longer match
    unflagged = 0
    for nct_id, source in all_trials:
        record = db.get(TrialRecord, nct_id)
        if record and nct_id not in {r["nct_id"] for r in confirmed_results + mentioned_results}:
            if record.intercavitary_delivery != "none":
                record.intercavitary_delivery = "none"
                record.intercavitary_mechanisms = ""
                unflagged += 1

    db.commit()

    # ── Report ──
    total_flagged = len(confirmed_results) + len(mentioned_results)

    print("=" * 90)
    print("INTERCAVITARY DELIVERY SCREENING RESULTS")
    print("=" * 90)
    print(f"Total trials screened:  {len(all_trials)}")
    print(f"Trials flagged:        {total_flagged}")
    print(f"  CONFIRMED (active):  {len(confirmed_results)}")
    print(f"    CT.gov:            {sum(1 for r in confirmed_results if r['source'] == 'ctgov')}")
    print(f"    CTIS:              {sum(1 for r in confirmed_results if r['source'] == 'ctis')}")
    print(f"  MENTIONED (ref only):{len(mentioned_results)}")
    print(f"    CT.gov:            {sum(1 for r in mentioned_results if r['source'] == 'ctgov')}")
    print(f"    CTIS:              {sum(1 for r in mentioned_results if r['source'] == 'ctis')}")
    print(f"  Unflagged/reset:     {unflagged}")
    print()

    # Mechanism distribution
    mech_counts = {}
    for r in confirmed_results:
        for m in r["mechanisms"]:
            mech_counts[m] = mech_counts.get(m, 0) + 1
    print("Mechanism distribution (CONFIRMED trials only):")
    for mech, count in sorted(mech_counts.items(), key=lambda x: -x[1]):
        print(f"  {mech:30s}  {count:4d} trials")
    print()

    # Print confirmed trials
    print("=" * 90)
    print(f"CONFIRMED INTERCAVITARY DELIVERY TRIALS ({len(confirmed_results)}):")
    print("=" * 90)
    for r in confirmed_results:
        src_tag = "EU" if r["source"] == "ctis" else "US"
        mechs = ", ".join(r["mechanisms"])
        locs = ", ".join(r["match_locations"])
        title = r["title"][:85] + "..." if len(r["title"]) > 85 else r["title"]
        print(f"\n[{src_tag}] {r['nct_id']}")
        print(f"    Title: {title}")
        print(f"    Mechanisms: {mechs}")
        print(f"    Found in: {locs}")

    # Print mentioned-only trials (abbreviated)
    print()
    print("=" * 90)
    print(f"MENTIONED-ONLY TRIALS ({len(mentioned_results)}):")
    print("  (Intercavitary delivery referenced in eligibility/description only)")
    print("=" * 90)
    for r in mentioned_results:
        src_tag = "EU" if r["source"] == "ctis" else "US"
        mechs = ", ".join(r["mechanisms"])
        title = r["title"][:75] + "..." if len(r["title"]) > 75 else r["title"]
        print(f"  [{src_tag}] {r['nct_id']}  mechs=[{mechs}]  {title}")

    print(f"\n{'='*90}")
    print(f"Database updated: {total_flagged} trials flagged ({len(confirmed_results)} confirmed, {len(mentioned_results)} mentioned)")
    print("=" * 90)

    db.close()
    return confirmed_results, mentioned_results


if __name__ == "__main__":
    main()
