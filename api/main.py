"""FastAPI application entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.dependencies import get_config, get_engine
from api.middleware import RequestIDMiddleware, install_request_id_filter
from api.routers import (
    analysis,
    conditions,
    ctis_router,
    export,
    moa,
    novel_therapy,
    simulation,
    tcga,
    threshold,
    trials,
    validation,
    who,
)
from api.routers import version as version_router
from config.version import APP_VERSION
from database.engine import init_db


def _init_sentry(dsn: str) -> None:
    """Conditionally initialize Sentry error reporting."""
    import os

    resolved_dsn = dsn or os.getenv("SENTRY_DSN", "")
    if not resolved_dsn:
        return
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=resolved_dsn,
            traces_sample_rate=0.1,
            release=APP_VERSION,
        )
    except ImportError:
        import logging

        logging.getLogger(__name__).warning(
            "SENTRY_DSN is set but sentry-sdk is not installed. "
            "Install with: pip install sentry-sdk[fastapi]"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database, observability, and error reporting on startup."""
    install_request_id_filter()
    _init_sentry(get_config().api.sentry_dsn)
    engine = get_engine()
    init_db(engine)
    yield


app = FastAPI(
    title="ORACLE API",
    description="ORACLE — Oncology Response & Cohort Learning Engine. "
                "Clinical Trial Data Analysis Pipeline REST API.",
    version=APP_VERSION,
    lifespan=lifespan,
)

# Middleware (order matters: outermost first)
config = get_config()
app.add_middleware(RequestIDMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.api.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(trials.router)
app.include_router(conditions.router)
app.include_router(analysis.router)
app.include_router(moa.router)
app.include_router(export.router)
app.include_router(simulation.router)
app.include_router(novel_therapy.router)
app.include_router(tcga.router)
app.include_router(ctis_router.router)
app.include_router(threshold.router)
app.include_router(who.router)
app.include_router(validation.router)
app.include_router(version_router.router)


@app.get("/")
def root():
    return {"message": "ORACLE API", "version": APP_VERSION}


@app.get("/health")
def health():
    return {"status": "ok"}
