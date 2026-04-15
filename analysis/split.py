"""Training/testing split module with stratified, random, and temporal strategies."""

import logging
from typing import Optional

import numpy as np
from sqlalchemy.orm import Session

from analysis.models import SplitResult
from config.schema import SplitConfig
from database.models import (
    InterventionRecord,
    MOAAnnotationRecord,
    TrialRecord,
    trial_interventions,
)

logger = logging.getLogger(__name__)


def _get_trial_strata(session: Session, nct_ids: list[str]) -> dict[str, str]:
    """Assign each trial a stratum label based on its primary MOA category.

    Returns a dict mapping nct_id -> stratum label.
    """
    strata = {}
    for nct_id in nct_ids:
        # Get the primary MOA category for this trial (most common across its interventions)
        moa_cats = (
            session.query(MOAAnnotationRecord.moa_category)
            .join(InterventionRecord)
            .join(trial_interventions)
            .filter(trial_interventions.c.trial_nct_id == nct_id)
            .all()
        )
        if moa_cats:
            cats = [c[0] for c in moa_cats if c[0]]
            strata[nct_id] = cats[0] if cats else "Unknown"
        else:
            strata[nct_id] = "Unknown"
    return strata


def split_trials(
    session: Session,
    nct_ids: list[str],
    config: Optional[SplitConfig] = None,
) -> SplitResult:
    """Split trial NCT IDs into training and testing sets.

    Args:
        session: Database session (needed for stratification metadata).
        nct_ids: List of trial NCT IDs to split.
        config: Split configuration. Defaults to stratified split.

    Returns:
        SplitResult with train and test NCT ID lists.
    """
    if config is None:
        config = SplitConfig()

    if len(nct_ids) < 2:
        return SplitResult(
            train_nct_ids=nct_ids,
            test_nct_ids=[],
            strategy=config.strategy,
            test_fraction=config.test_fraction,
            random_seed=config.random_seed,
        )

    rng = np.random.RandomState(config.random_seed)

    if config.strategy == "random":
        train_ids, test_ids = _random_split(nct_ids, config.test_fraction, rng)

    elif config.strategy == "stratified":
        strata = _get_trial_strata(session, nct_ids)
        train_ids, test_ids = _stratified_split(nct_ids, strata, config.test_fraction, rng)

    elif config.strategy == "temporal":
        train_ids, test_ids = _temporal_split(session, nct_ids, config.test_fraction)

    else:
        raise ValueError(f"Unknown split strategy: {config.strategy}")

    logger.info(
        "Split %d trials: %d train, %d test (strategy=%s)",
        len(nct_ids), len(train_ids), len(test_ids), config.strategy,
    )

    return SplitResult(
        train_nct_ids=train_ids,
        test_nct_ids=test_ids,
        strategy=config.strategy,
        test_fraction=config.test_fraction,
        random_seed=config.random_seed,
    )


def _random_split(
    nct_ids: list[str], test_fraction: float, rng: np.random.RandomState
) -> tuple[list[str], list[str]]:
    """Simple random split."""
    ids = list(nct_ids)
    rng.shuffle(ids)
    split_idx = max(1, int(len(ids) * (1 - test_fraction)))
    return ids[:split_idx], ids[split_idx:]


def _stratified_split(
    nct_ids: list[str],
    strata: dict[str, str],
    test_fraction: float,
    rng: np.random.RandomState,
) -> tuple[list[str], list[str]]:
    """Stratified split preserving stratum proportions."""
    # Group by stratum
    stratum_groups: dict[str, list[str]] = {}
    for nct_id in nct_ids:
        s = strata.get(nct_id, "Unknown")
        stratum_groups.setdefault(s, []).append(nct_id)

    train_ids = []
    test_ids = []

    for stratum, ids in stratum_groups.items():
        rng.shuffle(ids)
        n_test = max(1, int(len(ids) * test_fraction)) if len(ids) >= 2 else 0
        test_ids.extend(ids[:n_test])
        train_ids.extend(ids[n_test:])

    return train_ids, test_ids


def _temporal_split(
    session: Session, nct_ids: list[str], test_fraction: float
) -> tuple[list[str], list[str]]:
    """Temporal split: older trials for training, newer for testing."""
    # Get start dates for all trials
    trials = (
        session.query(TrialRecord.nct_id, TrialRecord.start_date)
        .filter(TrialRecord.nct_id.in_(nct_ids))
        .all()
    )

    # Sort by start date (nulls go to training)
    sorted_trials = sorted(
        trials,
        key=lambda t: t.start_date if t.start_date else __import__("datetime").date.min,
    )

    split_idx = max(1, int(len(sorted_trials) * (1 - test_fraction)))
    train_ids = [t.nct_id for t in sorted_trials[:split_idx]]
    test_ids = [t.nct_id for t in sorted_trials[split_idx:]]

    return train_ids, test_ids
