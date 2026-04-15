"""ClinicalTrials.gov connector wrapping MCP search_trials and get_trial_details.

This module provides a high-level interface for retrieving clinical trial data.
In production, methods call MCP tools. For testing, responses can be injected.
"""

import asyncio
import json
import logging
import time
from datetime import date
from pathlib import Path
from typing import Any, Callable, Optional

from config.schema import ClinicalTrialsConfig
from connectors.disease_mapper import DiseaseMapper
from connectors.models.trial import (
    EligibilityCriteria,
    Intervention,
    Location,
    Outcome,
    OutcomeResult,
    Sponsor,
    StudyArm,
    Trial,
    TrialSearchResult,
)

logger = logging.getLogger(__name__)


def _parse_date(date_str: Optional[str]) -> Optional[date]:
    """Parse a date string in various formats to a date object."""
    if not date_str:
        return None
    for fmt in ("%Y-%m-%d", "%B %d, %Y", "%B %Y", "%Y"):
        try:
            return date.fromisoformat(date_str) if fmt == "%Y-%m-%d" else None
        except (ValueError, TypeError):
            pass
    try:
        from datetime import datetime
        for fmt in ("%B %d, %Y", "%B %Y", "%Y"):
            try:
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue
    except Exception:
        pass
    return None


def _parse_trial_from_search(raw: dict) -> Trial:
    """Parse a trial dict from search_trials MCP response into a Trial model."""
    interventions = []
    for iv in raw.get("interventions", []):
        if isinstance(iv, dict):
            interventions.append(Intervention(
                name=iv.get("name", ""),
                type=iv.get("type", iv.get("intervention_type", "")),
                description=iv.get("description", ""),
            ))
        elif isinstance(iv, str):
            interventions.append(Intervention(name=iv))

    outcomes = []
    for oc in raw.get("outcomes", raw.get("primary_outcomes", [])):
        if isinstance(oc, dict):
            results = [
                OutcomeResult(**r) if isinstance(r, dict) else r
                for r in oc.get("results", [])
            ]
            outcomes.append(Outcome(
                type=oc.get("type", "PRIMARY"),
                measure=oc.get("measure", oc.get("outcome", "")),
                description=oc.get("description", ""),
                time_frame=oc.get("time_frame", oc.get("timeFrame", "")),
                results=results,
            ))

    arms = []
    for arm in raw.get("arms", []):
        if isinstance(arm, dict):
            arms.append(StudyArm(
                label=arm.get("label", ""),
                type=arm.get("type", ""),
                description=arm.get("description", ""),
                interventions=arm.get("interventionNames", []),
            ))

    sponsor_data = raw.get("sponsor")
    sponsor = None
    if isinstance(sponsor_data, dict):
        sponsor = Sponsor(
            name=sponsor_data.get("name", ""),
            type=sponsor_data.get("type", sponsor_data.get("class", "")),
        )
    elif isinstance(sponsor_data, str):
        sponsor = Sponsor(name=sponsor_data)

    locations = []
    for loc in raw.get("locations", []):
        if isinstance(loc, dict):
            locations.append(Location(
                facility=loc.get("facility", loc.get("name", "")),
                city=loc.get("city", ""),
                state=loc.get("state", ""),
                country=loc.get("country", ""),
            ))

    eligibility = None
    elig_data = raw.get("eligibility", raw.get("eligibilityCriteria"))
    if isinstance(elig_data, dict):
        eligibility = EligibilityCriteria(
            criteria_text=elig_data.get("criteria_text", elig_data.get("criteria", "")),
            min_age=elig_data.get("min_age", elig_data.get("minimumAge", "")),
            max_age=elig_data.get("max_age", elig_data.get("maximumAge", "")),
            sex=elig_data.get("sex", elig_data.get("gender", "ALL")),
            healthy_volunteers=elig_data.get(
                "healthy_volunteers",
                elig_data.get("healthyVolunteers", False),
            ),
        )
    elif isinstance(elig_data, str):
        eligibility = EligibilityCriteria(criteria_text=elig_data)

    conditions = raw.get("conditions", [])
    if isinstance(conditions, str):
        conditions = [conditions]

    return Trial(
        nct_id=raw.get("nct_id", raw.get("nctId", "")),
        title=raw.get("title", raw.get("briefTitle", "")),
        brief_summary=raw.get("brief_summary", raw.get("briefSummary", "")),
        detailed_description=raw.get("detailed_description", ""),
        status=raw.get("status", raw.get("overallStatus", "")),
        phase=raw.get("phase", ""),
        study_type=raw.get("study_type", raw.get("studyType", "")),
        enrollment_count=raw.get("enrollment_count", raw.get("enrollment")),
        start_date=_parse_date(raw.get("start_date", raw.get("startDate"))),
        completion_date=_parse_date(
            raw.get("completion_date", raw.get("completionDate"))
        ),
        conditions=conditions,
        interventions=interventions,
        outcomes=outcomes,
        arms=arms,
        eligibility=eligibility,
        sponsor=sponsor,
        locations=locations,
        results_url=raw.get("results_url", raw.get("resultsUrl", "")),
    )


