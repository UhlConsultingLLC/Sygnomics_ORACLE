"""Pydantic models for TCGA (The Cancer Genome Atlas) data."""

from typing import Optional

from pydantic import BaseModel, Field


class ClinicalData(BaseModel):
    """Clinical metadata for a TCGA case."""

    case_id: str = ""
    submitter_id: str = ""  # e.g., TCGA-06-0137
    age_at_diagnosis: Optional[int] = None  # days
    gender: str = ""
    vital_status: str = ""  # Alive, Dead
    days_to_death: Optional[int] = None
    days_to_last_follow_up: Optional[int] = None
    primary_diagnosis: str = ""
    tumor_grade: str = ""
    tumor_stage: str = ""
    ecog_performance_status: Optional[int] = None
    # WHO 2021 molecular markers (populated from TCGA molecular data)
    idh_status: str = ""          # "mutant", "wild-type", ""
    codeletion_1p19q: str = ""    # "codeleted", "intact", ""
    mgmt_methylation: str = ""    # "methylated", "unmethylated", ""
    cdkn2a_status: str = ""       # "deleted", "intact", ""
    h3k27m_status: str = ""       # "mutant", "wild-type", ""
    tert_promoter: str = ""       # "mutant", "wild-type", ""
    egfr_amplification: str = ""  # "amplified", "normal", ""
    # WHO 2021 classification result
    who_type: str = ""            # e.g., "Glioblastoma, IDH-wildtype"
    who_grade: str = ""           # e.g., "Grade 4"


class TCGACase(BaseModel):
    """A single TCGA patient case with clinical and optional molecular data."""

    case_id: str
    submitter_id: str = ""
    project_id: str = ""  # e.g., TCGA-GBM
    clinical: Optional[ClinicalData] = None

    model_config = {"arbitrary_types_allowed": True}


class GeneExpressionProfile(BaseModel):
    """Gene expression data for a single case.

    gene_values maps gene symbol -> normalized expression value (log2 TPM).
    """

    case_id: str
    gene_values: dict[str, float] = Field(default_factory=dict)


class SimulatedResponse(BaseModel):
    """Result of an in-silico trial simulation for a single patient."""

    case_id: str
    trial_nct_id: str = ""
    is_responder: bool = False
    response_magnitude: float = 0.0
    dcna_score: Optional[float] = None
    matched_criteria: list[str] = Field(default_factory=list)
    unmatched_criteria: list[str] = Field(default_factory=list)
