"""Responder similarity analysis for MOA simulations.

After an MOA simulation has run, this module classifies every TCGA patient
that was eligible for at least one trial in the cohort as a "predicted
responder" or "predicted non-responder" using the simulation's learned
DCNA threshold plus the ``expression > 0`` rule, then searches for
patient-level features that distinguish the two groups.

Outputs feed a UI panel that helps design future trials in the same MOA.
"""

from __future__ import annotations

import csv
import io
import logging
import math

import numpy as np

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────
# Classification matrix construction
# ─────────────────────────────────────────────────────────────────────────


def build_classification_matrix(
    engine,
    cohort_trials: list,
    learned_threshold: float,
) -> dict:
    """Build a per-patient × per-trial responder classification matrix.

    For every cohort trial, walk its eligible patient list and label each
    patient as a predicted responder iff ``avg_dcna > learned_threshold``
    AND ``avg_expr > 0`` — exactly the rule the simulation uses in testing.

    Returns ``{"trials": [nct_id...], "patients": {patient_id: {nct_id: bool}}}``.
    """
    dcna_patient_idx = {p: i for i, p in enumerate(engine.dcna_patients)}
    expr_patient_idx = {p: i for i, p in enumerate(engine.expr_patients)}

    trial_ids: list[str] = []
    patients_map: dict[str, dict[str, bool]] = {}

    for trial in cohort_trials:
        trial_ids.append(trial.nct_id)
        eligible = engine.get_eligible_patients(trial)
        effective_drugs = trial.effective_dcna_drugs

        # Precompute gene targets once per trial (same logic as simulate_trial_iterations)
        expr_keys_upper = {k.upper(): k for k in engine.expr_data}
        gene_keys: set[str] = set()
        for drug in effective_drugs:
            entry = engine.drug_targets.get(drug, {})
            for t in entry.get("targets", []):
                gene = (t.get("gene_symbol") or "").upper()
                if gene in expr_keys_upper:
                    gene_keys.add(expr_keys_upper[gene])

        for pid in eligible:
            d_idx = dcna_patient_idx.get(pid)
            e_idx = expr_patient_idx.get(pid)
            if d_idx is None or e_idx is None:
                continue

            # avg DCNA across effective drugs
            drug_vals = [
                engine.dcna_data[drug][d_idx]
                for drug in effective_drugs
                if drug in engine.dcna_data
            ]
            avg_dcna = float(np.mean(drug_vals)) if drug_vals else 0.0

            # avg expression across target genes
            if gene_keys:
                gene_vals = [engine.expr_data[g][e_idx] for g in gene_keys]
                avg_expr = float(np.mean(gene_vals)) if gene_vals else 0.0
            else:
                avg_expr = 0.0

            is_responder = bool(avg_dcna > learned_threshold and avg_expr > 0)
            patients_map.setdefault(pid, {})[trial.nct_id] = is_responder

    logger.info(
        "Built responder classification matrix: %d trials × %d patients",
        len(trial_ids), len(patients_map),
    )
    return {"trials": trial_ids, "patients": patients_map}


# ─────────────────────────────────────────────────────────────────────────
# Aggregation rules
# ─────────────────────────────────────────────────────────────────────────


def apply_aggregation(matrix: dict, rule: str) -> dict[str, bool]:
    """Collapse the per-trial responder labels to a single per-patient label.

    rule = "majority" → responder if labelled so in ≥50% of trials that
                         included the patient.
    rule = "any"      → responder if labelled so in ≥1 trial.
    """
    rule = (rule or "majority").lower()
    if rule not in ("majority", "any"):
        rule = "majority"

    labels: dict[str, bool] = {}
    for pid, trial_map in matrix.get("patients", {}).items():
        if not trial_map:
            continue
        flags = list(trial_map.values())
        if rule == "any":
            labels[pid] = any(flags)
        else:
            labels[pid] = (sum(1 for f in flags if f) / len(flags)) >= 0.5
    return labels


# ─────────────────────────────────────────────────────────────────────────
# Statistical helpers
# ─────────────────────────────────────────────────────────────────────────


