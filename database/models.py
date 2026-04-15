"""SQLAlchemy ORM models for the clinical trial database."""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# Many-to-many association tables
trial_conditions = Table(
    "trial_conditions",
    Base.metadata,
    Column("trial_nct_id", String, ForeignKey("trials.nct_id"), primary_key=True),
    Column("condition_id", Integer, ForeignKey("conditions.id"), primary_key=True),
)

trial_interventions = Table(
    "trial_interventions",
    Base.metadata,
    Column("trial_nct_id", String, ForeignKey("trials.nct_id"), primary_key=True),
    Column("intervention_id", Integer, ForeignKey("interventions.id"), primary_key=True),
)


class TrialRecord(Base):
    __tablename__ = "trials"

    nct_id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(Text, default="")
    brief_summary: Mapped[str] = mapped_column(Text, default="")
    detailed_description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(50), default="")
    phase: Mapped[str] = mapped_column(String(50), default="")
    study_type: Mapped[str] = mapped_column(String(50), default="")
    enrollment_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    completion_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    results_url: Mapped[str] = mapped_column(Text, default="")
    # Data source: "ctgov" for ClinicalTrials.gov, "ctis" for EU CTIS
    source: Mapped[str] = mapped_column(String(20), default="ctgov")
    # Cross-reference to other registry IDs (e.g. NCT ID for CTIS trials)
    cross_reference_id: Mapped[str] = mapped_column(String(50), default="")
    # Intercavitary delivery flag: "none", "confirmed", "mentioned"
    #   confirmed = trial actively uses intercavitary delivery (in title, arms, interventions)
    #   mentioned = intercavitary delivery referenced only in eligibility criteria (often exclusions)
    intercavitary_delivery: Mapped[str] = mapped_column(String(20), default="none")
    # Comma-separated list of specific intercavitary mechanisms detected
    intercavitary_mechanisms: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    conditions: Mapped[list["ConditionRecord"]] = relationship(
        secondary=trial_conditions, back_populates="trials"
    )
    interventions: Mapped[list["InterventionRecord"]] = relationship(
        secondary=trial_interventions, back_populates="trials"
    )
    outcomes: Mapped[list["OutcomeRecord"]] = relationship(back_populates="trial")
    arms: Mapped[list["ArmRecord"]] = relationship(back_populates="trial")
    eligibility: Mapped[Optional["EligibilityRecord"]] = relationship(
        back_populates="trial", uselist=False
    )
    sponsor: Mapped[Optional["SponsorRecord"]] = relationship(back_populates="trials")
    locations: Mapped[list["LocationRecord"]] = relationship(back_populates="trial")

    sponsor_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("sponsors.id"), nullable=True
    )


class ConditionRecord(Base):
    __tablename__ = "conditions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(500), unique=True)
    mesh_id: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    trials: Mapped[list[TrialRecord]] = relationship(
        secondary=trial_conditions, back_populates="conditions"
    )


