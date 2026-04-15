"""Pydantic models for analysis results."""

from typing import Optional
from pydantic import BaseModel, Field


class ConditionCount(BaseModel):
    condition: str
    trial_count: int


class MOADistribution(BaseModel):
    moa_category: str
    intervention_count: int
    trial_count: int


class PhaseDistribution(BaseModel):
    phase: str
    trial_count: int


class StatusDistribution(BaseModel):
    status: str
    trial_count: int


class ResponseStats(BaseModel):
    condition: str
    total_trials: int
    mean_enrollment: Optional[float] = None
    median_enrollment: Optional[float] = None


class FilterSpec(BaseModel):
    """Specification for filtering trials across multiple dimensions."""

    conditions: Optional[list[str]] = None
    moa_categories: Optional[list[str]] = None
    phases: Optional[list[str]] = None
    statuses: Optional[list[str]] = None
    sponsors: Optional[list[str]] = None
    study_types: Optional[list[str]] = None
    min_enrollment: Optional[int] = None
    max_enrollment: Optional[int] = None
    locations_country: Optional[list[str]] = None
    eligibility_keywords: Optional[list[str]] = None
    start_date_from: Optional[str] = None
    start_date_to: Optional[str] = None
    intervention_keywords: Optional[list[str]] = None
    has_results: Optional[bool] = None
    outcome_keywords: Optional[list[str]] = None


class SplitResult(BaseModel):
    """Result of a train/test split."""

    train_nct_ids: list[str] = Field(default_factory=list)
    test_nct_ids: list[str] = Field(default_factory=list)
    strategy: str = ""
    test_fraction: float = 0.2
    random_seed: int = 42