def _fisher_exact_2x2(a: int, b: int, c: int, d: int) -> tuple[float, float]:
    """Return (odds_ratio, two-sided p-value) for a 2×2 table.

    Table layout:
            Responder  Non-Responder
      pos       a             b
      neg       c             d
    """
    from scipy.stats import fisher_exact

    try:
        odds, p = fisher_exact([[a, b], [c, d]], alternative="two-sided")
        if not math.isfinite(odds):
            odds = float("inf") if (a > 0 and d > 0 and (b == 0 or c == 0)) else 0.0
        return float(odds), float(p)
    except Exception:
        return 0.0, 1.0


def _mann_whitney(resp_vals: list[float], nonresp_vals: list[float]) -> tuple[float, float]:
    """Return (rank-biserial effect size, two-sided p-value).

    Rank-biserial ranges [-1, 1]: +1 = responders strictly higher,
    -1 = responders strictly lower, 0 = no shift.
    """
    from scipy.stats import mannwhitneyu

    if len(resp_vals) < 2 or len(nonresp_vals) < 2:
        return 0.0, 1.0
    try:
        stat, p = mannwhitneyu(resp_vals, nonresp_vals, alternative="two-sided")
        n1 = len(resp_vals)
        n2 = len(nonresp_vals)
        # rank-biserial correlation from U
        rb = 1 - (2 * stat) / (n1 * n2)
        return float(rb), float(p)
    except Exception:
        return 0.0, 1.0


def _benjamini_hochberg(pvalues: list[float]) -> list[float]:
    """Return Benjamini–Hochberg q-values in the same order as input."""
    n = len(pvalues)
    if n == 0:
        return []
    order = sorted(range(n), key=lambda i: pvalues[i])
    q = [0.0] * n
    prev_q = 1.0
    for rank_idx in range(n - 1, -1, -1):
        i = order[rank_idx]
        p = pvalues[i]
        raw_q = p * n / (rank_idx + 1)
        prev_q = min(prev_q, raw_q)
        q[i] = min(prev_q, 1.0)
    return q


# ─────────────────────────────────────────────────────────────────────────
# Feature extraction from TCGA biomarker data
# ─────────────────────────────────────────────────────────────────────────


_CLINICAL_FIELDS = [
    ("gender", "Gender"),
    ("vital_status", "Vital status"),
    ("tumor_grade", "Tumor grade"),
    ("primary_diagnosis", "Primary diagnosis"),
    ("progression_or_recurrence", "Progression/recurrence"),
    ("prior_treatment", "Prior treatment"),
    ("race", "Race"),
]


def _extract_clinical_features(
    biomarker_data: dict,
    responder_ids: set[str],
    nonresponder_ids: set[str],
) -> list[dict]:
    """Fisher-test clinical categorical fields + Mann-Whitney for age."""
    patients = biomarker_data.get("patients", {}) or {}
    rows: list[dict] = []

    # Build flat dicts per patient
    def _clin(pid: str) -> dict:
        return (patients.get(pid) or {}).get("clinical") or {}

    # ── Categorical clinical fields ─────────────────────────────────────
    for field_key, label in _CLINICAL_FIELDS:
        # Gather unique non-empty values
        values: set[str] = set()
        for pid in (responder_ids | nonresponder_ids):
            v = _clin(pid).get(field_key) or ""
            if v:
                values.add(str(v))
        if not values:
            continue
        # One row per level — level present vs absent
        for level in values:
            a = sum(1 for pid in responder_ids if _clin(pid).get(field_key) == level)
            b = sum(1 for pid in nonresponder_ids if _clin(pid).get(field_key) == level)
            c = len(responder_ids) - a
            d = len(nonresponder_ids) - b
            if a + b < 3:  # skip ultra-rare levels
                continue
            odds, p = _fisher_exact_2x2(a, b, c, d)
            resp_frac = a / len(responder_ids) if responder_ids else 0
            nonresp_frac = b / len(nonresponder_ids) if nonresponder_ids else 0
            rows.append({
                "feature": f"{label}: {level}",
                "category": "clinical",
                "type": "categorical",
                "responder_summary": f"{a}/{len(responder_ids)} ({resp_frac*100:.0f}%)",
                "nonresponder_summary": f"{b}/{len(nonresponder_ids)} ({nonresp_frac*100:.0f}%)",
                "responder_value": resp_frac,
                "nonresponder_value": nonresp_frac,
                "effect_size": odds,
                "effect_label": "odds ratio",
                "p_value": p,
                "direction": "responders" if resp_frac > nonresp_frac else "non-responders",
            })

    # ── Age (numeric) ──────────────────────────────────────────────────
    resp_ages: list[float] = []
    nonresp_ages: list[float] = []
    for pid in responder_ids:
        days = _clin(pid).get("age_at_diagnosis_days")
        if days:
            resp_ages.append(float(days) / 365.25)
    for pid in nonresponder_ids:
        days = _clin(pid).get("age_at_diagnosis_days")
        if days:
            nonresp_ages.append(float(days) / 365.25)
    if resp_ages and nonresp_ages:
        eff, p = _mann_whitney(resp_ages, nonresp_ages)
        rows.append({
            "feature": "Age at diagnosis (years)",
            "category": "clinical",
            "type": "numeric",
            "responder_summary": f"median {np.median(resp_ages):.1f} (n={len(resp_ages)})",
            "nonresponder_summary": f"median {np.median(nonresp_ages):.1f} (n={len(nonresp_ages)})",
            "responder_value": float(np.median(resp_ages)),
            "nonresponder_value": float(np.median(nonresp_ages)),
            "effect_size": eff,
            "effect_label": "rank-biserial",
            "p_value": p,
            "direction": "responders" if np.median(resp_ages) > np.median(nonresp_ages) else "non-responders",
        })

    return rows


