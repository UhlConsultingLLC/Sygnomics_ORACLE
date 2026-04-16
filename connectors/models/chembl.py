"""Pydantic models for ChEMBL API data."""

from typing import Optional

from pydantic import BaseModel, Field


class Compound(BaseModel):
    chembl_id: str = ""
    name: str = ""
    molecule_type: str = ""
    max_phase: Optional[int] = None
    synonyms: list[str] = Field(default_factory=list)


class Target(BaseModel):
    target_chembl_id: str = ""
    target_name: str = ""
    target_type: str = ""
    gene_symbol: str = ""
    organism: str = ""


class Mechanism(BaseModel):
    action_type: str = ""  # INHIBITOR, AGONIST, ANTAGONIST, etc.
    mechanism_of_action: str = ""
    target_chembl_id: str = ""
    target_name: str = ""
    target_gene_symbol: str = ""
    molecule_chembl_id: str = ""


class Bioactivity(BaseModel):
    assay_chembl_id: str = ""
    target_chembl_id: str = ""
    standard_type: str = ""
    standard_value: Optional[float] = None
    standard_units: str = ""
