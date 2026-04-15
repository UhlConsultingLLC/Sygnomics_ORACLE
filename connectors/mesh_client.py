"""HTTP client for the NLM MeSH (Medical Subject Headings) API.

Provides disease name expansion by looking up MeSH descriptors and retrieving
related/narrower terms for comprehensive clinical trial coverage.
"""

from typing import Optional

import httpx

from config.schema import MeSHConfig


class MeSHClient:
    """Client for the NLM MeSH Lookup API."""

    def __init__(self, config: Optional[MeSHConfig] = None):
        self.config = config or MeSHConfig()
        self.base_url = self.config.api_base_url

    async def lookup_descriptor(self, term: str) -> list[dict]:
        """Look up MeSH descriptors matching a search term.

        Args:
            term: Disease or condition name to search (e.g., "glioblastoma").

        Returns:
            List of descriptor dicts with 'label' and 'resource' (URI) keys.
        """
        url = f"{self.base_url}/lookup/descriptor"
        params = {"label": term, "match": "contains", "limit": 20}

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()

    async def get_related_terms(self, descriptor_uri: str) -> list[str]:
        """Get narrower and related terms for a MeSH descriptor.

        Args:
            descriptor_uri: MeSH descriptor URI (e.g., "http://id.nlm.nih.gov/mesh/D005909").

        Returns:
            List of related term labels.
        """
        descriptor_id = descriptor_uri.rstrip("/").split("/")[-1]
        url = f"{self.base_url}/lookup/descriptor"
        params = {"label": descriptor_id, "match": "exact", "limit": 1}

        related_terms = []
        async with httpx.AsyncClient(timeout=30) as client:
            # Get the tree numbers for this descriptor to find hierarchical relatives
            sparql_url = f"{self.base_url}/sparql"
            query = f"""
            PREFIX mesh: <http://id.nlm.nih.gov/mesh/>
            PREFIX meshv: <http://id.nlm.nih.gov/mesh/vocab#>
            PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

            SELECT ?childLabel WHERE {{
                ?child meshv:broaderDescriptor mesh:{descriptor_id} .
                ?child rdfs:label ?childLabel .
            }}
            LIMIT {self.config.max_related_terms}
            """
            try:
                resp = await client.get(
                    sparql_url,
                    params={"query": query, "format": "json", "inference": "true"},
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
                for binding in data.get("results", {}).get("bindings", []):
                    label = binding.get("childLabel", {}).get("value", "")
                    if label:
                        related_terms.append(label)
            except (httpx.HTTPError, KeyError):
                pass  # SPARQL endpoint may not always be available

        return related_terms

    async def expand_disease_term(self, term: str) -> list[str]:
        """Expand a disease term into related MeSH terms.

        Args:
            term: User-input disease name (e.g., "GBM", "glioblastoma").

        Returns:
            Deduplicated list of related condition names including the original.
        """
        terms = {term}

        descriptors = await self.lookup_descriptor(term)
        for desc in descriptors:
            label = desc.get("label", "")
            if label:
                terms.add(label)

            resource = desc.get("resource", "")
            if resource:
                children = await self.get_related_terms(resource)
                terms.update(children)

                if len(terms) >= self.config.max_related_terms:
                    break

        return sorted(terms)