def _fetch_json(url: str, params: dict[str, Any]) -> dict:
    """Synchronous HTTP GET that works with ClinicalTrials.gov (urllib-based).

    ClinicalTrials.gov blocks httpx/requests via Cloudflare bot detection,
    but accepts urllib with a standard User-Agent header.
    """
    import urllib.request
    import urllib.parse

    query = urllib.parse.urlencode(params)
    full_url = f"{url}?{query}"
    req = urllib.request.Request(full_url, headers={
        "User-Agent": "Mozilla/5.0 (CT-Pipeline/0.1.0)",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_outcome_results(results_section: dict) -> dict[str, list[dict]]:
    """Parse the resultsSection.outcomeMeasuresModule into a lookup keyed by outcome title.

    Returns a dict mapping outcome title -> list of result dicts (one per group).
    """
    outcome_data: dict[str, list[dict]] = {}
    measures = (
        results_section
        .get("outcomeMeasuresModule", {})
        .get("outcomeMeasures", [])
    )
    for om in measures:
        title = om.get("title", "")
        param_type = om.get("paramType", "")
        unit = om.get("unitOfMeasure", "")
        dispersion_type = om.get("dispersionType", "")

        # Build group lookup
        groups = {g["id"]: g for g in om.get("groups", [])}

        # Get participant counts per group from denoms
        denom_counts: dict[str, int] = {}
        for denom in om.get("denoms", []):
            for c in denom.get("counts", []):
                try:
                    denom_counts[c["groupId"]] = int(c["value"])
                except (ValueError, KeyError):
                    pass

        # Extract measurements. We now also capture the class/category titles
        # so downstream extractors can disambiguate binary categorical outcomes
        # (e.g. Tumor Response: Yes / No), which were previously collapsed.
        results_list: list[dict] = []
        for cls in om.get("classes", []):
            class_title = cls.get("title", "")
            for cat in cls.get("categories", []):
                category_title = cat.get("title", "")
                for meas in cat.get("measurements", []):
                    gid = meas.get("groupId", "")
                    group = groups.get(gid, {})
                    results_list.append({
                        "group_title": group.get("title", gid),
                        "group_description": group.get("description", ""),
                        "participants_count": denom_counts.get(gid),
                        "value": meas.get("value", ""),
                        "param_type": param_type,
                        "unit": unit,
                        "lower_limit": meas.get("lowerLimit", ""),
                        "upper_limit": meas.get("upperLimit", ""),
                        "dispersion_type": dispersion_type,
                        "class_title": class_title,
                        "category": category_title,
                    })

        if results_list:
            outcome_data[title] = results_list

    return outcome_data


async def _http_search_trials(**kwargs) -> dict:
    """Direct HTTP client for ClinicalTrials.gov v2 API (search endpoint).

    This is used when no MCP callable is injected, allowing the connector
    to work standalone in any Python environment.
    """
    base_url = "https://clinicaltrials.gov/api/v2/studies"
    params: dict[str, Any] = {
        "format": "json",
        "pageSize": str(kwargs.get("page_size", 10)),
    }

    # Build query.cond
    condition = kwargs.get("condition")
    if condition:
        params["query.cond"] = condition

    # Status filter
    status = kwargs.get("status")
    if status:
        if isinstance(status, list):
            params["filter.overallStatus"] = "|".join(status)
        else:
            params["filter.overallStatus"] = status

    # Phase filter
    phase = kwargs.get("phase")
    if phase:
        if isinstance(phase, list):
            params["filter.phase"] = "|".join(phase)
        else:
            params["filter.phase"] = phase

    # Study type filter
    study_type = kwargs.get("study_type")
    if study_type:
        params["query.term"] = f"AREA[StudyType]{study_type}"

    # Pagination token
    page_token = kwargs.get("page_token")
    if page_token:
        params["pageToken"] = page_token

    # Count total
    if kwargs.get("count_total"):
        params["countTotal"] = "true"

    # Run synchronous urllib in a thread to avoid blocking the event loop
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, _fetch_json, base_url, params)

    # Normalize the v2 API response into the format our parser expects
    studies = data.get("studies", [])
    trials = []
    for study in studies:
        protocol = study.get("protocolSection", {})
        ident = protocol.get("identificationModule", {})
        status_mod = protocol.get("statusModule", {})
        design = protocol.get("designModule", {})
        desc = protocol.get("descriptionModule", {})
        elig = protocol.get("eligibilityModule", {})
        contacts_loc = protocol.get("contactsLocationsModule", {})
        sponsor_mod = protocol.get("sponsorCollaboratorsModule", {})
        arms_mod = protocol.get("armsInterventionsModule", {})
        outcomes_mod = protocol.get("outcomesModule", {})
        conditions_mod = protocol.get("conditionsModule", {})

        # Interventions
        interventions = []
        for iv in arms_mod.get("interventions", []):
            interventions.append({
                "name": iv.get("name", ""),
                "type": iv.get("type", ""),
                "description": iv.get("description", ""),
            })

        # Arms
        arms = []
        for arm in arms_mod.get("armGroups", []):
            arms.append({
                "label": arm.get("label", ""),
                "type": arm.get("type", ""),
                "description": arm.get("description", ""),
                "interventionNames": arm.get("interventionNames", []),
            })

        # Outcomes
        outcomes = []
        for oc in outcomes_mod.get("primaryOutcomes", []):
            outcomes.append({
                "type": "PRIMARY",
                "measure": oc.get("measure", ""),
                "description": oc.get("description", ""),
                "time_frame": oc.get("timeFrame", ""),
            })
        for oc in outcomes_mod.get("secondaryOutcomes", []):
            outcomes.append({
                "type": "SECONDARY",
                "measure": oc.get("measure", ""),
                "description": oc.get("description", ""),
                "time_frame": oc.get("timeFrame", ""),
            })

        # Sponsor
        lead_sponsor = sponsor_mod.get("leadSponsor", {})
        sponsor = {
            "name": lead_sponsor.get("name", ""),
            "type": lead_sponsor.get("class", ""),
        }

        # Locations
        locations = []
        for loc in contacts_loc.get("locations", []):
            locations.append({
                "facility": loc.get("facility", ""),
                "city": loc.get("city", ""),
                "state": loc.get("state", ""),
                "country": loc.get("country", ""),
            })

        # Eligibility
        eligibility = {
            "criteria_text": elig.get("eligibilityCriteria", ""),
            "min_age": elig.get("minimumAge", ""),
            "max_age": elig.get("maximumAge", ""),
            "sex": elig.get("sex", "ALL"),
            "healthy_volunteers": elig.get("healthyVolunteers", False),
        }

        # Enrollment
        enrollment_info = design.get("enrollmentInfo", {})
        enrollment_count = enrollment_info.get("count")

        trial_dict = {
            "nct_id": ident.get("nctId", ""),
            "title": ident.get("briefTitle", ""),
            "brief_summary": desc.get("briefSummary", ""),
            "detailed_description": desc.get("detailedDescription", ""),
            "status": status_mod.get("overallStatus", ""),
            "phase": design.get("phases", [""])[0] if design.get("phases") else "",
            "study_type": design.get("studyType", ""),
            "enrollment_count": enrollment_count,
            "start_date": status_mod.get("startDateStruct", {}).get("date", ""),
            "completion_date": status_mod.get("completionDateStruct", {}).get("date", ""),
            "conditions": conditions_mod.get("conditions", []),
            "interventions": interventions,
            "outcomes": outcomes,
            "arms": arms,
            "eligibility": eligibility,
            "sponsor": sponsor,
            "locations": locations,
        }
        trials.append(trial_dict)

    result = {
        "trials": trials,
        "next_page_token": data.get("nextPageToken"),
    }
    return result


async def _http_get_trial_details(nct_id: str) -> dict:
    """Direct HTTP client for ClinicalTrials.gov v2 API (single study)."""
    url = f"https://clinicaltrials.gov/api/v2/studies/{nct_id}"
    params = {"format": "json"}

    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, _fetch_json, url, params)

    protocol = data.get("protocolSection", {})
    ident = protocol.get("identificationModule", {})
    status_mod = protocol.get("statusModule", {})
    design = protocol.get("designModule", {})
    desc = protocol.get("descriptionModule", {})
    elig = protocol.get("eligibilityModule", {})
    contacts_loc = protocol.get("contactsLocationsModule", {})
    sponsor_mod = protocol.get("sponsorCollaboratorsModule", {})
    arms_mod = protocol.get("armsInterventionsModule", {})
    outcomes_mod = protocol.get("outcomesModule", {})
    conditions_mod = protocol.get("conditionsModule", {})

    # Parse actual results if available
    results_section = data.get("resultsSection", {})
    result_data = _parse_outcome_results(results_section) if results_section else {}

    interventions = []
    for iv in arms_mod.get("interventions", []):
        interventions.append({
            "name": iv.get("name", ""),
            "type": iv.get("type", ""),
            "description": iv.get("description", ""),
        })

    arms = []
    for arm in arms_mod.get("armGroups", []):
        arms.append({
            "label": arm.get("label", ""),
            "type": arm.get("type", ""),
            "description": arm.get("description", ""),
            "interventionNames": arm.get("interventionNames", []),
        })

    outcomes = []
    for oc in outcomes_mod.get("primaryOutcomes", []):
        measure = oc.get("measure", "")
        outcomes.append({
            "type": "PRIMARY",
            "measure": measure,
            "description": oc.get("description", ""),
            "time_frame": oc.get("timeFrame", ""),
            "results": result_data.get(measure, []),
        })
    for oc in outcomes_mod.get("secondaryOutcomes", []):
        measure = oc.get("measure", "")
        outcomes.append({
            "type": "SECONDARY",
            "measure": measure,
            "description": oc.get("description", ""),
            "time_frame": oc.get("timeFrame", ""),
            "results": result_data.get(measure, []),
        })

    lead_sponsor = sponsor_mod.get("leadSponsor", {})
    enrollment_info = design.get("enrollmentInfo", {})

    return {
        "nct_id": ident.get("nctId", ""),
        "title": ident.get("briefTitle", ""),
        "brief_summary": desc.get("briefSummary", ""),
        "detailed_description": desc.get("detailedDescription", ""),
        "status": status_mod.get("overallStatus", ""),
        "phase": design.get("phases", [""])[0] if design.get("phases") else "",
        "study_type": design.get("studyType", ""),
        "enrollment_count": enrollment_info.get("count"),
        "start_date": status_mod.get("startDateStruct", {}).get("date", ""),
        "completion_date": status_mod.get("completionDateStruct", {}).get("date", ""),
        "conditions": conditions_mod.get("conditions", []),
        "interventions": interventions,
        "outcomes": outcomes,
        "arms": arms,
        "eligibility": {
            "criteria_text": elig.get("eligibilityCriteria", ""),
            "min_age": elig.get("minimumAge", ""),
            "max_age": elig.get("maximumAge", ""),
            "sex": elig.get("sex", "ALL"),
            "healthy_volunteers": elig.get("healthyVolunteers", False),
        },
        "sponsor": {
            "name": lead_sponsor.get("name", ""),
            "type": lead_sponsor.get("class", ""),
        },
        "locations": [
            {
                "facility": loc.get("facility", ""),
                "city": loc.get("city", ""),
                "state": loc.get("state", ""),
                "country": loc.get("country", ""),
            }
            for loc in contacts_loc.get("locations", [])
        ],
    }


