"""FastAPI dependency injection: DB session, config, etc."""

from functools import lru_cache
from typing import Generator

from sqlalchemy.orm import Session

from config.schema import PipelineConfig, load_config
from database.engine import create_db_engine, get_session_factory, init_db


@lru_cache
def get_config() -> PipelineConfig:
    return load_config()


@lru_cache
def get_engine():
    config = get_config()
    engine = create_db_engine(config.database)
    init_db(engine)
    return engine


def get_db() -> Generator[Session, None, None]:
    """Yield a database session per request."""
    engine = get_engine()
    session_factory = get_session_factory(engine)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
