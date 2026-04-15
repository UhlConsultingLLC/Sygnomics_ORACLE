"""ChEMBL connector wrapping MCP compound_search, drug_search, get_mechanism, target_search.

Provides compound lookup, mechanism-of-action retrieval, and target annotation.
"""

import asyncio
import json
import logging
from typing import Any, Callable, Optional

from config.schema import ChEMBLConfig
from connectors.models.chembl import Compound, Mechanism, Target

logger = logging.getLogger(__name__)


def _parse_compound(raw: dict) -> Compound:
    """Parse a compound dict from MCP response."""
    return Compound(
        chembl_id=raw.get("molecule_chembl_id") or raw.get("chembl_id") or "",
        name=raw.get("pref_name") or raw.get("name") or "",
        molecule_type=raw.get("molecule_type") or "",
        max_phase=raw.get("max_phase"),
        synonyms=raw.get("synonyms") or [],
    )


def _parse_mechanism(raw: dict) -> Mechanism:
    """Parse a mechanism dict from MCP response."""
    return Mechanism(
        action_type=raw.get("action_type") or "",
        mechanism_of_action=raw.get("mechanism_of_action") or raw.get("description") or "",
        target_chembl_id=raw.get("target_chembl_id") or "",
        target_name=raw.get("target_name") or raw.get("target") or "",
        target_gene_symbol=raw.get("target_gene_symbol") or raw.get("gene_symbol") or "",
        molecule_chembl_id=raw.get("molecule_chembl_id") or "",
    )


def _parse_target(raw: dict) -> Target:
    """Parse a target dict from MCP response."""
    return Target(
        target_chembl_id=raw.get("target_chembl_id") or "",
        target_name=raw.get("pref_name") or raw.get("target_name") or "",
        target_type=raw.get("target_type") or "",
        gene_symbol=raw.get("gene_symbol") or raw.get("target_gene_symbol") or "",
        organism=raw.get("organism") or "",
    )


