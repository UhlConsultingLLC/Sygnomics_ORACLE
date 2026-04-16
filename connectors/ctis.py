"""EU Clinical Trials Information System (CTIS) connector.

Provides programmatic access to the CTIS public API at
``https://euclinicaltrials.eu/ctis-public-api/`` for retrieving
European clinical trial data including protocol details, products
(drugs), eligibility criteria, endpoints, and trial-site locations.

The API is free, unauthenticated, and returns JSON.  Results/outcomes
data is available as document metadata only (the actual results are
uploaded PDFs, not structured data).

Usage::

    from connectors.ctis import CTISConnector

    conn = CTISConnector()
    trials = conn.search_trials("glioblastoma")
    detail = conn.get_trial_details("2024-514399-42-00")
"""

import json
import logging
import ssl
import time
import urllib.error
import urllib.request
from datetime import date, datetime
from typing import Any, Optional

from connectors.models.trial import (
    EligibilityCriteria,
    Intervention,
    Location,
    Outcome,
    Sponsor,
    StudyArm,
    Trial,
)

logger = logging.getLogger(__name__)

_BASE_URL = "https://euclinicaltrials.eu/ctis-public-api"

# CTIS status code mapping
_STATUS_CODES = {
    1: "Submitted",
    2: "Authorised",
    3: "Authorised",
    4: "Authorised",
    5: "Ongoing",
    6: "Suspended",
    7: "Temporarily Halted",
    8: "Ended",
    9: "Ended",
    10: "Withdrawn",
    11: "Not Authorised",
}

# CTIS status codes that map to familiar CT.gov-style statuses
_STATUS_MAP = {
    1: "SUBMITTED",
    2: "APPROVED",
    3: "APPROVED",
    4: "RECRUITING",
    5: "ACTIVE_NOT_RECRUITING",
    6: "SUSPENDED",
    7: "TEMPORARILY_HALTED",
    8: "COMPLETED",
    9: "COMPLETED",
    10: "WITHDRAWN",
    11: "NOT_APPROVED",
}

# Phase code → display string
_PHASE_MAP = {
    "1": "Phase 1",
    "2": "Phase 1/Phase 2",
    "3": "Phase 2",
    "4": "Phase 2",  # "Therapeutic exploratory"
    "5": "Phase 3",
    "6": "Phase 3",  # "Therapeutic confirmatory"
    "7": "Phase 4",
}


def _parse_ctis_date(date_str: Optional[str]) -> Optional[date]:
    """Parse CTIS date strings (DD/MM/YYYY or ISO 8601) to date objects."""
    if not date_str:
        return None
    # Strip country prefix like "FR: 12/11/2025"
    if ":" in date_str and len(date_str.split(":")[0]) <= 4:
        date_str = date_str.split(":", 1)[1].strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(date_str, fmt).date()
        except (ValueError, TypeError):
            continue
    return None