def _extract_mutation_features(
    biomarker_data: dict,
    responder_ids: set[str],
    nonresponder_ids: set[str],
) -> list[dict]:
    """Fisher-test per-gene mutation presence/absence."""
    patients = biomarker_data.get("patients", {}) or {}
    # Gather all mutated genes in the combined cohort
    all_genes: set[str] = set()
    for pid in (responder_ids | nonresponder_ids):
        muts = (patients.get(pid) or {}).get("mutations") or {}
        all_genes.update(muts.keys())

    rows: list[dict] = []
    for gene in sorted(all_genes):
        a = sum(1 for pid in responder_ids if gene in ((patients.get(pid) or {}).get("mutations") or {}))
        b = sum(1 for pid in nonresponder_ids if gene in ((patients.get(pid) or {}).get("mutations") or {}))
        if a + b < 3:
            continue
        c = len(responder_ids) - a
        d = len(nonresponder_ids) - b
        odds, p = _fisher_exact_2x2(a, b, c, d)
        resp_frac = a / len(responder_ids) if responder_ids else 0
        nonresp_frac = b / len(nonresponder_ids) if nonresponder_ids else 0
        rows.append({
            "feature": f"{gene} mutation",
            "category": "mutation",
            "type": "categorical",
            "responder_summary": f"{a}/{len(responder_ids)} ({resp_frac*100:.0f}%)",
            "nonresponder_summary": f"{b}/{len(nonresponder_ids)} ({nonresp_frac*100:.0f}%)",
            "responder_value": resp_frac,
            "nonresponder_value": nonresp_frac,
            "effect_size": odds,
            "effect_label": "odds ratio",
            "p_value": p,
            "direction": "responders" if resp_frac > nonresp_frac else "non-responders",
        })
    return rows


def _extract_cnv_features(
    biomarker_data: dict,
    responder_ids: set[str],
    nonresponder_ids: set[str],
) -> list[dict]:
    """Fisher-test per-gene CNV events (Gain or Loss)."""
    patients = biomarker_data.get("patients", {}) or {}
    all_events: set[tuple[str, str]] = set()  # (gene, change)
    for pid in (responder_ids | nonresponder_ids):
        cnv = (patients.get(pid) or {}).get("cnv") or {}
        for gene, change in cnv.items():
            if change in ("Gain", "Loss"):
                all_events.add((gene, change))

    rows: list[dict] = []
    for gene, change in sorted(all_events):
        a = sum(
            1 for pid in responder_ids
            if ((patients.get(pid) or {}).get("cnv") or {}).get(gene) == change
        )
        b = sum(
            1 for pid in nonresponder_ids
            if ((patients.get(pid) or {}).get("cnv") or {}).get(gene) == change
        )
        if a + b < 3:
            continue
        c = len(responder_ids) - a
        d = len(nonresponder_ids) - b
        odds, p = _fisher_exact_2x2(a, b, c, d)
        resp_frac = a / len(responder_ids) if responder_ids else 0
        nonresp_frac = b / len(nonresponder_ids) if nonresponder_ids else 0
        rows.append({
            "feature": f"{gene} CNV {change.lower()}",
            "category": "cnv",
            "type": "categorical",
            "responder_summary": f"{a}/{len(responder_ids)} ({resp_frac*100:.0f}%)",
            "nonresponder_summary": f"{b}/{len(nonresponder_ids)} ({nonresp_frac*100:.0f}%)",
            "responder_value": resp_frac,
            "nonresponder_value": nonresp_frac,
            "effect_size": odds,
            "effect_label": "odds ratio",
            "p_value": p,
            "direction": "responders" if resp_frac > nonresp_frac else "non-responders",
        })
    return rows