def _fetch_chembl_json(url: str, params: dict | None = None) -> dict:
    """Fetch JSON from the ChEMBL REST API using urllib (no extra deps)."""
    import urllib.parse
    import urllib.request

    base = url
    if params:
        query = urllib.parse.urlencode(params)
        base = f"{url}?{query}"

    req = urllib.request.Request(base, headers={
        "Accept": "application/json",
        "User-Agent": "CT-Pipeline/0.1.0",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---- HTTP fallback callables for ChEMBL REST API ----

CHEMBL_API_BASE = "https://www.ebi.ac.uk/chembl/api/data"


async def _http_compound_search(name: str) -> dict:
    """Search ChEMBL for a compound by name via the public REST API."""
    loop = asyncio.get_event_loop()
    url = f"{CHEMBL_API_BASE}/molecule/search"
    params = {"q": name, "format": "json", "limit": 5}
    try:
        result = await loop.run_in_executor(None, _fetch_chembl_json, url, params)
        molecules = result.get("molecules", [])
        return {"compounds": molecules}
    except Exception as e:
        logger.debug("ChEMBL compound search HTTP fallback error: %s", e)
        return {"compounds": []}


async def _http_drug_search(indication: str) -> dict:
    """Search ChEMBL for drugs by indication (uses molecule search as proxy)."""
    loop = asyncio.get_event_loop()
    url = f"{CHEMBL_API_BASE}/molecule/search"
    params = {"q": indication, "format": "json", "limit": 10}
    try:
        result = await loop.run_in_executor(None, _fetch_chembl_json, url, params)
        molecules = result.get("molecules", [])
        return {"drugs": molecules}
    except Exception as e:
        logger.debug("ChEMBL drug search HTTP fallback error: %s", e)
        return {"drugs": []}


async def _http_get_mechanism(molecule_chembl_id: str) -> dict:
    """Get mechanisms of action for a molecule from the ChEMBL REST API."""
    loop = asyncio.get_event_loop()
    url = f"{CHEMBL_API_BASE}/mechanism"
    params = {"molecule_chembl_id": molecule_chembl_id, "format": "json", "limit": 20}
    try:
        result = await loop.run_in_executor(None, _fetch_chembl_json, url, params)
        mechanisms = result.get("mechanisms", [])
        return {"mechanisms": mechanisms}
    except Exception as e:
        logger.debug("ChEMBL mechanism HTTP fallback error: %s", e)
        return {"mechanisms": []}


async def _http_target_search(target_chembl_id: str) -> dict:
    """Get target details from the ChEMBL REST API."""
    loop = asyncio.get_event_loop()
    url = f"{CHEMBL_API_BASE}/target/{target_chembl_id}"
    params = {"format": "json"}
    try:
        result = await loop.run_in_executor(None, _fetch_chembl_json, url, params)
        return {"targets": [result]}
    except Exception as e:
        logger.debug("ChEMBL target search HTTP fallback error: %s", e)
        return {"targets": []}


class ChEMBLConnector:
    """High-level connector for ChEMBL data retrieval via MCP tools.

    Falls back to the public ChEMBL REST API when MCP callables are not provided.
    """

    def __init__(
        self,
        config: Optional[ChEMBLConfig] = None,
        mcp_compound_search: Optional[Callable] = None,
        mcp_drug_search: Optional[Callable] = None,
        mcp_get_mechanism: Optional[Callable] = None,
        mcp_target_search: Optional[Callable] = None,
    ):
        self.config = config or ChEMBLConfig()
        self._mcp_compound_search = mcp_compound_search or _http_compound_search
        self._mcp_drug_search = mcp_drug_search or _http_drug_search
        self._mcp_get_mechanism = mcp_get_mechanism or _http_get_mechanism
        self._mcp_target_search = mcp_target_search or _http_target_search

    async def _call_with_retry(self, fn: Callable, **kwargs) -> Any:
        """Call an MCP function with exponential backoff retry."""
        for attempt in range(self.config.retry_max_attempts):
            try:
                result = await fn(**kwargs)
                if isinstance(result, str):
                    try:
                        result = json.loads(result)
                    except json.JSONDecodeError:
                        pass
                return result
            except Exception as e:
                if attempt + 1 >= self.config.retry_max_attempts:
                    logger.error("Failed after %d attempts: %s", attempt + 1, e)
                    raise
                wait = self.config.retry_backoff_factor ** (attempt + 1)
                logger.warning("Retry %d: %s", attempt + 1, e)
                await asyncio.sleep(wait)

    async def search_compound(self, name: str) -> list[Compound]:
        """Search for a compound by name.

        Args:
            name: Drug or compound name (e.g., "temozolomide").

        Returns:
            List of matching Compound objects.
        """
        result = await self._call_with_retry(self._mcp_compound_search, name=name)

        compounds = []
        if isinstance(result, dict):
            items = result.get("compounds", result.get("molecules", result.get("results", [])))
            if not isinstance(items, list):
                items = [result]
        elif isinstance(result, list):
            items = result
        else:
            return compounds

        for item in items:
            if isinstance(item, dict):
                compounds.append(_parse_compound(item))

        return compounds

    async def search_drugs_by_indication(self, indication: str) -> list[Compound]:
        """Search for drugs by disease indication.

        Args:
            indication: Disease name (e.g., "glioblastoma").

        Returns:
            List of Compound objects for drugs used in the indication.
        """
        result = await self._call_with_retry(self._mcp_drug_search, indication=indication)

        compounds = []
        if isinstance(result, dict):
            items = result.get("drugs", result.get("compounds", result.get("results", [])))
        elif isinstance(result, list):
            items = result
        else:
            return compounds

        for item in items:
            if isinstance(item, dict):
                compounds.append(_parse_compound(item))

        return compounds

    async def get_mechanisms(self, molecule_chembl_id: str) -> list[Mechanism]:
        """Get mechanisms of action for a molecule.

        Args:
            molecule_chembl_id: ChEMBL ID (e.g., "CHEMBL1372").

        Returns:
            List of Mechanism objects.
        """
        result = await self._call_with_retry(
            self._mcp_get_mechanism, molecule_chembl_id=molecule_chembl_id
        )

        mechanisms = []
        if isinstance(result, dict):
            items = result.get("mechanisms", result.get("results", []))
            if not isinstance(items, list):
                items = [result]
        elif isinstance(result, list):
            items = result
        else:
            return mechanisms

        for item in items:
            if isinstance(item, dict):
                mechanisms.append(_parse_mechanism(item))

        return mechanisms

    async def get_target(self, target_chembl_id: str) -> Optional[Target]:
        """Get target details.

        Args:
            target_chembl_id: ChEMBL target ID (e.g., "CHEMBL2073").

        Returns:
            Target object or None.
        """
        result = await self._call_with_retry(
            self._mcp_target_search, target_chembl_id=target_chembl_id
        )

        if isinstance(result, dict):
            items = result.get("targets", result.get("results", []))
            if isinstance(items, list) and items:
                return _parse_target(items[0])
            elif not isinstance(items, list):
                return _parse_target(result)

        return None
