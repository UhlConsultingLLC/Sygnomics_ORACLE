"""Pydantic request/response schemas for FastAPI endpoints."""

from typing import Optional

from pydantic import BaseModel, Field

# --- Request schemas ---


class DiseaseSearchRequest(BaseModel):
    disease: str
    expand_terms: bool = True
    status: Optional[list[str]] = None
    phase: Optional[list[str]] = None


class SimulationRequest(BaseModel):
    trial_nct_id: str
    response_rate: float = 0.15
    max_cohort: int = 500


class ThresholdLearnRequest(BaseModel):
    method: str = "youden"
    cost_fn_ratio: float = 1.0
    percentile: float = 0.5


# --- Response schemas ---


class OutcomeSummary(BaseModel):
    type: str = ""
    measure: str = ""
    time_frame: str = ""


class TrialSummary(BaseModel):
    nct_id: str
    title: str = ""
    status: str = ""
    phase: str = ""
    enrollment_count: Optional[int] = None
    conditions: list[str] = Field(default_factory=list)
    interventions: list[str] = Field(default_factory=list)
    outcomes: list[OutcomeSummary] = Field(default_factory=list)
    sponsor_name: str = ""
    source: str = "ctgov"  # "ctgov" or "ctis"
    intercavitary_delivery: str = "none"  # "none", "confirmed", "mentioned"
    intercavitary_mechanisms: str = ""  # comma-separated mechanism labels
    who_types: list[str] = Field(default_factory=list)  # WHO 2021 target subtypes
    who_confidence: str = ""  # "high", "medium", "low"


class TrialListResponse(BaseModel):
    trials: list[TrialSummary]
    total: int
    applied_expansions: dict[str, list[str]] = Field(default_factory=dict)


class ConditionSuggestion(BaseModel):
    original: str
    expanded_terms: list[str]


class MetricsSummary(BaseModel):
    total_trials: int
    total_enrollment: int
    mean_enrollment: float
    conditions_count: int
    interventions_count: int


class FilterOptionsResponse(BaseModel):
    conditions: list[str]
    moa_categories: list[str]
    phases: list[str]
    statuses: list[str]
    sponsors: list[str]
    study_types: list[str]
    countries: list[str]
    interventions: list[str]


class SimulationResponse(BaseModel):
    trial_nct_id: str
    total_cohort: int
    eligible_count: int
    responder_count: int
    response_rate: float
    mean_magnitude: float


class ThresholdResponse(BaseModel):
    threshold: float
    method: str
    sensitivity: float
    specificity: float
    auc: float
    youden_j: float


# --- Validation (SATGBM vs TCGA outcomes) ---


class ValidationRequest(BaseModel):
    drug_name: str
    moa_category: Optional[str] = None
    dcna_threshold: Optional[float] = None
    expression_threshold: float = 0.0


class KMPoint(BaseModel):
    time: float
    survival: float
    at_risk: int


class ValidationResponse(BaseModel):
    drug: str
    matched_dcna_drug: Optional[str] = None
    moa_category: Optional[str] = None
    dcna_threshold: float
    expression_threshold: float

    total_treated_patients: int
    patients_in_cohort: int
    n_predicted_responders: int
    n_predicted_nonresponders: int
    n_deaths_responders: int
    n_deaths_nonresponders: int

    median_os_responders: Optional[float] = None
    median_os_nonresponders: Optional[float] = None

    logrank_p: Optional[float] = None
    hazard_ratio: Optional[float] = None
    hr_ci_lower: Optional[float] = None
    hr_ci_upper: Optional[float] = None
    cox_p: Optional[float] = None

    km_responders: list[KMPoint] = Field(default_factory=list)
    km_nonresponders: list[KMPoint] = Field(default_factory=list)

    warnings: list[str] = Field(default_factory=list)


class ValidatableDrug(BaseModel):
    dcna_name: str
    n_treated_patients: int


class ValidatableDrugsResponse(BaseModel):
    drugs: list[ValidatableDrug]
    total_dcna_drugs: int
    total_tcga_treated_cases: int