def _extract_expression_features(
    engine,
    responder_ids: set[str],
    nonresponder_ids: set[str],
) -> list[dict]:
    """Mann-Whitney per gene across ALL genes in the expression matrix."""
    expr_patients = engine.expr_patients
    expr_data = engine.expr_data
    p_idx = {p: i for i, p in enumerate(expr_patients)}

    resp_idx = [p_idx[p] for p in responder_ids if p in p_idx]
    nonresp_idx = [p_idx[p] for p in nonresponder_ids if p in p_idx]
    if len(resp_idx) < 3 or len(nonresp_idx) < 3:
        return []

    rows: list[dict] = []
    from scipy.stats import mannwhitneyu

    for gene, values in expr_data.items():
        # Skip flat/uninformative genes
        resp_vals = np.asarray([values[i] for i in resp_idx], dtype=float)
        nonresp_vals = np.asarray([values[i] for i in nonresp_idx], dtype=float)
        if resp_vals.std() < 1e-9 and nonresp_vals.std() < 1e-9:
            continue
        try:
            stat, p = mannwhitneyu(resp_vals, nonresp_vals, alternative="two-sided")
        except Exception:
            continue
        n1 = len(resp_vals)
        n2 = len(nonresp_vals)
        rb = 1 - (2 * float(stat)) / (n1 * n2)
        median_r = float(np.median(resp_vals))
        median_n = float(np.median(nonresp_vals))
        rows.append({
            "feature": f"{gene} expression",
            "category": "expression",
            "type": "numeric",
            "responder_summary": f"median {median_r:.2f}",
            "nonresponder_summary": f"median {median_n:.2f}",
            "responder_value": median_r,
            "nonresponder_value": median_n,
            "effect_size": rb,
            "effect_label": "rank-biserial",
            "p_value": float(p),
            "direction": "responders" if median_r > median_n else "non-responders",
        })
    return rows


# ─────────────────────────────────────────────────────────────────────────
# Suggested eligibility criteria generation
# ─────────────────────────────────────────────────────────────────────────


def _generate_suggestions(features: list[dict], q_cutoff: float = 0.1, max_items: int = 10) -> list[dict]:
    """Build plain-language eligibility suggestions from significant features."""
    sig = [f for f in features if f.get("q_value", 1.0) < q_cutoff]
    # Sort by absolute effect size × -log10(p)
    def _score(f):
        eff = abs(f.get("effect_size") or 0)
        # Clip odds ratio to avoid inf blowups
        if f.get("effect_label") == "odds ratio" and eff > 20:
            eff = 20
        p = max(f.get("p_value") or 1e-300, 1e-300)
        return eff * (-math.log10(p))
    sig.sort(key=_score, reverse=True)

    out: list[dict] = []
    for f in sig[:max_items]:
        category = f["category"]
        feat = f["feature"]
        direction = f["direction"]
        rs = f["responder_summary"]
        ns = f["nonresponder_summary"]
        q = f.get("q_value", 1.0)

        if category == "expression":
            gene = feat.replace(" expression", "")
            if direction == "responders":
                text = (
                    f"Enrich for patients with HIGH {gene} expression — "
                    f"responders {rs}, non-responders {ns} (q = {q:.3g})."
                )
            else:
                text = (
                    f"Enrich for patients with LOW {gene} expression — "
                    f"responders {rs}, non-responders {ns} (q = {q:.3g})."
                )
        elif category == "mutation":
            gene = feat.replace(" mutation", "")
            if direction == "responders":
                text = (
                    f"Enrich for {gene}-mutated patients — responders {rs}, "
                    f"non-responders {ns} (q = {q:.3g})."
                )
            else:
                text = (
                    f"Exclude or de-prioritize {gene}-mutated patients — "
                    f"responders {rs}, non-responders {ns} (q = {q:.3g})."
                )
        elif category == "cnv":
            if direction == "responders":
                text = (
                    f"Enrich for patients with {feat} — responders {rs}, "
                    f"non-responders {ns} (q = {q:.3g})."
                )
            else:
                text = (
                    f"Exclude patients with {feat} — responders {rs}, "
                    f"non-responders {ns} (q = {q:.3g})."
                )
        else:  # clinical
            if direction == "responders":
                text = (
                    f"Consider enriching for {feat} — responders {rs}, "
                    f"non-responders {ns} (q = {q:.3g})."
                )
            else:
                text = (
                    f"Consider de-prioritizing {feat} — responders {rs}, "
                    f"non-responders {ns} (q = {q:.3g})."
                )

        out.append({
            "text": text,
            "feature": feat,
            "category": category,
            "q_value": q,
            "effect_size": f.get("effect_size"),
        })
    return out