class ClinicalTrialsConnector:
    """High-level connector for ClinicalTrials.gov data retrieval.

    When no MCP callables are provided, automatically uses the ClinicalTrials.gov
    v2 REST API via httpx. For testing, mock callables can be injected.
    """

    def __init__(
        self,
        config: Optional[ClinicalTrialsConfig] = None,
        mcp_search: Optional[Callable] = None,
        mcp_get_details: Optional[Callable] = None,
        disease_mapper: Optional[DiseaseMapper] = None,
    ):
        self.config = config or ClinicalTrialsConfig()
        self._mcp_search = mcp_search or _http_search_trials
        self._mcp_get_details = mcp_get_details or _http_get_trial_details
        self.disease_mapper = disease_mapper or DiseaseMapper()

    async def search_trials(
        self,
        condition: str,
        status: Optional[list[str]] = None,
        phase: Optional[list[str]] = None,
        study_type: Optional[str] = None,
        page_size: Optional[int] = None,
        max_results: Optional[int] = None,
    ) -> list[Trial]:
        """Search for trials matching the given condition, with automatic pagination.

        Args:
            condition: Disease or condition search string.
            status: Filter by trial status (e.g., ["RECRUITING", "COMPLETED"]).
            phase: Filter by phase (e.g., ["PHASE2", "PHASE3"]).
            study_type: Filter by study type (e.g., "INTERVENTIONAL").
            page_size: Results per page (default from config).
            max_results: Maximum total results to return (default from config).

        Returns:
            List of validated Trial objects.
        """
        page_size = page_size or self.config.page_size
        max_results = max_results or self.config.max_results_per_query
        all_trials: list[Trial] = []
        page_token = None
        attempts = 0

        while len(all_trials) < max_results:
            kwargs: dict[str, Any] = {
                "condition": condition,
                "page_size": min(page_size, max_results - len(all_trials)),
                "count_total": page_token is None,  # only count on first page
            }
            if status:
                kwargs["status"] = status
            if phase:
                kwargs["phase"] = phase
            if study_type:
                kwargs["study_type"] = study_type
            if page_token:
                kwargs["page_token"] = page_token

            try:
                result = await self._mcp_search(**kwargs)
            except Exception as e:
                attempts += 1
                if attempts >= self.config.retry_max_attempts:
                    logger.error("Max retries reached for search_trials: %s", e)
                    break
                wait = self.config.retry_backoff_factor ** attempts
                logger.warning("Retry %d after %.1fs: %s", attempts, wait, e)
                await asyncio.sleep(wait)
                continue

            attempts = 0  # reset on success

            # Parse the MCP response
            if isinstance(result, str):
                try:
                    result = json.loads(result)
                except json.JSONDecodeError:
                    logger.error("Could not parse MCP response as JSON")
                    break

            if isinstance(result, dict):
                trials_data = result.get("trials", result.get("studies", []))
                page_token = result.get("next_page_token", result.get("nextPageToken"))
            elif isinstance(result, list):
                trials_data = result
                page_token = None
            else:
                break

            for raw_trial in trials_data:
                trial = _parse_trial_from_search(raw_trial)
                all_trials.append(trial)

            if not page_token or not trials_data:
                break

            # Rate limiting
            if self.config.request_delay_seconds > 0:
                await asyncio.sleep(self.config.request_delay_seconds)

        return all_trials

    async def get_trial_details(self, nct_id: str) -> Optional[Trial]:
        """Get full details for a specific trial by NCT ID.

        Args:
            nct_id: ClinicalTrials.gov NCT identifier (e.g., "NCT00000001").

        Returns:
            Validated Trial object, or None if not found.
        """
        for attempt in range(self.config.retry_max_attempts):
            try:
                result = await self._mcp_get_details(nct_id=nct_id)
                break
            except Exception as e:
                if attempt + 1 >= self.config.retry_max_attempts:
                    logger.error("Failed to get details for %s: %s", nct_id, e)
                    return None
                wait = self.config.retry_backoff_factor ** (attempt + 1)
                await asyncio.sleep(wait)
        else:
            return None

        if isinstance(result, str):
            try:
                result = json.loads(result)
            except json.JSONDecodeError:
                return None

        if isinstance(result, dict):
            return _parse_trial_from_search(result)

        return None

    async def get_all_trials_for_disease(
        self,
        disease_input: str,
        expand_terms: bool = True,
        status: Optional[list[str]] = None,
        phase: Optional[list[str]] = None,
    ) -> list[Trial]:
        """Retrieve all trials for a disease, with optional term expansion.

        This is the main entry point for the data acquisition pipeline.

        Args:
            disease_input: User-entered disease name or abbreviation.
            expand_terms: Whether to expand via MeSH/synonyms.
            status: Filter by trial status.
            phase: Filter by phase.

        Returns:
            Deduplicated list of Trial objects across all expanded terms.
        """
        if expand_terms:
            conditions = await self.disease_mapper.expand(disease_input)
            logger.info(
                "Expanded '%s' to %d terms: %s",
                disease_input,
                len(conditions),
                conditions,
            )
        else:
            conditions = [disease_input]

        seen_nct_ids: set[str] = set()
        all_trials: list[Trial] = []

        for condition in conditions:
            trials = await self.search_trials(
                condition=condition,
                status=status,
                phase=phase,
            )
            for trial in trials:
                if trial.nct_id not in seen_nct_ids:
                    seen_nct_ids.add(trial.nct_id)
                    all_trials.append(trial)

            if self.config.request_delay_seconds > 0:
                await asyncio.sleep(self.config.request_delay_seconds)

        logger.info(
            "Retrieved %d unique trials for '%s'",
            len(all_trials),
            disease_input,
        )
        return all_trials

    def save_trials_cache(self, trials: list[Trial], cache_path: str | Path) -> None:
        """Save trials to a local JSON cache file."""
        cache_path = Path(cache_path)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        data = [t.model_dump(mode="json") for t in trials]
        with open(cache_path, "w") as f:
            json.dump(data, f, indent=2, default=str)

    def load_trials_cache(self, cache_path: str | Path) -> list[Trial]:
        """Load trials from a local JSON cache file."""
        cache_path = Path(cache_path)
        if not cache_path.exists():
            return []
        with open(cache_path) as f:
            data = json.load(f)
        return [Trial(**item) for item in data]
