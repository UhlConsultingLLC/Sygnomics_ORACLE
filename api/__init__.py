"""FastAPI REST backend for ORACLE.

Exposes the full pipeline as HTTP endpoints: trial search/detail,
condition expansion, MOA classification, TCGA cohort analysis,
simulation execution, threshold learning, validation, export, and
build-provenance reporting. Each router in ``api.routers`` maps to one
stage of the pipeline; ``api.main`` wires them together with CORS and
lifespan hooks.
"""
