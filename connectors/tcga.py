"""Dual-mode TCGA data client: GDC API + local file reader.

Supports three modes configured via YAML:
  - "api":   Query GDC REST API on demand, cache locally.
  - "local": Read from pre-downloaded directory.
  - "auto":  Check local cache first, fall back to API.
"""

import json
import logging
from pathlib import Path
from typing import Optional

import httpx
import pandas as pd

from config.schema import TCGAConfig
from connectors.models.tcga import ClinicalData, GeneExpressionProfile, TCGACase

logger = logging.getLogger(__name__)

GDC_CASES_ENDPOINT = "/cases"
GDC_FILES_ENDPOINT = "/files"


class TCGAConnector:
    """Client for TCGA data via GDC API and/or local files."""

    def __init__(self, config: Optional[TCGAConfig] = None):
        self.config = config or TCGAConfig()
        self.cache_dir = Path(self.config.cache_dir)
        self.local_path = Path(self.config.local_path)

    def _get_auth_headers(self) -> dict:
        """Get GDC auth token headers if configured."""
        if self.config.gdc_token_path:
            token_path = Path(self.config.gdc_token_path)
            if token_path.exists():
                token = token_path.read_text().strip()
                return {"X-Auth-Token": token}
        return {}

    # --- API methods ---

    async def _query_gdc_cases(
        self, project: str, size: int = 100, from_idx: int = 0
    ) -> list[dict]:
        """Query GDC API for cases in a project."""
        url = f"{self.config.gdc_api_base}{GDC_CASES_ENDPOINT}"
        params = {
            "filters": json.dumps({
                "op": "=",
                "content": {
                    "field": "project.project_id",
                    "value": project,
                },
            }),
            "fields": (
                "case_id,submitter_id,"
                "diagnoses.age_at_diagnosis,diagnoses.primary_diagnosis,"
                "diagnoses.tumor_grade,diagnoses.tumor_stage,"
                "demographic.gender,demographic.vital_status,"
                "demographic.days_to_death,"
                "exposures.pack_years_smoked"
            ),
            "size": size,
            "from": from_idx,
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(url, params=params, headers=self._get_auth_headers())
            resp.raise_for_status()
            data = resp.json()

        return data.get("data", {}).get("hits", [])

    def _parse_gdc_case(self, raw: dict) -> TCGACase:
        """Parse a GDC case response into a TCGACase model."""
        diagnoses = raw.get("diagnoses", [{}])
        diag = diagnoses[0] if diagnoses else {}
        demo = raw.get("demographic", {}) or {}

        clinical = ClinicalData(
            case_id=raw.get("case_id", ""),
            submitter_id=raw.get("submitter_id", ""),
            age_at_diagnosis=diag.get("age_at_diagnosis"),
            gender=demo.get("gender", ""),
            vital_status=demo.get("vital_status", ""),
            days_to_death=demo.get("days_to_death"),
            primary_diagnosis=diag.get("primary_diagnosis", ""),
            tumor_grade=diag.get("tumor_grade", ""),
            tumor_stage=diag.get("tumor_stage", ""),
        )

        return TCGACase(
            case_id=raw.get("case_id", ""),
            submitter_id=raw.get("submitter_id", ""),
            project_id=self.config.default_project,
            clinical=clinical,
        )

    async def fetch_cases_from_api(
        self, project: Optional[str] = None, max_cases: int = 1000
    ) -> list[TCGACase]:
        """Fetch all cases from GDC API for a project.

        Args:
            project: TCGA project ID (default from config).
            max_cases: Maximum cases to retrieve.

        Returns:
            List of TCGACase objects.
        """
        project = project or self.config.default_project
        all_cases: list[TCGACase] = []
        batch_size = 100
        from_idx = 0

        while len(all_cases) < max_cases:
            hits = await self._query_gdc_cases(project, batch_size, from_idx)
            if not hits:
                break

            for raw in hits:
                all_cases.append(self._parse_gdc_case(raw))

            from_idx += batch_size
            if len(hits) < batch_size:
                break

        logger.info("Fetched %d cases from GDC for %s", len(all_cases), project)
        return all_cases[:max_cases]

    # --- Local file methods ---

    def load_cases_from_local(self, path: Optional[Path] = None) -> list[TCGACase]:
        """Load cases from a local JSON or CSV file.

        Expected formats:
          - JSON: list of dicts with case_id, clinical fields
          - CSV: columns for case_id, age_at_diagnosis, gender, etc.
        """
        path = path or self.local_path / "clinical.json"

        if not path.exists():
            logger.warning("Local TCGA data not found at %s", path)
            return []

        if path.suffix == ".json":
            with open(path) as f:
                data = json.load(f)
            return [self._parse_gdc_case(item) for item in data]

        elif path.suffix == ".csv":
            df = pd.read_csv(path)
            cases = []
            for _, row in df.iterrows():
                clinical = ClinicalData(
                    case_id=str(row.get("case_id", "")),
                    submitter_id=str(row.get("submitter_id", "")),
                    age_at_diagnosis=row.get("age_at_diagnosis"),
                    gender=str(row.get("gender", "")),
                    vital_status=str(row.get("vital_status", "")),
                    days_to_death=row.get("days_to_death"),
                    primary_diagnosis=str(row.get("primary_diagnosis", "")),
                )
                cases.append(TCGACase(
                    case_id=str(row.get("case_id", "")),
                    submitter_id=str(row.get("submitter_id", "")),
                    project_id=self.config.default_project,
                    clinical=clinical,
                ))
            return cases

        logger.warning("Unsupported file format: %s", path.suffix)
        return []

    # --- Cache methods ---

    def _cache_path(self, project: str) -> Path:
        return self.cache_dir / f"{project}_cases.json"

    def save_to_cache(self, cases: list[TCGACase], project: Optional[str] = None) -> None:
        """Save cases to local cache."""
        project = project or self.config.default_project
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = self._cache_path(project)
        data = [c.model_dump(mode="json") for c in cases]
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)
        logger.info("Cached %d cases to %s", len(cases), path)

    def load_from_cache(self, project: Optional[str] = None) -> list[TCGACase]:
        """Load cases from local cache."""
        project = project or self.config.default_project
        path = self._cache_path(project)
        if not path.exists():
            return []
        with open(path) as f:
            data = json.load(f)
        return [TCGACase(**item) for item in data]

    # --- Unified access ---

    async def get_cases(
        self, project: Optional[str] = None, max_cases: int = 1000
    ) -> list[TCGACase]:
        """Get TCGA cases using the configured mode (api/local/auto).

        Args:
            project: TCGA project ID.
            max_cases: Maximum cases to retrieve.

        Returns:
            List of TCGACase objects.
        """
        project = project or self.config.default_project

        if self.config.mode == "local":
            return self.load_cases_from_local()

        if self.config.mode == "auto":
            cached = self.load_from_cache(project)
            if cached:
                logger.info("Loaded %d cases from cache", len(cached))
                return cached[:max_cases]

        # API mode or auto mode with no cache
        cases = await self.fetch_cases_from_api(project, max_cases)
        if cases:
            self.save_to_cache(cases, project)
        return cases

    # --- Gene expression ---

    def load_gene_expression_local(
        self, path: Optional[Path] = None
    ) -> dict[str, GeneExpressionProfile]:
        """Load gene expression data from a local TSV/CSV matrix.

        Expected format: rows = genes, columns = case IDs, values = log2(TPM+1).

        Returns:
            Dict mapping case_id -> GeneExpressionProfile.
        """
        path = path or self.local_path / "expression_matrix.tsv"
        if not path.exists():
            logger.warning("Expression matrix not found at %s", path)
            return {}

        sep = "\t" if path.suffix == ".tsv" else ","
        df = pd.read_csv(path, sep=sep, index_col=0)

        profiles = {}
        for case_id in df.columns:
            gene_values = df[case_id].dropna().to_dict()
            profiles[case_id] = GeneExpressionProfile(
                case_id=case_id, gene_values=gene_values
            )

        logger.info("Loaded expression for %d cases, %d genes", len(profiles), len(df))
        return profiles
