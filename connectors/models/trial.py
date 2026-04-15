"""Pydantic models for clinical trial data from ClinicalTrials.gov."""

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class Sponsor(BaseModel):
    name: str
    type: str = ""  # NIH, INDUSTRY, ACADEMIC, etc.


class Location(BaseModel):
    facility: str = ""
    city: str = ""
    state: str = ""
    country: str = ""
    zip_code: str = ""
    contact_name: str = ""
    contact_email: str = ""


class Intervention(BaseModel):
    name: str
    type: str = ""  # DRUG, BIOLOGICAL, PROCEDURE, RADIATION, DEVICE, etc.
    description: str = ""
    chembl_id: Optional[str] = None


class StudyArm(BaseModel):
    label: str
    type: str = ""  # EXPERIMENTAL, ACTIVE_COMPARATOR, PLACEBO_COMPARATOR, etc.
    description: str = ""
    interventions: list[str] = Field(default_factory=list)


class OutcomeResult(BaseModel):
    """A single measurement result for an outcome, per arm/group."""
    group_title: str = ""
    group_description: str = ""
    participants_count: int | None = None
    value: str = ""
    param_type: str = ""  # MEAN, NUMBER, COUNT_OF_PARTICIPANTS, etc.
    unit: str = ""
    lower_limit: str = ""
    upper_limit: str = ""
    dispersion_type: str = ""  # 95% CI, Standard Deviation, etc.
    class_title: str = ""  # Outcome class label (e.g. "Yes", "No", "Responders")
    category: str = ""  # Sub-category within a class


class Outcome(BaseModel):
    type: str = ""  # PRIMARY, SECONDARY, OTHER
    measure: str = ""
    description: str = ""
    time_frame: str = ""
    results: list[OutcomeResult] = Field(default_factory=list)


class EligibilityCriteria(BaseModel):
    criteria_text: str = ""
    min_age: str = ""
    max_age: str = ""
    sex: str = "ALL"
    healthy_volunteers: bool = False


class Trial(BaseModel):
    """Validated representation of a clinical trial from ClinicalTrials.gov."""

    nct_id: str
    title: str = ""
    brief_summary: str = ""
    detailed_description: str = ""
    status: str = ""  # RECRUITING, COMPLETED, etc.
    phase: str = ""  # Phase 1, Phase 2, Phase 3, Phase 4
    study_type: str = ""  # INTERVENTIONAL, OBSERVATIONAL
    enrollment_count: Optional[int] = None
    start_date: Optional[date] = None
    completion_date: Optional[date] = None
    conditions: list[str] = Field(default_factory=list)
    interventions: list[Intervention] = Field(default_factory=list)
    arms: list[StudyArm] = Field(default_factory=list)
    outcomes: list[Outcome] = Field(default_factory=list)
    eligibility: Optional[EligibilityCriteria] = None
    sponsor: Optional[Sponsor] = None
    locations: list[Location] = Field(default_factory=list)
    results_url: str = ""


class TrialSearchResult(BaseModel):
    """Result from a search_trials query, containing a page of trials."""

    trials: list[Trial] = Field(default_factory=list)
    total_count: Optional[int] = None
    next_page_token: Optional[str] = None