def _fetch_json(url: str, method: str = "GET", data: Optional[dict] = None,
                timeout: int = 30) -> dict:
    """Make an HTTP request and return parsed JSON.

    Uses urllib to avoid external dependencies.  Disables SSL
    verification as the CTIS server occasionally has cert-chain issues.
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    body = json.dumps(data).encode("utf-8") if data else None

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        logger.error("CTIS API error %s %s: %s", method, url, e)
        raise
    except urllib.error.URLError as e:
        logger.error("CTIS connection error %s: %s", url, e)
        raise


class CTISConnector:
    """Connector for the EU CTIS public API.

    Parameters
    ----------
    request_delay : float
        Minimum seconds between consecutive API requests (rate limiting).
    retry_attempts : int
        Number of retries on transient failures.
    retry_backoff : float
        Exponential backoff multiplier for retries.
    page_size : int
        Number of records per page (max 100).
    """

    def __init__(
        self,
        request_delay: float = 0.5,
        retry_attempts: int = 3,
        retry_backoff: float = 2.0,
        page_size: int = 100,
    ):
        self.request_delay = request_delay
        self.retry_attempts = retry_attempts
        self.retry_backoff = retry_backoff
        self.page_size = min(page_size, 100)
        self._last_request_time = 0.0

    def _rate_limit(self):
        """Enforce minimum delay between requests."""
        elapsed = time.time() - self._last_request_time
        if elapsed < self.request_delay:
            time.sleep(self.request_delay - elapsed)
        self._last_request_time = time.time()

    def _request_with_retry(self, url: str, method: str = "GET",
                            data: Optional[dict] = None) -> dict:
        """Execute an HTTP request with retry and rate limiting."""
        last_exc = None
        for attempt in range(self.retry_attempts):
            self._rate_limit()
            try:
                return _fetch_json(url, method=method, data=data)
            except Exception as e:
                last_exc = e
                wait = self.retry_backoff ** attempt
                logger.warning(
                    "CTIS request failed (attempt %d/%d), retrying in %.1fs: %s",
                    attempt + 1, self.retry_attempts, wait, e,
                )
                time.sleep(wait)
        raise last_exc  # type: ignore[misc]

    # ── Search ───────────────────────────────────────────────────────

    def search_trials(
        self,
        query: str = "",
        *,
        medical_condition: str = "",
        status_codes: Optional[list[str]] = None,
        phase_codes: Optional[list[str]] = None,
        has_results: Optional[bool] = None,
        max_results: int = 500,
    ) -> list[dict]:
        """Search CTIS for clinical trials.

        Returns a list of raw search-result dicts from the API.

        Parameters
        ----------
        query : str
            Free-text search (AND logic).
        medical_condition : str
            Structured condition filter.
        status_codes : list[str], optional
            Filter by CTIS status codes (e.g. ["5"] for ongoing).
        phase_codes : list[str], optional
            Filter by trial phase codes.
        has_results : bool, optional
            If True, return only trials with submitted results.
        max_results : int
            Maximum number of results to retrieve.
        """
        criteria: dict[str, Any] = {}
        if query:
            criteria["containAll"] = query
        if medical_condition:
            criteria["medicalCondition"] = medical_condition
        if status_codes:
            criteria["status"] = status_codes
        if phase_codes:
            criteria["trialPhaseCode"] = phase_codes
        if has_results is not None:
            criteria["hasStudyResults"] = "true" if has_results else "false"

        all_results: list[dict] = []
        page = 1

        while len(all_results) < max_results:
            remaining = max_results - len(all_results)
            size = min(self.page_size, remaining)

            body = {
                "pagination": {"page": page, "size": size},
                "sort": {"property": "decisionDate", "direction": "DESC"},
                "searchCriteria": criteria,
            }

            resp = self._request_with_retry(f"{_BASE_URL}/search", method="POST", data=body)

            data = resp.get("data", [])
            if not data:
                break

            all_results.extend(data)

            pagination = resp.get("pagination", {})
            if not pagination.get("nextPage", False):
                break
            page += 1

            # CTIS has a 10,000-record ceiling (page 100 * size 100)
            if page > 100:
                logger.info("Reached CTIS pagination ceiling at page 100")
                break

        logger.info("CTIS search returned %d trials for query=%r", len(all_results), query)
        return all_results[:max_results]

    # ── Retrieve Detail ──────────────────────────────────────────────

    def get_trial_details(self, ct_number: str) -> Optional[dict]:
        """Retrieve full trial detail from CTIS.

        Parameters
        ----------
        ct_number : str
            The CTIS trial number (e.g. "2024-514399-42-00").

        Returns
        -------
        dict or None
            Raw API response, or None on failure.
        """
        try:
            return self._request_with_retry(f"{_BASE_URL}/retrieve/{ct_number}")
        except Exception as e:
            logger.error("Failed to retrieve CTIS trial %s: %s", ct_number, e)
            return None

    # ── Parse into Trial model ───────────────────────────────────────

    def parse_search_result(self, raw: dict) -> Trial:
        """Parse a CTIS search result dict into a Trial Pydantic model.

        This uses the summary data available from the search endpoint.
        For richer data, use ``parse_detail()`` after calling
        ``get_trial_details()``.
        """
        ct_number = raw.get("ctNumber", "")
        trial_id = f"EUCT-{ct_number}" if ct_number else ""

        # Parse status
        status_code = raw.get("ctStatus", 0)
        status = _STATUS_MAP.get(status_code, f"UNKNOWN_{status_code}")

        # Parse phase
        phase_str = raw.get("trialPhase", "")
        phase = _normalize_phase(phase_str)

        # Parse conditions
        conditions_raw = raw.get("conditions", "")
        conditions = [c.strip() for c in conditions_raw.split(",") if c.strip()] if conditions_raw else []

        # Parse products/drugs
        products_raw = raw.get("product", "")
        interventions = []
        if products_raw:
            for prod in products_raw.split(","):
                prod = prod.strip()
                if prod:
                    interventions.append(Intervention(
                        name=prod,
                        type="DRUG",
                        description="",
                    ))

        # Parse enrollment
        enrollment_str = raw.get("totalNumberEnrolled", "")
        enrollment = None
        if enrollment_str:
            try:
                enrollment = int(enrollment_str)
            except (ValueError, TypeError):
                pass

        # Parse dates
        start_date = _parse_ctis_date(raw.get("startDateEU"))
        end_date = _parse_ctis_date(raw.get("endDateEU") or raw.get("endDate"))
        decision_date = _parse_ctis_date(raw.get("decisionDateOverall"))

        # Parse sponsor
        sponsor_name = raw.get("sponsor", "")
        sponsor_type = raw.get("sponsorType", "")
        sponsor = Sponsor(name=sponsor_name, type=sponsor_type) if sponsor_name else None

        # Parse endpoints
        outcomes = []
        primary_ep = raw.get("primaryEndPoint", "")
        if primary_ep:
            outcomes.append(Outcome(
                type="PRIMARY",
                measure=primary_ep[:500],
                description="",
                time_frame="",
            ))

        # Parse countries into locations
        locations = []
        for country_entry in raw.get("trialCountries", []):
            # Format: "France:2" or "Germany:5"
            parts = country_entry.split(":")
            country_name = parts[0].strip() if parts else ""
            if country_name:
                locations.append(Location(
                    facility="",
                    city="",
                    state="",
                    country=country_name,
                ))

        return Trial(
            nct_id=trial_id,
            title=raw.get("ctTitle", ""),
            brief_summary=raw.get("shortTitle", ""),
            detailed_description="",
            status=status,
            phase=phase,
            study_type="INTERVENTIONAL",
            enrollment_count=enrollment,
            start_date=start_date or decision_date,
            completion_date=end_date,
            conditions=conditions,
            interventions=interventions,
            arms=[],
            outcomes=outcomes,
            eligibility=None,
            sponsor=sponsor,
            locations=locations,
            results_url=f"https://euclinicaltrials.eu/ctis-public/search#searchResult/trialDetail/{ct_number}" if ct_number else "",
        )

    def parse_detail(self, raw: dict) -> Trial:
        """Parse a CTIS full-detail response into a Trial Pydantic model.

        This provides richer data than ``parse_search_result()``, including
        eligibility criteria, study arms, detailed product information,
        and trial site locations.
        """
        ct_number = raw.get("ctNumber", "")
        trial_id = f"EUCT-{ct_number}" if ct_number else ""

        # Navigate the nested structure
        auth_app = raw.get("authorizedApplication", {})
        part_i = auth_app.get("authorizedPartI", {})
        parts_ii = auth_app.get("authorizedPartsII", [])
        trial_details = part_i.get("trialDetails", {})
        trial_info = trial_details.get("trialInformation", {})
        protocol_info = trial_details.get("protocolInformation", {})

        # ── Title ──
        identifiers = trial_info.get("clinicalTrialIdentifiers",
                                     trial_details.get("clinicalTrialIdentifiers", {}))
        full_title = (identifiers.get("fullTitle")
                      or identifiers.get("publicTitle")
                      or raw.get("ctTitle", ""))
        short_title = identifiers.get("publicTitle", "")

        # ── Status ──
        status_text = raw.get("ctStatus", "")
        status_code = raw.get("ctPublicStatusCode", 0)
        status = _STATUS_MAP.get(status_code, status_text.upper().replace(" ", "_"))

        # ── Phase ──
        trial_cat = trial_info.get("trialCategory", {})
        phase_str = trial_cat.get("trialPhase", "")
        phase = _normalize_phase(phase_str)

        # ── Conditions ──
        conditions = []
        med_cond = trial_info.get("medicalCondition", {})
        for mc in med_cond.get("partIMedicalConditions", []):
            cond_name = mc.get("medicalCondition", "")
            if cond_name:
                conditions.append(cond_name)
        # Also from top-level medicalConditions
        for mc in part_i.get("medicalConditions", []):
            cond_name = mc.get("medicalCondition", "")
            if cond_name and cond_name not in conditions:
                conditions.append(cond_name)

        # ── Products / Interventions ──
        interventions = []
        for product in part_i.get("products", []):
            prod_info = product.get("productDictionaryInfo", {})
            name = prod_info.get("prodName") or prod_info.get("activeSubstanceName", "")
            if not name:
                continue
            # Get additional details
            pharm_form = prod_info.get("pharmForm", "")
            desc_parts = []
            if pharm_form:
                desc_parts.append(f"Form: {pharm_form}")
            routes = product.get("routes", [])
            if routes:
                route_names = []
                for r in routes:
                    if isinstance(r, dict):
                        rn = r.get("routeName", "")
                        if rn:
                            route_names.append(rn)
                    elif isinstance(r, str) and r:
                        route_names.append(r)
                if route_names:
                    desc_parts.append(f"Route: {', '.join(route_names)}")
            dose = product.get("maxDailyDoseAmount")
            dose_uom = product.get("doseUom", "")
            if dose:
                desc_parts.append(f"Max daily dose: {dose} {dose_uom}")

            interventions.append(Intervention(
                name=name,
                type="DRUG",
                description="; ".join(desc_parts),
            ))

        # ── Eligibility ──
        elig_info = trial_info.get("eligibilityCriteria", {})
        inclusion_items = elig_info.get("principalInclusionCriteria", [])
        exclusion_items = elig_info.get("principalExclusionCriteria", [])

        inclusion_text = "\n".join(
            f"{item.get('number', '')}. {item.get('principalInclusionCriteria', '')}"
            for item in inclusion_items if item.get("principalInclusionCriteria")
        )
        exclusion_text = "\n".join(
            f"{item.get('number', '')}. {item.get('principalExclusionCriteria', '')}"
            for item in exclusion_items if item.get("principalExclusionCriteria")
        )

        criteria_text = ""
        if inclusion_text:
            criteria_text += f"Inclusion Criteria:\n{inclusion_text}\n\n"
        if exclusion_text:
            criteria_text += f"Exclusion Criteria:\n{exclusion_text}"

        # Parse age ranges
        pop_info = trial_info.get("populationOfTrialSubjects", {})
        age_ranges = pop_info.get("ageRanges", [])
        min_age = ""
        max_age = ""
        if age_ranges:
            # CTIS uses age range codes; extract min/max
            ages = []
            for ar in age_ranges:
                label = ar.get("ageRangeLabel", "")
                if label:
                    ages.append(label)
            if ages:
                min_age = ages[0] if ages else ""
                max_age = ages[-1] if len(ages) > 1 else ""

        sex = "ALL"
        is_female = pop_info.get("isFemaleSubjects", True)
        is_male = pop_info.get("isMaleSubjects", True)
        if is_female and not is_male:
            sex = "FEMALE"
        elif is_male and not is_female:
            sex = "MALE"

        eligibility = EligibilityCriteria(
            criteria_text=criteria_text.strip(),
            min_age=min_age,
            max_age=max_age,
            sex=sex,
        ) if criteria_text.strip() else None

        # ── Study Arms ──
        arms = []
        study_design = protocol_info.get("studyDesign", {})
        for period in study_design.get("periodDetails", []):
            for arm_detail in period.get("armDetails", []):
                arms.append(StudyArm(
                    label=arm_detail.get("title", ""),
                    type="EXPERIMENTAL",
                    description=arm_detail.get("description", ""),
                ))

        # ── Outcomes / Endpoints ──
        outcomes = []
        ep_info = trial_info.get("endPoint", {})
        for ep in ep_info.get("primaryEndPoints", []):
            text = ep.get("endPoint", "")
            if text:
                outcomes.append(Outcome(
                    type="PRIMARY",
                    measure=text[:500],
                    description="",
                    time_frame="",
                ))
        for ep in ep_info.get("secondaryEndPoints", []):
            text = ep.get("endPoint", "")
            if text:
                outcomes.append(Outcome(
                    type="SECONDARY",
                    measure=text[:500],
                    description="",
                    time_frame="",
                ))

        # ── Dates ──
        duration = trial_info.get("trialDuration", {})
        start_date = _parse_ctis_date(duration.get("estimatedRecruitmentStartDate"))
        end_date = _parse_ctis_date(duration.get("estimatedEndDate"))
        decision_date = _parse_ctis_date(raw.get("decisionDate"))

        # ── Sponsor ──
        sponsors_list = part_i.get("sponsors", [])
        sponsor = None
        for s in sponsors_list:
            if s.get("primary", False):
                org = s.get("organisation", {})
                sponsor = Sponsor(
                    name=org.get("name", ""),
                    type=org.get("type", ""),
                )
                break
        if not sponsor and sponsors_list:
            org = sponsors_list[0].get("organisation", {})
            sponsor = Sponsor(name=org.get("name", ""), type=org.get("type", ""))

        # ── Locations (from Part II: per-country site data) ──
        locations = []
        total_enrollment = 0
        for part_ii in parts_ii:
            msc_info = part_ii.get("mscInfo", {})
            country_name = msc_info.get("countryName") or msc_info.get("mscName", "")
            enrollment = part_ii.get("recruitmentSubjectCount", 0)
            if enrollment:
                total_enrollment += enrollment

            for site in part_ii.get("trialSites", []):
                addr_info = site.get("organisationAddressInfo", {})
                org = addr_info.get("organisation", {})
                address = addr_info.get("address", {})
                locations.append(Location(
                    facility=org.get("name", ""),
                    city=address.get("city", ""),
                    state="",
                    country=address.get("countryName") or country_name,
                    zip_code=address.get("postcode", ""),
                    contact_name=f"{site.get('personInfo', {}).get('firstName', '')} {site.get('personInfo', {}).get('lastName', '')}".strip(),
                    contact_email=site.get("personInfo", {}).get("email", ""),
                ))

        # ── Results metadata ──
        results_section = raw.get("results", {})
        has_results = bool(results_section.get("summaryResults"))
        results_url = f"https://euclinicaltrials.eu/ctis-public/search#searchResult/trialDetail/{ct_number}"

        # ── Secondary identifiers (cross-reference to CT.gov) ──
        secondary_ids = identifiers.get("secondaryIdentifyingNumbers", {})
        additional_registries = secondary_ids.get("additionalRegistries", [])
        # Store any cross-registry IDs in the description
        xref_ids = []
        for reg in additional_registries:
            reg_name = reg.get("registryName", "")
            reg_num = reg.get("registryNumber", "")
            if reg_name and reg_num:
                xref_ids.append(f"{reg_name}: {reg_num}")

        description = ""
        if short_title:
            description = short_title
        if xref_ids:
            description += f"\n\nCross-references: {'; '.join(xref_ids)}"
        if has_results:
            description += "\n\n[Results submitted to CTIS]"

        return Trial(
            nct_id=trial_id,
            title=full_title,
            brief_summary=short_title,
            detailed_description=description.strip(),
            status=status,
            phase=phase,
            study_type="INTERVENTIONAL",
            enrollment_count=total_enrollment or None,
            start_date=start_date or decision_date,
            completion_date=end_date,
            conditions=conditions,
            interventions=interventions,
            arms=arms,
            outcomes=outcomes,
            eligibility=eligibility,
            sponsor=sponsor,
            locations=locations,
            results_url=results_url,
        )

    # ── High-Level Methods ───────────────────────────────────────────

    def search_and_parse(
        self,
        query: str = "",
        *,
        medical_condition: str = "",
        status_codes: Optional[list[str]] = None,
        phase_codes: Optional[list[str]] = None,
        has_results: Optional[bool] = None,
        max_results: int = 500,
        fetch_details: bool = False,
    ) -> list[Trial]:
        """Search for trials and parse them into Trial models.

        Parameters
        ----------
        fetch_details : bool
            If True, fetch full detail for each trial (slower but richer
            data including eligibility, arms, and sites).  If False,
            uses the search-result summary only.
        """
        raw_results = self.search_trials(
            query,
            medical_condition=medical_condition,
            status_codes=status_codes,
            phase_codes=phase_codes,
            has_results=has_results,
            max_results=max_results,
        )

        trials = []
        for i, raw in enumerate(raw_results):
            ct_number = raw.get("ctNumber", "")
            try:
                if fetch_details and ct_number:
                    detail = self.get_trial_details(ct_number)
                    if detail and isinstance(detail, dict):
                        trials.append(self.parse_detail(detail))
                        continue
                    elif detail:
                        logger.warning("CTIS detail for %s returned non-dict type: %s",
                                       ct_number, type(detail).__name__)
                trials.append(self.parse_search_result(raw))
            except Exception as e:
                logger.warning("Failed to parse CTIS trial %s: %s", ct_number, e)
                continue

            if (i + 1) % 20 == 0:
                logger.info("Parsed %d/%d CTIS trials", i + 1, len(raw_results))

        logger.info("Successfully parsed %d CTIS trials", len(trials))
        return trials

    def get_glioma_trials(
        self,
        *,
        fetch_details: bool = True,
        max_results: int = 200,
    ) -> list[Trial]:
        """Convenience: search for GBM/glioma trials across multiple terms.

        Performs multiple searches with different keywords to maximize
        coverage of glioma-related trials.
        """
        search_terms = [
            "glioblastoma",
            "glioma",
            "GBM",
            "astrocytoma",
            "oligodendroglioma",
            "brain tumor",
            "brain cancer",
        ]

        seen_ids: set[str] = set()
        all_trials: list[Trial] = []

        for term in search_terms:
            trials = self.search_and_parse(
                query=term,
                max_results=max_results,
                fetch_details=fetch_details,
            )
            for t in trials:
                if t.nct_id not in seen_ids:
                    seen_ids.add(t.nct_id)
                    all_trials.append(t)

        logger.info(
            "CTIS glioma search: %d unique trials from %d search terms",
            len(all_trials), len(search_terms),
        )
        return all_trials


def _normalize_phase(phase_str: str) -> str:
    """Normalize CTIS phase strings to CT.gov-style phase names."""
    if not phase_str:
        return ""
    lower = phase_str.strip().lower()

    # Handle pure numeric codes from CTIS trialCategory/trialPhase
    # CTIS codes: 1=Phase I, 2=Phase I/II, 3=Phase II, 4=Phase II (exploratory),
    #             5=Phase III, 6=Phase III (confirmatory), 7=Phase IV
    _CODE_MAP = {"1": "Phase 1", "2": "Phase 1/Phase 2", "3": "Phase 2",
                 "4": "Phase 2", "5": "Phase 3", "6": "Phase 3", "7": "Phase 4"}
    if lower in _CODE_MAP:
        return _CODE_MAP[lower]

    if "iv" in lower or "phase 4" in lower:
        return "Phase 4"
    if "iii" in lower or "phase 3" in lower or "confirmatory" in lower:
        return "Phase 3"
    if "ii" in lower or "phase 2" in lower or "exploratory" in lower:
        return "Phase 2"
    if "i" in lower or "phase 1" in lower:
        if "ii" in lower or "2" in lower:
            return "Phase 1/Phase 2"
        return "Phase 1"
    return phase_str
