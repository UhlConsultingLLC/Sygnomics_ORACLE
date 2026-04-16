"""MOA classification — drug-name resolution and mechanism-of-action mapping.

Resolves raw intervention strings from ClinicalTrials.gov to canonical
drug names (stripping dosage, salt, route via ``name_resolver`` and
``drug_aliases``), then queries Open Targets / ChEMBL for the
mechanism of action. Results are mapped to ~20 human-readable
categories (``moa_categories``) and persisted as MOA annotation rows
in the database by ``classifier``.
"""
