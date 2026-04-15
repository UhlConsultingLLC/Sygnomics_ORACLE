"""Open Targets Platform GraphQL API client.

Provides drug name resolution and mechanism-of-action retrieval via the
Open Targets public API (https://api.platform.opentargets.org).
"""

import json
import logging
from typing import Any, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

OPEN_TARGETS_GRAPHQL = "https://api.platform.opentargets.org/api/v4/graphql"


# ---- Response models ----

class OTTarget(BaseModel):
    """A molecular target from Open Targets."""
    ensembl_id: str = ""
    approved_symbol: str = ""
    approved_name: str = ""


class OTMechanismRow(BaseModel):
    """A single mechanism-of-action entry from Open Targets."""
    mechanism_of_action: str = ""
    action_type: str = ""
    target_name: str = ""
    targets: list[OTTarget] = Field(default_factory=list)


class OTDrugMOA(BaseModel):
    """Full MOA result for a drug from Open Targets."""
    chembl_id: str = ""
    drug_name: str = ""
    rows: list[OTMechanismRow] = Field(default_factory=list)
    unique_action_types: list[str] = Field(default_factory=list)


# ---- GraphQL queries ----

_SEARCH_QUERY = """
query SearchDrug($name: String!) {
  search(queryString: $name, entityNames: ["drug"], page: {index: 0, size: 5}) {
    total
    hits {
      id
      name
      entity
      description
    }
  }
}
"""

_DRUG_MOA_QUERY = """
query DrugMOA($chemblId: String!) {
  drug(chemblId: $chemblId) {
    id
    name
    mechanismsOfAction {
      uniqueActionTypes
      uniqueTargetTypes
      rows {
        mechanismOfAction
        actionType
        targetName
        targets {
          id
          approvedSymbol
          approvedName
        }
      }
    }
  }
}
"""


def _post_graphql(query: str, variables: dict[str, Any]) -> dict:
    """Send a GraphQL POST request using urllib (no extra deps)."""
    import urllib.request

    payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        OPEN_TARGETS_GRAPHQL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "CT-Pipeline/0.1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


class OpenTargetsClient:
    """Client for the Open Targets Platform GraphQL API."""

    def search_drug(self, name: str) -> Optional[str]:
        """Search for a drug by name and return its ChEMBL ID.

        Args:
            name: Drug name (e.g., "Erlotinib").

        Returns:
            ChEMBL ID string (e.g., "CHEMBL553") or None if not found.
        """
        try:
            result = _post_graphql(_SEARCH_QUERY, {"name": name})
            hits = result.get("data", {}).get("search", {}).get("hits", [])
            for hit in hits:
                if hit.get("entity") == "drug" and hit.get("id"):
                    return hit["id"]
        except Exception as e:
            logger.warning("Open Targets drug search failed for '%s': %s", name, e)
        return None

    def get_drug_moa(self, chembl_id: str) -> Optional[OTDrugMOA]:
        """Fetch mechanisms of action for a drug by ChEMBL ID.

        Args:
            chembl_id: ChEMBL molecule ID (e.g., "CHEMBL553").

        Returns:
            OTDrugMOA object or None on failure.
        """
        try:
            result = _post_graphql(_DRUG_MOA_QUERY, {"chemblId": chembl_id})
            drug_data = result.get("data", {}).get("drug")
            if not drug_data:
                return None

            moa_data = drug_data.get("mechanismsOfAction") or {}
            rows = []
            for row in moa_data.get("rows") or []:
                targets = []
                for t in row.get("targets") or []:
                    targets.append(OTTarget(
                        ensembl_id=t.get("id") or "",
                        approved_symbol=t.get("approvedSymbol") or "",
                        approved_name=t.get("approvedName") or "",
                    ))
                rows.append(OTMechanismRow(
                    mechanism_of_action=row.get("mechanismOfAction") or "",
                    action_type=row.get("actionType") or "",
                    target_name=row.get("targetName") or "",
                    targets=targets,
                ))

            return OTDrugMOA(
                chembl_id=drug_data.get("id") or chembl_id,
                drug_name=drug_data.get("name") or "",
                rows=rows,
                unique_action_types=moa_data.get("uniqueActionTypes") or [],
            )
        except Exception as e:
            logger.warning("Open Targets MOA fetch failed for %s: %s", chembl_id, e)
            return None

    def lookup_drug_moa(self, drug_name: str) -> Optional[OTDrugMOA]:
        """Convenience: search by name then fetch MOA in one call.

        Args:
            drug_name: Drug name (e.g., "Pamiparib").

        Returns:
            OTDrugMOA object or None.
        """
        chembl_id = self.search_drug(drug_name)
        if not chembl_id:
            return None
        return self.get_drug_moa(chembl_id)
