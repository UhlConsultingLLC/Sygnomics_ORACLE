"""Analysis module — metrics, filters, simulation, threshold learning, and evaluation.

Houses the core analytical logic for the ORACLE pipeline: summary metrics
and filtering (``metrics``, ``filters``), stratified train/test splitting
(``split``), in-silico trial simulation (``simulation``, ``moa_simulation``),
Drug-Constrained Network Activity scoring (``dcna``), gene expression
analysis (``gene_expression``), eligibility-text biomarker extraction
(``biomarker_extractor``, ``who_extractor``), threshold learning via
Youden's J / cost / percentile methods (``threshold_learning``), and held-out
evaluation (``evaluation``, ``bland_altman``).
"""
