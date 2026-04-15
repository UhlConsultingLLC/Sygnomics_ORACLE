"""Disease name expansion and mapping using MeSH ontology.

Accepts user input (e.g., "GBM") and returns a list of related condition names
for comprehensive ClinicalTrials.gov coverage.
"""

from typing import Optional

from config.schema import MeSHConfig
from connectors.mesh_client import MeSHClient

# Well-known abbreviations and synonyms that MeSH may not resolve directly
KNOWN_SYNONYMS: dict[str, list[str]] = {
    "gbm": [
        "glioblastoma",
        "glioblastoma multiforme",
        "high grade glioma",
        "grade IV astrocytoma",
    ],
    "nsclc": [
        "non-small cell lung cancer",
        "non-small cell lung carcinoma",
        "NSCLC",
    ],
    "sclc": [
        "small cell lung cancer",
        "small cell lung carcinoma",
        "SCLC",
    ],
    "aml": [
        "acute myeloid leukemia",
        "acute myelogenous leukemia",
    ],
    "cll": [
        "chronic lymphocytic leukemia",
    ],
    "hcc": [
        "hepatocellular carcinoma",
        "liver cancer",
    ],
    "rcc": [
        "renal cell carcinoma",
        "kidney cancer",
    ],
    "crc": [
        "colorectal cancer",
        "colon cancer",
        "rectal cancer",
    ],
    "tnbc": [
        "triple negative breast cancer",
        "triple-negative breast cancer",
    ],
}


class DiseaseMapper:
    """Maps user disease input to expanded condition terms for trial search."""

    def __init__(self, mesh_config: Optional[MeSHConfig] = None):
        self.mesh_client = MeSHClient(mesh_config)

    async def expand(self, user_input: str) -> list[str]:
        """Expand a disease name into a list of related condition terms.

        Combines known synonym lookup with MeSH API expansion.

        Args:
            user_input: Disease name or abbreviation (e.g., "GBM", "glioblastoma").

        Returns:
            Sorted, deduplicated list of related condition names.
        """
        terms = {user_input}
        normalized = user_input.strip().lower()

        # Check known synonyms
        if normalized in KNOWN_SYNONYMS:
            terms.update(KNOWN_SYNONYMS[normalized])

        # Also check if user input matches any synonym value
        for key, synonyms in KNOWN_SYNONYMS.items():
            for syn in synonyms:
                if normalized == syn.lower():
                    terms.add(key.upper())
                    terms.update(synonyms)
                    break

        # Expand via MeSH API
        try:
            mesh_terms = await self.mesh_client.expand_disease_term(user_input)
            terms.update(mesh_terms)
        except Exception:
            pass  # MeSH API may be unavailable; proceed with known synonyms

        return sorted(terms, key=str.lower)

    def expand_sync(self, user_input: str) -> list[str]:
        """Synchronous wrapper for expand().

        Convenience method for non-async contexts.
        """
        import asyncio

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(
                    asyncio.run, self.expand(user_input)
                ).result()
        else:
            return asyncio.run(self.expand(user_input))
