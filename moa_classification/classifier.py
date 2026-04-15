"""MOA classifier orchestrator.

Reads interventions from the database, resolves drug names via Open Targets
(primary) or ChEMBL (fallback), retrieves mechanisms of action, converts
long-form MOA descriptions to short-hand names, and stores MOA annotations.
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from connectors.chembl import ChEMBLConnector
from connectors.open_targets import OpenTargetsClient
from database.models import InterventionRecord, MOAAnnotationRecord
from moa_classification.moa_categories import (
    MOACategory,
    classify_moa,
    INTERVENTION_TYPE_TO_CATEGORY,
)
from moa_classification.moa_shorthand import resolve_shorthand
from moa_classification.name_resolver import (
    clean_drug_name,
    is_drug_intervention,
    normalize_for_matching,
)

logger = logging.getLogger(__name__)


class MOAClassifier:
    """Orchestrates MOA classification for all interventions in the database.

    Uses Open Targets Platform as the primary MOA source, falling back to
    ChEMBL when Open Targets returns no results.
    """

    def __init__(
        self,
        chembl_connector: Optional[ChEMBLConnector] = None,
        open_targets_client: Optional[OpenTargetsClient] = None,
        override_table: Optional[dict[str, str]] = None,
    ):
        self.chembl = chembl_connector or ChEMBLConnector()
        self.ot = open_targets_client or OpenTargetsClient()
        # Manual override: drug name -> ChEMBL ID for known problem names
        self.override_table = override_table or {}

    def _classify_via_open_targets(
        self, intervention: InterventionRecord, clean_name: str
    ) -> Optional[list[MOAAnnotationRecord]]:
        """Try to classify an intervention using Open Targets Platform.

        Args:
            intervention: Database InterventionRecord to classify.
            clean_name: Cleaned drug name for lookup.

        Returns:
            List of MOAAnnotationRecord objects, or None if Open Targets
            returned no results.
        """
        try:
            ot_result = self.ot.lookup_drug_moa(clean_name)
        except Exception as e:
            logger.warning("Open Targets lookup failed for '%s': %s", clean_name, e)
            return None

        if not ot_result or not ot_result.rows:
            return None

        # Update intervention with ChEMBL ID from Open Targets
        if ot_result.chembl_id:
            intervention.chembl_id = ot_result.chembl_id

        annotations = []
        for row in ot_result.rows:
            # Collect gene symbols from the row's targets
            gene_symbols = [
                t.approved_symbol for t in row.targets if t.approved_symbol
            ]

            # Resolve short-hand names
            shorthand = resolve_shorthand(
                mechanism_of_action=row.mechanism_of_action,
                action_type=row.action_type,
                gene_symbols=gene_symbols,
            )

            # Classify into high-level MOA category
            category = classify_moa(
                action_type=row.action_type,
                mechanism_description=row.mechanism_of_action,
                target_name=row.target_name,
            )

            annotations.append(MOAAnnotationRecord(
                intervention_id=intervention.id,
                target_name=row.target_name,
                target_gene_symbol=gene_symbols[0] if gene_symbols else "",
                action_type=row.action_type,
                mechanism_description=row.mechanism_of_action,
                moa_category=category.value,
                moa_short_form=shorthand.short_form,
                moa_broad_category=shorthand.broad_category,
                data_source="open_targets",
            ))

        return annotations if annotations else None

    async def _classify_via_chembl(
        self, intervention: InterventionRecord, clean_name: str
    ) -> list[MOAAnnotationRecord]:
        """Classify an intervention using ChEMBL as a fallback.

        Args:
            intervention: Database InterventionRecord to classify.
            clean_name: Cleaned drug name for lookup.

        Returns:
            List of MOAAnnotationRecord objects.
        """
        annotations = []

        # Check manual override table
        chembl_id = self.override_table.get(normalize_for_matching(clean_name))

        # Compound search
        if not chembl_id:
            try:
                compounds = await self.chembl.search_compound(clean_name)
                if compounds:
                    chembl_id = compounds[0].chembl_id
            except Exception as e:
                logger.warning("ChEMBL compound search failed for '%s': %s", clean_name, e)

        if not chembl_id:
            logger.info("Could not resolve ChEMBL ID for '%s'", clean_name)
            annotations.append(MOAAnnotationRecord(
                intervention_id=intervention.id,
                action_type="UNRESOLVED",
                mechanism_description=f"Could not resolve: {clean_name}",
                moa_category=MOACategory.UNKNOWN.value,
                data_source="chembl",
            ))
            return annotations

        # Update intervention with ChEMBL ID
        intervention.chembl_id = chembl_id

        # Get mechanisms of action from ChEMBL
        try:
            mechanisms = await self.chembl.get_mechanisms(chembl_id)
        except Exception as e:
            logger.warning("ChEMBL mechanism lookup failed for %s: %s", chembl_id, e)
            mechanisms = []

        if not mechanisms:
            annotations.append(MOAAnnotationRecord(
                intervention_id=intervention.id,
                action_type="NO_MOA",
                mechanism_description=f"No MOA found for {chembl_id}",
                moa_category=MOACategory.UNKNOWN.value,
                data_source="chembl",
            ))
            return annotations

        for mech in mechanisms:
            category = classify_moa(
                action_type=mech.action_type,
                mechanism_description=mech.mechanism_of_action,
                target_name=mech.target_name,
            )

            gene_symbol = mech.target_gene_symbol
            if not gene_symbol and mech.target_chembl_id:
                try:
                    target = await self.chembl.get_target(mech.target_chembl_id)
                    if target:
                        gene_symbol = target.gene_symbol
                except Exception:
                    pass

            # Also resolve short-hand from ChEMBL data
            shorthand = resolve_shorthand(
                mechanism_of_action=mech.mechanism_of_action,
                action_type=mech.action_type,
                gene_symbols=[gene_symbol] if gene_symbol else [],
            )

            annotations.append(MOAAnnotationRecord(
                intervention_id=intervention.id,
                target_chembl_id=mech.target_chembl_id,
                target_name=mech.target_name,
                target_gene_symbol=gene_symbol or "",
                action_type=mech.action_type,
                mechanism_description=mech.mechanism_of_action,
                moa_category=category.value,
                moa_short_form=shorthand.short_form,
                moa_broad_category=shorthand.broad_category,
                data_source="chembl",
            ))

        return annotations

    async def classify_intervention(
        self, intervention: InterventionRecord
    ) -> list[MOAAnnotationRecord]:
        """Classify a single intervention's mechanism of action.

        Resolution order:
          1. Open Targets Platform API (primary, synchronous)
          2. ChEMBL (fallback, async with retry)

        Non-drug interventions get a NON_DRUG annotation directly.

        Args:
            intervention: Database InterventionRecord to classify.

        Returns:
            List of MOAAnnotationRecord objects to add to the database.
        """
        # Non-drug interventions get a NON_DRUG annotation
        if not is_drug_intervention(intervention.intervention_type):
            category = classify_moa(intervention_type=intervention.intervention_type)
            return [MOAAnnotationRecord(
                intervention_id=intervention.id,
                action_type="N/A",
                mechanism_description=f"Non-drug intervention: {intervention.intervention_type}",
                moa_category=category.value,
                moa_short_form="",
                moa_broad_category="",
                data_source="manual",
            )]

        # Clean the drug name
        clean_name = clean_drug_name(intervention.name)
        if not clean_name:
            return []

        # Pass 1: Open Targets (primary, synchronous HTTP)
        ot_annotations = self._classify_via_open_targets(intervention, clean_name)
        if ot_annotations:
            logger.info(
                "Open Targets resolved '%s' -> %d MOA(s)",
                clean_name, len(ot_annotations),
            )
            return ot_annotations

        # Pass 2: ChEMBL fallback (async)
        logger.info("Open Targets miss for '%s', falling back to ChEMBL", clean_name)
        return await self._classify_via_chembl(intervention, clean_name)

    async def classify_all(
        self,
        session: Session,
        force_reclassify: bool = False,
    ) -> dict[str, int]:
        """Classify all interventions in the database.

        Args:
            session: Active database session.
            force_reclassify: If True, re-classify even if annotations exist.

        Returns:
            Summary dict with counts: classified, skipped, failed.
        """
        stats = {"classified": 0, "skipped": 0, "failed": 0}

        interventions = session.query(InterventionRecord).all()
        logger.info("Classifying %d interventions", len(interventions))

        for intervention in interventions:
            # Skip if already classified (unless forced)
            if not force_reclassify:
                existing = (
                    session.query(MOAAnnotationRecord)
                    .filter_by(intervention_id=intervention.id)
                    .first()
                )
                if existing:
                    stats["skipped"] += 1
                    continue

            try:
                # If force_reclassify, remove old annotations first
                if force_reclassify:
                    session.query(MOAAnnotationRecord).filter_by(
                        intervention_id=intervention.id
                    ).delete()

                annotations = await self.classify_intervention(intervention)
                for ann in annotations:
                    session.add(ann)
                stats["classified"] += 1
            except Exception as e:
                logger.error(
                    "Failed to classify intervention '%s': %s",
                    intervention.name, e,
                )
                stats["failed"] += 1

        session.commit()
        logger.info("Classification complete: %s", stats)
        return stats