# ─────────────────────────────────────────────────────────────────────────
# Multi-feature combination rule mining
# ─────────────────────────────────────────────────────────────────────────


def _build_patient_feature_matrix(
    engine,
    features: list[dict],
    responder_ids: set[str],
    nonresponder_ids: set[str],
    top_n: int = 25,
) -> tuple[list[str], list[str], np.ndarray, np.ndarray]:
    """Build a per-patient feature matrix restricted to the top-N significant features.

    Numeric features (expression, age) are kept as continuous values.
    Categorical features (mutation, cnv, clinical level) become binary 0/1.

    Returns: (feature_names, patient_ids, X, y) — y is 1 for responder, 0 for non-responder.
    """
    patients = (getattr(engine, "biomarker_data", {}) or {}).get("patients", {}) or {}
    expr_patients = getattr(engine, "expr_patients", []) or []
    expr_data = getattr(engine, "expr_data", {}) or {}
    expr_idx = {p: i for i, p in enumerate(expr_patients)}

    # Pick top-N features by q-value (already sorted), keep only those with sufficient data
    # Rank features by raw p-value so we always have candidates even when no
    # single feature survives multiple-testing correction on a small cohort.
    ranked = sorted(features, key=lambda f: f.get("p_value", 1.0))
    picked: list[dict] = []
    for f in ranked:
        if len(picked) >= top_n:
            break
        if f.get("p_value", 1.0) >= 0.2:  # use raw p, not q, so small cohorts aren't starved
            continue
        picked.append(f)
    if len(picked) < 2:
        # Fallback: take the top few by p-value regardless of threshold so the
        # tree at least has something to split on.
        picked = ranked[: min(top_n, len(ranked))]
    if not picked:
        return [], [], np.zeros((0, 0)), np.zeros(0)

    patient_ids = sorted(responder_ids | nonresponder_ids)
    n_patients = len(patient_ids)
    feat_names: list[str] = []
    cols: list[np.ndarray] = []

    for f in picked:
        cat = f["category"]
        feat = f["feature"]
        col = np.full(n_patients, np.nan, dtype=float)

        if cat == "expression":
            gene = feat.replace(" expression", "")
            if gene not in expr_data:
                continue
            vals = expr_data[gene]
            for i, pid in enumerate(patient_ids):
                j = expr_idx.get(pid)
                if j is not None:
                    col[i] = float(vals[j])
            feat_names.append(f"{gene} expr")
        elif cat == "mutation":
            gene = feat.replace(" mutation", "")
            for i, pid in enumerate(patient_ids):
                muts = (patients.get(pid) or {}).get("mutations") or {}
                col[i] = 1.0 if gene in muts else 0.0
            feat_names.append(f"{gene} mut")
        elif cat == "cnv":
            # feature looks like "EGFR CNV gain"
            parts = feat.replace(" CNV ", " ").rsplit(" ", 1)
            if len(parts) != 2:
                continue
            gene, change = parts[0], parts[1].capitalize()
            for i, pid in enumerate(patient_ids):
                cnv = (patients.get(pid) or {}).get("cnv") or {}
                col[i] = 1.0 if cnv.get(gene) == change else 0.0
            feat_names.append(f"{gene} {change.lower()}")
        elif cat == "clinical":
            if f.get("type") == "numeric" and feat.startswith("Age"):
                for i, pid in enumerate(patient_ids):
                    days = ((patients.get(pid) or {}).get("clinical") or {}).get("age_at_diagnosis_days")
                    if days:
                        col[i] = float(days) / 365.25
                feat_names.append("Age (yrs)")
            else:
                # categorical level like "Tumor grade: G4"
                if ": " not in feat:
                    continue
                label, level = feat.split(": ", 1)
                # Reverse map label → field_key
                key = None
                for k, lab in _CLINICAL_FIELDS:
                    if lab == label:
                        key = k
                        break
                if key is None:
                    continue
                for i, pid in enumerate(patient_ids):
                    clin = (patients.get(pid) or {}).get("clinical") or {}
                    col[i] = 1.0 if str(clin.get(key) or "") == level else 0.0
                feat_names.append(f"{label}={level}")
        else:
            continue

        cols.append(col)

    if not cols:
        return [], [], np.zeros((0, 0)), np.zeros(0)

    X = np.column_stack(cols)
    y = np.array([1 if pid in responder_ids else 0 for pid in patient_ids], dtype=int)

    # Drop rows where all features are NaN, and impute remaining NaN with column median
    row_all_nan = np.all(np.isnan(X), axis=1)
    keep = ~row_all_nan
    X = X[keep]
    y = y[keep]
    patient_ids = [p for p, k in zip(patient_ids, keep) if k]

    # Impute NaN with column median
    for j in range(X.shape[1]):
        col = X[:, j]
        if np.any(np.isnan(col)):
            med = np.nanmedian(col)
            if np.isnan(med):
                med = 0.0
            col[np.isnan(col)] = med
            X[:, j] = col

    return feat_names, patient_ids, X, y