class InterventionRecord(Base):
    __tablename__ = "interventions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(500))
    intervention_type: Mapped[str] = mapped_column(String(50), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    chembl_id: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    trials: Mapped[list[TrialRecord]] = relationship(
        secondary=trial_interventions, back_populates="interventions"
    )
    moa_annotations: Mapped[list["MOAAnnotationRecord"]] = relationship(
        back_populates="intervention"
    )


class OutcomeRecord(Base):
    __tablename__ = "outcomes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trial_nct_id: Mapped[str] = mapped_column(String, ForeignKey("trials.nct_id"))
    type: Mapped[str] = mapped_column(String(20), default="")  # PRIMARY, SECONDARY, OTHER
    measure: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    time_frame: Mapped[str] = mapped_column(String(200), default="")
    # JSON-encoded list of result measurements (one per arm/group)
    results_json: Mapped[str] = mapped_column(Text, default="")

    trial: Mapped[TrialRecord] = relationship(back_populates="outcomes")


class ArmRecord(Base):
    __tablename__ = "arms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trial_nct_id: Mapped[str] = mapped_column(String, ForeignKey("trials.nct_id"))
    label: Mapped[str] = mapped_column(String(500), default="")
    type: Mapped[str] = mapped_column(String(50), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    # Comma-separated intervention names assigned to this arm by CT.gov
    intervention_names: Mapped[str] = mapped_column(Text, default="")

    trial: Mapped[TrialRecord] = relationship(back_populates="arms")


class EligibilityRecord(Base):
    __tablename__ = "eligibility"

    trial_nct_id: Mapped[str] = mapped_column(
        String, ForeignKey("trials.nct_id"), primary_key=True
    )
    criteria_text: Mapped[str] = mapped_column(Text, default="")
    min_age: Mapped[str] = mapped_column(String(50), default="")
    max_age: Mapped[str] = mapped_column(String(50), default="")
    sex: Mapped[str] = mapped_column(String(20), default="ALL")
    healthy_volunteers: Mapped[bool] = mapped_column(Boolean, default=False)

    trial: Mapped[TrialRecord] = relationship(back_populates="eligibility")


class SponsorRecord(Base):
    __tablename__ = "sponsors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(500), unique=True)
    type: Mapped[str] = mapped_column(String(50), default="")

    trials: Mapped[list[TrialRecord]] = relationship(back_populates="sponsor")


class LocationRecord(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trial_nct_id: Mapped[str] = mapped_column(String, ForeignKey("trials.nct_id"))
    facility: Mapped[str] = mapped_column(String(500), default="")
    city: Mapped[str] = mapped_column(String(200), default="")
    state: Mapped[str] = mapped_column(String(200), default="")
    country: Mapped[str] = mapped_column(String(200), default="")
    zip_code: Mapped[str] = mapped_column(String(20), default="")

    trial: Mapped[TrialRecord] = relationship(back_populates="locations")


class MOAAnnotationRecord(Base):
    __tablename__ = "moa_annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    intervention_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("interventions.id")
    )
    target_chembl_id: Mapped[str] = mapped_column(String(20), default="")
    target_name: Mapped[str] = mapped_column(String(500), default="")
    target_gene_symbol: Mapped[str] = mapped_column(String(50), default="")
    action_type: Mapped[str] = mapped_column(String(100), default="")
    mechanism_description: Mapped[str] = mapped_column(Text, default="")
    moa_category: Mapped[str] = mapped_column(String(100), default="")
    # Short-hand MOA names from Open Targets resolution
    moa_short_form: Mapped[str] = mapped_column(String(200), default="")
    moa_broad_category: Mapped[str] = mapped_column(String(200), default="")
    # Source of MOA data: "open_targets", "chembl", or "manual"
    data_source: Mapped[str] = mapped_column(String(50), default="")

    intervention: Mapped[InterventionRecord] = relationship(
        back_populates="moa_annotations"
    )


class WHOClassificationRecord(Base):
    """WHO 2021 CNS classification profile for a clinical trial.

    Stores the inferred WHO 2021 glioma subtypes and molecular requirements
    extracted from each trial's eligibility criteria.
    """

    __tablename__ = "who_classifications"

    trial_nct_id: Mapped[str] = mapped_column(
        String, ForeignKey("trials.nct_id"), primary_key=True
    )
    # Comma-separated WHO 2021 type names the trial targets
    who_types: Mapped[str] = mapped_column(Text, default="")
    # Grade range
    who_grade_min: Mapped[str] = mapped_column(String(20), default="Unknown")
    who_grade_max: Mapped[str] = mapped_column(String(20), default="Unknown")
    # Molecular requirements: "required", "excluded", "any", "mentioned", "unknown"
    idh_status: Mapped[str] = mapped_column(String(20), default="unknown")
    codeletion_1p19q: Mapped[str] = mapped_column(String(20), default="unknown")
    mgmt_status: Mapped[str] = mapped_column(String(20), default="unknown")
    cdkn2a_status: Mapped[str] = mapped_column(String(20), default="unknown")
    h3k27m_status: Mapped[str] = mapped_column(String(20), default="unknown")
    # Classification confidence: "high", "medium", "low"
    confidence: Mapped[str] = mapped_column(String(10), default="low")
    # Number of biomarker criteria found in eligibility text
    biomarker_count: Mapped[int] = mapped_column(Integer, default=0)

    trial: Mapped[TrialRecord] = relationship()


class TrialSATGBMMetric(Base):
    """Per-trial-drug SATGBM simulation metrics.

    Captures the comparison between a trial's eligibility-based enrolment and
    SATGBM's molecular (DCNA + expression) selection for each trial × drug ×
    MOA-category combination.  Stores the two key headline metrics:

      * percentage of predicted responders *recovered* (responders excluded by
        trial criteria / total predicted responders).
      * fold change of identified responders (total SATGBM predicted
        responders / trial-eligible responders).
    """

    __tablename__ = "trial_satgbm_metrics"
    __table_args__ = (
        UniqueConstraint(
            "trial_nct_id", "intervention_id", "moa_category", "arm_id", "group_title",
            name="uq_trial_satgbm_metrics_scope",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trial_nct_id: Mapped[str] = mapped_column(String, ForeignKey("trials.nct_id"))
    intervention_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("interventions.id")
    )
    drug_name: Mapped[str] = mapped_column(String(500), default="")
    moa_category: Mapped[str] = mapped_column(String(200), default="")

    # Optional scope (for arm / sub-group analyses); NULL means full-trial scope
    arm_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    group_title: Mapped[str] = mapped_column(String(500), default="")

    # Simulation parameters
    learned_dcna_threshold: Mapped[float] = mapped_column(Float, default=0.0)
    expression_threshold: Mapped[float] = mapped_column(Float, default=0.0)

    # Cohort counts
    total_scored: Mapped[int] = mapped_column(Integer, default=0)
    enrolled_by_criteria: Mapped[int] = mapped_column(Integer, default=0)
    responders_enrolled: Mapped[int] = mapped_column(Integer, default=0)
    responders_excluded: Mapped[int] = mapped_column(Integer, default=0)
    total_responders: Mapped[int] = mapped_column(Integer, default=0)
    n_biomarker_rules: Mapped[int] = mapped_column(Integer, default=0)

    # Headline metrics
    pct_responders_recovered: Mapped[float] = mapped_column(Float, default=0.0)
    # fold change = total_responders / responders_enrolled; NULL when the trial
    # enrolled no predicted responders (divide-by-zero is undefined).
    fold_change: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Predicted response rates (fraction 0–1)
    trial_predicted_rr: Mapped[float] = mapped_column(Float, default=0.0)
    satgbm_predicted_rr: Mapped[float] = mapped_column(Float, default=0.0)

    computed_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class TCGAPatient(Base):
    """Per-case TCGA patient record for validation of SATGBM predictions.

    Each row is a unique TCGA case (participant), keyed by the GDC
    ``submitter_id`` (e.g. ``TCGA-06-0125``).  Captures demographics,
    diagnosis, and survival fields needed to evaluate real-world outcome
    against model predictions.
    """

    __tablename__ = "tcga_patients"

    # GDC submitter_id, e.g. "TCGA-06-0125".  This is the stable human-readable
    # case identifier; the UUID is captured separately for GDC API round-trips.
    case_submitter_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    case_uuid: Mapped[str] = mapped_column(String(50), default="")
    project: Mapped[str] = mapped_column(String(30), default="TCGA-GBM")

    # Diagnosis
    primary_diagnosis: Mapped[str] = mapped_column(String(200), default="")
    tumor_grade: Mapped[str] = mapped_column(String(50), default="")
    age_at_diagnosis_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    progression_or_recurrence: Mapped[str] = mapped_column(String(20), default="")
    prior_treatment: Mapped[str] = mapped_column(String(20), default="")

    # Demographics
    gender: Mapped[str] = mapped_column(String(20), default="")
    race: Mapped[str] = mapped_column(String(50), default="")
    ethnicity: Mapped[str] = mapped_column(String(50), default="")

    # Survival (for validation / Kaplan-Meier analysis)
    vital_status: Mapped[str] = mapped_column(String(20), default="")
    days_to_death: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    days_to_last_follow_up: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class TCGATreatment(Base):
    """Per-treatment record for TCGA patients, from GDC diagnoses.treatments.

    One patient may have many treatment records (chemo, radiation, surgery,
    etc.).  Only treatments with ``therapeutic_agents`` populated are useful
    for drug-level validation, but we persist all rows so the cohort can be
    filtered downstream.
    """

    __tablename__ = "tcga_treatments"
    __table_args__ = (
        UniqueConstraint("treatment_id", name="uq_tcga_treatments_treatment_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_submitter_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("tcga_patients.case_submitter_id")
    )

    # GDC-stable UUID for the treatment record
    treatment_id: Mapped[str] = mapped_column(String(50))
    treatment_submitter_id: Mapped[str] = mapped_column(String(100), default="")

    # Drug info
    therapeutic_agents_raw: Mapped[str] = mapped_column(String(500), default="")
    # Lower-cased / normalised drug name for joining against interventions;
    # populated by the ChEMBL name resolver in a later pass.
    normalized_drug_name: Mapped[str] = mapped_column(String(500), default="")

    # Treatment context
    treatment_type: Mapped[str] = mapped_column(String(200), default="")
    treatment_or_therapy: Mapped[str] = mapped_column(String(20), default="")
    initial_disease_status: Mapped[str] = mapped_column(String(100), default="")

    # Dosing / schedule
    number_of_cycles: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    treatment_dose: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    treatment_dose_units: Mapped[str] = mapped_column(String(20), default="")
    route_of_administration: Mapped[str] = mapped_column(String(200), default="")
    days_to_treatment_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    days_to_treatment_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class BiomarkerTherapyAssociation(Base):
    """Curated biomarker–therapy response associations from published literature.

    Each row captures how a specific biomarker status (e.g., MGMT methylated,
    BRAF V600E) modulates response to a therapy class or specific drug.
    """

    __tablename__ = "biomarker_therapy_associations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # ── Biomarker ──────────────────────────────────────────────────────────
    biomarker: Mapped[str] = mapped_column(String(200))
    # Canonical biomarker name matching extractor output, e.g.:
    #   "MGMT methylated", "IDH mutation", "BRAF V600E", "EGFR amplification",
    #   "CDKN2A deletion", "1p/19q codeletion", "High TMB", "NTRK fusion"

    biomarker_status: Mapped[str] = mapped_column(String(50))
    # The specific status: "present", "absent", "methylated", "unmethylated",
    #   "mutant", "wild-type", "amplified", "deleted", "overexpressed", "high", "low"

    biomarker_category: Mapped[str] = mapped_column(String(50))
    # Category of biomarker: "mutation", "amplification", "methylation",
    #   "expression", "fusion", "codeletion", "other"

    # ── Therapy ────────────────────────────────────────────────────────────
    therapy_name: Mapped[str] = mapped_column(String(300))
    # Specific drug or drug class, e.g. "Temozolomide", "PARP inhibitors",
    #   "Dabrafenib + Trametinib", "Bevacizumab"

    therapy_class: Mapped[str] = mapped_column(String(200), default="")
    # Broad MOA class matching moa_broad_category, e.g.:
    #   "Alkylating Agent", "PARP inhibitor", "BRAF inhibitor"

    # ── Effect ─────────────────────────────────────────────────────────────
    response_effect: Mapped[str] = mapped_column(String(50))
    # Direction of effect on therapy response:
    #   "increased_response", "decreased_response", "resistance",
    #   "sensitivity", "no_effect", "required" (biomarker is the drug target)

    effect_size: Mapped[str] = mapped_column(String(50), default="")
    # Qualitative magnitude: "strong", "moderate", "weak", "variable", ""

    mechanism_summary: Mapped[str] = mapped_column(Text, default="")
    # Brief explanation of the biological mechanism, e.g.:
    #   "MGMT repairs alkylation damage; methylation silences MGMT,
    #    allowing TMZ-induced lesions to persist."

    # ── Evidence ───────────────────────────────────────────────────────────
    evidence_level: Mapped[str] = mapped_column(String(30))
    # Strength of evidence:
    #   "level_1" = Phase III RCT / meta-analysis / FDA-approved companion dx
    #   "level_2" = Phase II data or multiple concordant studies
    #   "level_3" = Preclinical or early-phase with biological rationale
    #   "level_4" = Case reports / expert opinion / emerging data

    evidence_sources: Mapped[str] = mapped_column(Text, default="")
    # Semicolon-separated citations, e.g.:
    #   "Hegi et al. NEJM 2005; Stupp et al. Lancet Oncol 2009"

    disease_context: Mapped[str] = mapped_column(String(200), default="GBM")
    # Disease context for the association, e.g. "GBM", "Glioma", "DMG",
    #   "Low-grade glioma", "Solid tumors"

    clinical_actionability: Mapped[str] = mapped_column(String(50), default="")
    # "standard_of_care", "guideline_recommended", "investigational",
    #   "emerging", "preclinical"
