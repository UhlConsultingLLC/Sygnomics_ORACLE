"""Database engine factory and session management."""

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from config.schema import DatabaseConfig
from database.models import Base


def _enable_sqlite_fk(dbapi_conn, connection_record):
    """Enable foreign key enforcement for SQLite connections."""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def create_db_engine(config: DatabaseConfig | None = None) -> Engine:
    """Create a SQLAlchemy engine from configuration.

    Args:
        config: Database configuration. Defaults to SQLite.

    Returns:
        Configured SQLAlchemy Engine.
    """
    if config is None:
        config = DatabaseConfig()

    # Ensure parent directory exists for SQLite file databases
    if config.url.startswith("sqlite:///") and not config.url.startswith("sqlite:///:memory:"):
        db_path = config.url.replace("sqlite:///", "")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(config.url, echo=config.echo)

    # Enable foreign keys for SQLite
    if "sqlite" in config.url:
        event.listen(engine, "connect", _enable_sqlite_fk)

    return engine


def init_db(engine: Engine) -> None:
    """Create all tables in the database.

    Also applies lightweight column migrations for existing databases.

    Args:
        engine: SQLAlchemy engine to create tables on.
    """
    Base.metadata.create_all(engine)
    _apply_column_migrations(engine)


def _apply_column_migrations(engine: Engine) -> None:
    """Add columns that may be missing from older databases.

    Uses 'ALTER TABLE ADD COLUMN' which is safe for SQLite (no-ops if
    column already exists are caught via exception handling).
    """
    import logging

    logger = logging.getLogger(__name__)

    migrations = [
        ("moa_annotations", "moa_short_form", "VARCHAR(200) DEFAULT ''"),
        ("moa_annotations", "moa_broad_category", "VARCHAR(200) DEFAULT ''"),
        ("moa_annotations", "data_source", "VARCHAR(50) DEFAULT ''"),
        ("outcomes", "results_json", "TEXT DEFAULT ''"),
        ("trials", "source", "VARCHAR(20) DEFAULT 'ctgov'"),
        ("trials", "cross_reference_id", "VARCHAR(50) DEFAULT ''"),
        ("trials", "intercavitary_delivery", "VARCHAR(20) DEFAULT 'none'"),
        ("trials", "intercavitary_mechanisms", "TEXT DEFAULT ''"),
        # WHO 2021 classification table columns (table created by create_all;
        # these are fallback if columns are added later)
        ("who_classifications", "who_types", "TEXT DEFAULT ''"),
        ("who_classifications", "who_grade_min", "VARCHAR(20) DEFAULT 'Unknown'"),
        ("who_classifications", "who_grade_max", "VARCHAR(20) DEFAULT 'Unknown'"),
        ("who_classifications", "idh_status", "VARCHAR(20) DEFAULT 'unknown'"),
        ("who_classifications", "codeletion_1p19q", "VARCHAR(20) DEFAULT 'unknown'"),
        ("who_classifications", "mgmt_status", "VARCHAR(20) DEFAULT 'unknown'"),
        ("who_classifications", "cdkn2a_status", "VARCHAR(20) DEFAULT 'unknown'"),
        ("who_classifications", "h3k27m_status", "VARCHAR(20) DEFAULT 'unknown'"),
        ("who_classifications", "confidence", "VARCHAR(10) DEFAULT 'low'"),
        ("who_classifications", "biomarker_count", "INTEGER DEFAULT 0"),
        # Arm intervention names from CT.gov armGroups.interventionNames
        ("arms", "intervention_names", "TEXT DEFAULT ''"),
    ]

    with engine.connect() as conn:
        for table, column, col_type in migrations:
            try:
                conn.execute(
                    __import__("sqlalchemy").text(
                        f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
                    )
                )
                conn.commit()
                logger.info("Added column %s.%s", table, column)
            except Exception:
                # Column already exists — this is expected for up-to-date DBs
                conn.rollback()


def get_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Create a session factory bound to the given engine.

    Args:
        engine: SQLAlchemy engine.

    Returns:
        Session factory that produces new Session instances.
    """
    return sessionmaker(bind=engine)