def find_combination_rules(
    engine,
    features: list[dict],
    responder_ids: set[str],
    nonresponder_ids: set[str],
    top_n: int = 25,
    max_depth: int = 3,
    min_leaf: int = 3,
    min_precision: float = 0.6,
) -> list[dict]:
    """Mine multi-feature combination rules that identify likely responders.

    Fits a shallow decision tree on the top-N significant single features and
    extracts every root-to-leaf path whose responder precision and support
    meet the given thresholds. Returns one dict per qualifying rule, sorted
    by a (precision × lift × support) score.
    """
    if len(responder_ids) < 3 or len(nonresponder_ids) < 3:
        return []
    feat_names, patient_ids, X, y = _build_patient_feature_matrix(
        engine, features, responder_ids, nonresponder_ids, top_n=top_n
    )
    if X.shape[0] == 0 or X.shape[1] == 0:
        return []

    try:
        from sklearn.tree import DecisionTreeClassifier
    except Exception as e:
        logger.warning(f"sklearn unavailable for combination mining: {e}")
        return []

    clf = DecisionTreeClassifier(
        max_depth=max_depth,
        min_samples_leaf=min_leaf,
        class_weight="balanced",
        random_state=42,
    )
    clf.fit(X, y)

    tree = clf.tree_
    base_rate = float(y.mean()) if len(y) else 0.0
    rules: list[dict] = []

    def _recurse(node: int, conditions: list[tuple[int, str, float]]):
        left = tree.children_left[node]
        right = tree.children_right[node]
        if left == right:  # leaf
            samples = int(tree.n_node_samples[node])
            # value is shape (1, n_classes), classes_ order from clf.classes_
            vals = tree.value[node][0]
            classes = list(clf.classes_)
            n_resp = int(vals[classes.index(1)]) if 1 in classes else 0
            n_nonresp = int(vals[classes.index(0)]) if 0 in classes else 0
            if samples == 0:
                return
            precision = n_resp / samples
            lift = precision / base_rate if base_rate > 0 else 0.0
            # Require the rule to meaningfully beat the base rate (lift > 1.1)
            # so we don't just report the all-patients leaf.
            if (
                precision >= min_precision
                and n_resp >= min_leaf
                and (base_rate == 0 or precision > base_rate * 1.1)
            ):
                parts: list[str] = []
                for feat_i, op, thr in conditions:
                    name = feat_names[feat_i]
                    # Binary features → present/absent
                    col = X[:, feat_i]
                    is_binary = set(np.unique(col)).issubset({0.0, 1.0})
                    if is_binary:
                        if (op == ">" and thr < 1.0) or (op == ">=" and thr <= 1.0):
                            parts.append(f"{name} present")
                        else:
                            parts.append(f"{name} absent")
                    else:
                        if op == "<=":
                            parts.append(f"{name} ≤ {thr:.2f}")
                        else:
                            parts.append(f"{name} > {thr:.2f}")
                rule_text = " AND ".join(parts) if parts else "(all patients)"
                rules.append({
                    "rule": rule_text,
                    "n_features": len(parts),
                    "n_patients": samples,
                    "n_responders": n_resp,
                    "n_nonresponders": n_nonresp,
                    "precision": precision,
                    "lift": lift,
                })
            return
        feat_i = int(tree.feature[node])
        thr = float(tree.threshold[node])
        _recurse(left, conditions + [(feat_i, "<=", thr)])
        _recurse(right, conditions + [(feat_i, ">", thr)])

    _recurse(0, [])

    # Sort by precision, then lift, then support
    rules.sort(key=lambda r: (-r["precision"], -r["lift"], -r["n_patients"]))
    return rules


