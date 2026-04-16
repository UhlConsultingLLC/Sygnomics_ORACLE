"""TCGA Cohort exploration API endpoints."""

import csv
import json
import os
import statistics
from functools import lru_cache

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/tcga", tags=["tcga"])

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
DCNA_PATH = os.path.join(DATA_DIR, "tcga_dcna.csv")
EXPR_PATH = os.path.join(DATA_DIR, "tcga_gene_expression.csv")
DRUG_TARGETS_CACHE_PATH = os.path.join(DATA_DIR, "drug_targets_cache.json")


# --- Data loading (cached) ---


@lru_cache(maxsize=1)
def _load_dcna() -> tuple[list[str], list[str], dict[str, list[float]]]:
    """Load DCNA CSV. Returns (patients, drugs, {drug: [values]})."""
    with open(DCNA_PATH, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        patients = header[1:]  # first col is "Drug"
        drugs: list[str] = []
        data: dict[str, list[float]] = {}
        for row in reader:
            drug = row[0]
            drugs.append(drug)
            data[drug] = [float(v) if v else 0.0 for v in row[1:]]
    return patients, drugs, data


@lru_cache(maxsize=1)
def _load_expression() -> tuple[list[str], list[dict], dict[str, list[float]]]:
    """Load gene expression CSV. Returns (patients, gene_info, {symbol: [values]})."""
    with open(EXPR_PATH, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        patients = header[2:]  # first two cols are Ensembl ID and Gene Symbol
        genes: list[dict] = []
        data: dict[str, list[float]] = {}
        for row in reader:
            ensembl_id = row[0]
            symbol = row[1] or ensembl_id  # fallback to ensembl if no symbol
            genes.append({"ensembl_id": ensembl_id, "symbol": symbol})
            key = symbol if symbol else ensembl_id
            data[key] = [float(v) if v else 0.0 for v in row[2:]]
    return patients, genes, data


@lru_cache(maxsize=1)
def _load_drug_targets_cache() -> dict:
    """Load pre-built drug-gene target associations from Open Targets cache."""
    if os.path.exists(DRUG_TARGETS_CACHE_PATH):
        with open(DRUG_TARGETS_CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


# --- Response models ---


class TCGASummary(BaseModel):
    patient_count: int
    drug_count: int
    gene_count: int
    patients: list[str]


class DCNADrugList(BaseModel):
    drugs: list[str]


class GeneList(BaseModel):
    genes: list[dict]


class PatientProfile(BaseModel):
    patient_id: str
    top_dcna: list[dict] = Field(default_factory=list)
    bottom_dcna: list[dict] = Field(default_factory=list)


class DCNADetail(BaseModel):
    drug: str
    values: list[dict]  # [{patient, value}]
    stats: dict


class ExpressionDetail(BaseModel):
    gene: str
    ensembl_id: str
    values: list[dict]
    stats: dict


# --- Endpoints ---


@router.get("/summary", response_model=TCGASummary)
def get_summary():
    patients_d, drugs, _ = _load_dcna()
    _, genes, _ = _load_expression()
    return TCGASummary(
        patient_count=len(patients_d),
        drug_count=len(drugs),
        gene_count=len(genes),
        patients=patients_d,
    )


@router.get("/drugs", response_model=DCNADrugList)
def list_drugs(search: str = ""):
    _, drugs, _ = _load_dcna()
    if search:
        # Build a synonym set so brand/generic/research-code aliases all
        # surface the same DCNA drug (e.g. "XL184" → Cabozantinib).
        from api.mesh_expansion import expand_intervention
        try:
            syns = list(expand_intervention(search))
        except Exception:
            syns = []
        keys = {search.lower(), *(s.lower() for s in syns if s)}
        drugs = [d for d in drugs if any(k in d.lower() for k in keys)]
    return DCNADrugList(drugs=drugs[:200])


@router.get("/genes")
def list_genes(search: str = ""):
    _, genes, _ = _load_expression()
    if search:
        s = search.lower()
        genes = [g for g in genes if s in g["symbol"].lower() or s in g["ensembl_id"].lower()]
    return {"genes": genes[:200]}


@router.get("/dcna/{drug}")
def get_dcna_for_drug(drug: str):
    patients, drugs, data = _load_dcna()
    if drug not in data:
        # Try synonym resolution before giving up.
        from api.mesh_expansion import expand_intervention
        resolved = None
        try:
            for syn in expand_intervention(drug):
                if syn in data:
                    resolved = syn
                    break
                # case-insensitive fallback
                for k in data:
                    if k.lower() == syn.lower():
                        resolved = k
                        break
                if resolved:
                    break
        except Exception:
            pass
        if not resolved:
            return {"error": f"Drug '{drug}' not found", "values": [], "stats": {}}
        drug = resolved
    vals = data[drug]
    paired = [{"patient": p, "value": v} for p, v in zip(patients, vals)]
    paired.sort(key=lambda x: x["value"], reverse=True)
    return {
        "drug": drug,
        "values": paired,
        "stats": {
            "mean": round(statistics.mean(vals), 4),
            "median": round(statistics.median(vals), 4),
            "stdev": round(statistics.stdev(vals), 4) if len(vals) > 1 else 0,
            "min": round(min(vals), 4),
            "max": round(max(vals), 4),
        },
    }


@router.get("/expression/{gene}")
def get_expression_for_gene(gene: str):
    patients, genes, data = _load_expression()
    # Try exact match first, then case-insensitive
    key = None
    if gene in data:
        key = gene
    else:
        gl = gene.lower()
        for k in data:
            if k.lower() == gl:
                key = k
                break
    if not key:
        return {"error": f"Gene '{gene}' not found", "values": [], "stats": {}}
    vals = data[key]
    paired = [{"patient": p, "value": round(v, 4)} for p, v in zip(patients, vals)]
    paired.sort(key=lambda x: x["value"], reverse=True)
    # Find ensembl ID
    ensembl = ""
    for g in genes:
        if g["symbol"] == key or g["ensembl_id"] == key:
            ensembl = g["ensembl_id"]
            break
    return {
        "gene": key,
        "ensembl_id": ensembl,
        "values": paired,
        "stats": {
            "mean": round(statistics.mean(vals), 4),
            "median": round(statistics.median(vals), 4),
            "stdev": round(statistics.stdev(vals), 4) if len(vals) > 1 else 0,
            "min": round(min(vals), 4),
            "max": round(max(vals), 4),
        },
    }


@router.get("/drug-targets/{drug_name}")
def get_drug_targets(drug_name: str):
    """Get known gene targets for a drug.

    Checks the Open Targets cache first, then falls back to MOA annotations in the DB.
    """
    _, _, expr_data = _load_expression()
    expr_keys_upper = {k.upper(): k for k in expr_data}

    # 1. Check the Open Targets cache (covers all DCNA drugs)
    cache = _load_drug_targets_cache()
    cache_entry = cache.get(drug_name) or cache.get(drug_name.upper())
    if cache_entry and cache_entry.get("targets"):
        targets = []
        seen = set()
        for t in cache_entry["targets"]:
            gene = t.get("gene_symbol", "")
            action = t.get("action_type", "")
            if gene and (gene, action) not in seen:
                seen.add((gene, action))
                targets.append({
                    "gene_symbol": gene,
                    "action_type": action,
                    "in_expression_data": gene.upper() in expr_keys_upper,
                })
        if targets:
            return {"drug": drug_name, "targets": targets, "source": "open_targets"}

    # 2. Fall back to DB MOA annotations
    from sqlalchemy import func

    from api.dependencies import get_engine, get_session_factory
    from database.models import InterventionRecord, MOAAnnotationRecord

    engine = get_engine()
    session_factory = get_session_factory(engine)
    db = session_factory()
    try:
        rows = (
            db.query(MOAAnnotationRecord.target_gene_symbol, MOAAnnotationRecord.action_type)
            .join(InterventionRecord)
            .filter(func.upper(InterventionRecord.name) == drug_name.upper())
            .filter(MOAAnnotationRecord.target_gene_symbol != "")
            .distinct()
            .all()
        )
        if not rows:
            rows = (
                db.query(MOAAnnotationRecord.target_gene_symbol, MOAAnnotationRecord.action_type)
                .join(InterventionRecord)
                .filter(func.upper(InterventionRecord.name).like(f"%{drug_name.upper()}%"))
                .filter(MOAAnnotationRecord.target_gene_symbol != "")
                .distinct()
                .all()
            )

        targets = []
        for gene_symbol, action_type in rows:
            available = gene_symbol.upper() in expr_keys_upper
            targets.append({
                "gene_symbol": gene_symbol,
                "action_type": action_type,
                "in_expression_data": available,
            })

        return {"drug": drug_name, "targets": targets, "source": "database" if targets else "none"}
    finally:
        db.close()


def _resolve_gene_key(gene: str, expr_data: dict) -> str | None:
    """Resolve a gene name to its key in expression data (case-insensitive)."""
    if gene in expr_data:
        return gene
    gl = gene.lower()
    for k in expr_data:
        if k.lower() == gl:
            return k
    return None


def _compute_correlation(xs: list[float], ys: list[float]) -> float:
    """Compute Pearson correlation coefficient."""
    if len(xs) < 3:
        return 0.0
    mean_x = statistics.mean(xs)
    mean_y = statistics.mean(ys)
    std_x = statistics.stdev(xs)
    std_y = statistics.stdev(ys)
    if std_x > 0 and std_y > 0:
        n = len(xs)
        cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / (n - 1)
        return round(cov / (std_x * std_y), 4)
    return 0.0


@router.get("/scatter")
def get_scatter_data(drug: str = Query(...), gene: str = Query(...)):
    """Get paired DCNA and expression values for all patients (for scatter plot).

    If gene is "AVG_TARGETS:gene1,gene2,...", computes the average expression
    across the listed genes for each patient.
    """
    patients_d, _, dcna_data = _load_dcna()
    patients_e, genes, expr_data = _load_expression()

    # Resolve drug
    if drug not in dcna_data:
        return {"error": f"Drug '{drug}' not found", "points": []}

    # Build patient lookup for expression
    expr_lookup = {p: i for i, p in enumerate(patients_e)}

    # Handle average-of-targets mode
    if gene.startswith("AVG_TARGETS:"):
        gene_list_raw = gene[len("AVG_TARGETS:"):].split(",")
        resolved_genes = []
        for g in gene_list_raw:
            g = g.strip()
            key = _resolve_gene_key(g, expr_data)
            if key:
                resolved_genes.append(key)
        if not resolved_genes:
            return {"error": "None of the target genes found in expression data", "points": []}

        gene_label = f"Avg({', '.join(resolved_genes)})"

        points = []
        for i, patient in enumerate(patients_d):
            if patient in expr_lookup:
                eidx = expr_lookup[patient]
                dcna_val = dcna_data[drug][i]
                expr_vals = [expr_data[gk][eidx] for gk in resolved_genes]
                avg_expr = sum(expr_vals) / len(expr_vals)
                points.append({
                    "patient": patient,
                    "dcna": round(dcna_val, 4),
                    "expression": round(avg_expr, 4),
                })

        xs = [p["dcna"] for p in points]
        ys = [p["expression"] for p in points]
        correlation = _compute_correlation(xs, ys)

        return {
            "drug": drug,
            "gene": gene_label,
            "patient_count": len(points),
            "correlation": correlation,
            "points": points,
        }
    else:
        # Single gene mode
        gene_key = _resolve_gene_key(gene, expr_data)
        if not gene_key:
            return {"error": f"Gene '{gene}' not found", "points": []}

        points = []
        for i, patient in enumerate(patients_d):
            if patient in expr_lookup:
                dcna_val = dcna_data[drug][i]
                expr_val = expr_data[gene_key][expr_lookup[patient]]
                points.append({
                    "patient": patient,
                    "dcna": round(dcna_val, 4),
                    "expression": round(expr_val, 4),
                })

        xs = [p["dcna"] for p in points]
        ys = [p["expression"] for p in points]
        correlation = _compute_correlation(xs, ys)

        return {
            "drug": drug,
            "gene": gene_key,
            "patient_count": len(points),
            "correlation": correlation,
            "points": points,
        }


@router.get("/heatmap")
def get_expression_heatmap(
    genes: str = Query(..., description="Comma-separated gene symbols"),
    include_average: bool = Query(False, description="Prepend an 'Avg of targets' row"),
    max_patients: int = Query(200, le=500),
):
    """Return a z-scored expression heatmap across TCGA patients for the given genes.

    Values are per-gene z-scores (differential expression relative to the cohort
    mean), which is the standard input for expression heatmaps. Patients are
    sorted by the mean z-score across the selected genes, so differentially
    high/low samples appear at the extremes.
    """
    patients_e, _, expr_data = _load_expression()
    gene_list_raw = [g.strip() for g in genes.split(",") if g.strip()]
    resolved: list[tuple[str, list[float]]] = []
    missing: list[str] = []
    for g in gene_list_raw:
        key = _resolve_gene_key(g, expr_data)
        if key:
            resolved.append((key, expr_data[key]))
        else:
            missing.append(g)

    if not resolved:
        return {"error": "No requested genes found in expression data", "missing": missing}

    # Per-gene z-score
    z_rows: list[list[float]] = []
    row_labels: list[str] = []
    for label, vals in resolved:
        mean = statistics.mean(vals)
        sd = statistics.stdev(vals) if len(vals) > 1 else 0.0
        if sd == 0:
            z = [0.0] * len(vals)
        else:
            z = [(v - mean) / sd for v in vals]
        z_rows.append(z)
        row_labels.append(label)

    # Optional "Avg of targets" row — mean z-score across selected genes
    if include_average and len(z_rows) > 1:
        n_patients = len(z_rows[0])
        avg_row = [
            sum(z_rows[g][i] for g in range(len(z_rows))) / len(z_rows)
            for i in range(n_patients)
        ]
        z_rows.insert(0, avg_row)
        row_labels.insert(0, "Avg of targets")

    # Sort patients by the last row if it's the average, otherwise by mean across all rows
    sort_row = z_rows[0] if (include_average and len(resolved) > 1) else [
        sum(z_rows[g][i] for g in range(len(z_rows))) / len(z_rows)
        for i in range(len(z_rows[0]))
    ]
    order = sorted(range(len(patients_e)), key=lambda i: sort_row[i], reverse=True)
    if max_patients and len(order) > max_patients:
        # Keep extremes from both ends for visual contrast
        half = max_patients // 2
        order = order[:half] + order[-half:]

    sorted_patients = [patients_e[i] for i in order]
    sorted_z = [[round(row[i], 4) for i in order] for row in z_rows]

    return {
        "genes": row_labels,
        "patients": sorted_patients,
        "zscores": sorted_z,
        "missing": missing,
        "total_patients": len(patients_e),
        "included_average": include_average and len(resolved) > 1,
    }


@router.get("/patient/{patient_id}")
def get_patient_profile(patient_id: str, top_n: int = Query(default=20, le=100)):
    """Get top/bottom DCNA drugs and expression highlights for a patient."""
    patients_d, drugs, dcna_data = _load_dcna()
    patients_e, genes, expr_data = _load_expression()

    # DCNA profile
    if patient_id in patients_d:
        pidx = patients_d.index(patient_id)
        drug_vals = [(d, dcna_data[d][pidx]) for d in drugs]
        drug_vals.sort(key=lambda x: x[1], reverse=True)
        top_dcna = [{"drug": d, "value": round(v, 4)} for d, v in drug_vals[:top_n]]
        bottom_dcna = [{"drug": d, "value": round(v, 4)} for d, v in drug_vals[-top_n:]]
    else:
        top_dcna, bottom_dcna = [], []

    # Expression profile - top expressed genes
    top_expr = []
    if patient_id in patients_e:
        eidx = patients_e.index(patient_id)
        gene_vals = []
        for g in genes:
            key = g["symbol"] if g["symbol"] else g["ensembl_id"]
            if key in expr_data:
                gene_vals.append({"gene": key, "ensembl_id": g["ensembl_id"], "value": round(expr_data[key][eidx], 4)})
        gene_vals.sort(key=lambda x: x["value"], reverse=True)
        top_expr = gene_vals[:top_n]

    return {
        "patient_id": patient_id,
        "top_dcna": top_dcna,
        "bottom_dcna": bottom_dcna,
        "top_expressed_genes": top_expr,
    }
