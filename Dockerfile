# Multi-stage Dockerfile for ORACLE
# Produces a single image that serves the FastAPI backend + the
# pre-built React frontend via FastAPI's StaticFiles mount.
#
# Build:   docker compose build
# Run:     docker compose up -d
# Browse:  http://localhost:8000

# ── Stage 1: Build the React frontend ──────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ .
RUN npm run build

# ── Stage 2: Python runtime + built frontend ──────────────────────
FROM python:3.11-slim

WORKDIR /app

# System deps for SQLite + git (needed by setup.py to bake the SHA)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# Python deps
COPY pyproject.toml setup.py ./
COPY config/ config/
COPY connectors/ connectors/
COPY database/ database/
COPY analysis/ analysis/
COPY moa_classification/ moa_classification/
COPY visualization/ visualization/
COPY api/ api/

# Install the package (also bakes config/_build_info.py via setup.py)
RUN pip install --no-cache-dir .

# Copy the built frontend from stage 1
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Copy remaining files (scripts, config, data fixtures, docs)
COPY scripts/ scripts/
COPY data/demo_trials.json data/demo_trials.json
COPY config/default_config.yaml config/default_config.yaml

# Mount point for persistent DB + TCGA cache
VOLUME /app/data

EXPOSE 8000

# Start uvicorn. The app serves the API on /api/* routes and the
# frontend on / via StaticFiles (added below in the entrypoint).
# For development, use docker compose which maps the source directory.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