# ─────────────────────────────────────────────────────────────────────────
# Public API: full analysis
# ─────────────────────────────────────────────────────────────────────────


def compute_responder_similarity(
    engine,
    classification_matrix: dict,
    rule: str = "majority",
    q_cutoff: float = 0.1,
) -> dict:
    """Run the full responder-similarity analysis.

    Returns a dict with: ``meta``, ``groups``, ``features`` (list, all), and
    ``suggestions``.
    """
    labels = apply_aggregation(classification_matrix, rule)
    responder_ids = {pid for pid, r in labels.items() if r}
    nonresponder_ids = {pid for pid, r in labels.items() if not r}

    biomarker_data = getattr(engine, "biomarker_data", {}) or {}

    features: list[dict] = []
    features.extend(_extract_clinical_features(biomarker_data, responder_ids, nonresponder_ids))
    features.extend(_extract_mutation_features(biomarker_data, responder_ids, nonresponder_ids))
    features.extend(_extract_cnv_features(biomarker_data, responder_ids, nonresponder_ids))
    features.extend(_extract_expression_features(engine, responder_ids, nonresponder_ids))

    # Benjamini–Hochberg across ALL features in one family
    pvals = [f["p_value"] for f in features]
    qvals = _benjamini_hochberg(pvals)
    for f, q in zip(features, qvals):
        f["q_value"] = q

    # Sort by q ascending, then |effect| descending
    def _sort_key(f):
        return (f["q_value"], -abs(f.get("effect_size") or 0))
    features.sort(key=_sort_key)

    suggestions = _generate_suggestions(features, q_cutoff=q_cutoff)

    # Multi-feature combination rules
    combinations = find_combination_rules(
        engine, features, responder_ids, nonresponder_ids
    )

    return {
        "meta": {
            "rule": rule,
            "q_cutoff": q_cutoff,
            "total_patients": len(labels),
            "total_features": len(features),
            "n_trials_in_cohort": len(classification_matrix.get("trials", [])),
        },
        "groups": {
            "responders": sorted(responder_ids),
            "nonresponders": sorted(nonresponder_ids),
            "n_responders": len(responder_ids),
            "n_nonresponders": len(nonresponder_ids),
        },
        "features": features,
        "suggestions": suggestions,
        "combinations": combinations,
    }


def features_to_csv(features: list[dict]) -> str:
    """Serialize a feature list to CSV for download."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "feature", "category", "type",
        "responder_summary", "nonresponder_summary",
        "responder_value", "nonresponder_value",
        "effect_label", "effect_size",
        "p_value", "q_value", "direction",
    ])
    for f in features:
        writer.writerow([
            f.get("feature", ""),
            f.get("category", ""),
            f.get("type", ""),
            f.get("responder_summary", ""),
            f.get("nonresponder_summary", ""),
            f.get("responder_value", ""),
            f.get("nonresponder_value", ""),
            f.get("effect_label", ""),
            f.get("effect_size", ""),
            f.get("p_value", ""),
            f.get("q_value", ""),
            f.get("direction", ""),
        ])
    return out.getvalue()
