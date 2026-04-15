"""Cross-MOA comparison visualizations."""

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

import visualization.theme  # noqa: F401


def plot_threshold_comparison(
    results: list[dict],
    title: str = "Threshold Performance by MOA Category",
) -> go.Figure:
    """Grouped bar chart comparing threshold performance across MOA categories.

    Args:
        results: List of dicts with keys: moa_category, sensitivity, specificity, auc.
    """
    df = pd.DataFrame(results)
    if df.empty:
        return go.Figure().add_annotation(text="No data", showarrow=False)

    fig = go.Figure()
    for metric in ["sensitivity", "specificity", "auc"]:
        if metric in df.columns:
            fig.add_trace(go.Bar(
                x=df["moa_category"], y=df[metric], name=metric.capitalize()
            ))

    fig.update_layout(
        title=title,
        barmode="group",
        xaxis_tickangle=-45,
        yaxis_title="Score",
        yaxis=dict(range=[0, 1.05]),
    )
    return fig


def plot_response_rate_comparison(
    results: list[dict],
    title: str = "Response Rates by MOA Category",
) -> go.Figure:
    """Bar chart comparing response rates across MOA categories.

    Args:
        results: List of dicts with keys: moa_category, response_rate, n_trials.
    """
    df = pd.DataFrame(results)
    if df.empty:
        return go.Figure().add_annotation(text="No data", showarrow=False)

    fig = px.bar(
        df, x="moa_category", y="response_rate",
        color="moa_category",
        title=title,
        labels={"response_rate": "Response Rate", "moa_category": "MOA Category"},
        text="n_trials",
    )
    fig.update_traces(texttemplate="n=%{text}", textposition="outside")
    fig.update_layout(xaxis_tickangle=-45, showlegend=False)
    return fig
