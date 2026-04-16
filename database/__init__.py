"""Database layer — SQLAlchemy ORM, ETL, and query builders.

``models`` defines the ORM (TrialRecord, InterventionRecord, etc.),
``engine`` provides the engine factory and ``init_db()`` which creates
tables via ``Base.metadata.create_all`` plus lightweight column-level
migrations for backward compatibility, ``etl`` handles upsert logic
keyed on NCT ID, and ``queries`` exposes typed query helpers that
return Pydantic models.
"""
