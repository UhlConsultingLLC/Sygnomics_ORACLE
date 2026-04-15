"""FastAPI application entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.dependencies import get_config, get_engine
from api.routers import analysis, conditions, ctis_router, export, moa, novel_therapy, simulation, tcga, threshold, trials, validation, who
from database.engine import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    engine = get_engine()
    init_db(engine)
    yield


app = FastAPI(
    title="CT Pipeline API",
    description="Clinical Trial Data Analysis Pipeline - REST API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
config = get_config()
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


@app.get("/")
def root():
    return {"message": "CT Pipeline API", "version": "0.1.0"}


@app.get("/health")
def health():
    return {"status": "ok"}
