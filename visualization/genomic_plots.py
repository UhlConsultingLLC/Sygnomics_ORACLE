"""Genomic visualizations: DCNA distributions, expression plots, heatmaps."""

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

import visualization.theme  # noqa: F401


def plot_dcna_violin(
    dcna_scores: pd.Series,
    group_labels: pd.Series | None = None,
    title: str = "DCNA Score Distribution",
) -> go.Figure:
    """Violin plot of DCNA score distributions, optionally grouped."""
    df = pd.DataFrame({"dcna_score": dcna_scores})

    if group_labels is not None:
        df["group"] = group_labels
        fig = px.violin(
            df, y="dcna_score", x="group", color="group",
            box=True, points="outliers", title=title,
            labels={"dcna_score": "DCNA Score", "group": ""},
        )
    else:
        fig = px.violin(
            df, y="dcna_score", box=True, points="outliers", title=title,
            labels={"dcna_score": "DCNA Score"},
        )

    return fig


def plot_expression_scatter(
    x_values: pd.Series,
    y_values: pd.Series,
    x_label: str = "Gene A Expression",
    y_label: str = "Gene B Expression",
    color_values: pd.Series | None = None,
    title: str = "Gene Expression Scatter",
) -> go.Figure:
    """Scatter plot of two expression features."""
    df = pd.DataFrame({"x": x_values, "y": y_values})
    if color_values is not None:
        df["group"] = color_values

    fig = px.scatter(
        df, x="x", y="y",
        color="group" if color_values is not None else None,
        title=title,
        labels={"x": x_label, "y": y_label},
    )
    return fig


def plot_expression_heatmap(
    matrix: pd.DataFrame,
    title: str = "Gene Expression Heatmap",
    max_genes: int = 50,
    max_samples: int = 50,
) -> go.Figure:
    """Heatmap of gene expression values (genes x samples)."""
    # Limit size for readability
    plot_matrix = matrix.iloc[:max_genes, :max_samples]

    fig = go.Figure(data=go.Heatmap(
        z=plot_matrix.values,
        x=list(plot_matrix.columns),
        y=list(plot_matrix.index),
        colorscale="RdBu_r",
        colorbar=dict(title="Expression"),
    ))
    fig.update_layout(
        title=title,
        xaxis_title="Samples",
        yaxis_title="Genes",
        height=max(400, len(plot_matrix) * 15 + 100),
    )
    return fig


def plot_dcna_vs_response(
    dcna_scores: pd.Series,
    is_responder: pd.Series,
    threshold: float | None = None,
    title: str = "DCNA Score vs Response Status",
) -> go.Figure:
    """Box plot of DCNA scores by responder status with optional threshold line."""
    df = pd.DataFrame({
        "dcna_score": dcna_scores,
        "Response": is_responder.map({True: "Responder", False: "Non-Responder"}),
    })

    fig = px.box(
        df, x="Response", y="dcna_score", color="Response",
        title=title,
        labels={"dcna_score": "DCNA Score"},
    )

    if threshold is not None:
        fig.add_hline(
            y=threshold, line_dash="dash", line_color="red",
            annotation_text=f"Threshold: {threshold:.3f}",
        )

    return fig
