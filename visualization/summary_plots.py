"""Summary visualizations for clinical trial analysis."""

import plotly.express as px
import plotly.graph_objects as go
import pandas as pd

from analysis.models import ConditionCount, MOADistribution, PhaseDistribution
import visualization.theme  # noqa: F401 - registers template


def plot_trials_per_condition(
    data: list[ConditionCount], top_n: int = 20
) -> go.Figure:
    """Horizontal bar chart of trial counts per condition."""
    df = pd.DataFrame([d.model_dump() for d in data[:top_n]])
    if df.empty:
        return go.Figure().add_annotation(text="No data", showarrow=False)

    df = df.sort_values("trial_count", ascending=True)

    # Truncate long condition names so labels fit in narrow containers
    max_label_chars = 28
    df["condition_label"] = df["condition"].apply(
        lambda s: s if len(s) <= max_label_chars else s[: max_label_chars - 1] + "…"
    )

    fig = px.bar(
        df, x="trial_count", y="condition_label", orientation="h",
        title="Trials per Condition",
        labels={"trial_count": "Number of Trials", "condition_label": ""},
    )
    # Add full condition name as hover text
    fig.update_traces(
        customdata=df["condition"].values,
        hovertemplate="%{customdata}<br>Trials: %{x}<extra></extra>",
    )
    fig.update_layout(
        height=max(400, len(df) * 25 + 100),
        margin=dict(r=20, t=30, b=40),
        yaxis=dict(automargin=True, tickfont=dict(size=11)),
    )
    return fig


def plot_moa_distribution(data: list[MOADistribution]) -> go.Figure:
    """Bar chart of interventions and trials per MOA category."""
    df = pd.DataFrame([d.model_dump() for d in data])
    if df.empty:
        return go.Figure().add_annotation(text="No data", showarrow=False)

    df = df.sort_values("trial_count", ascending=False)
    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=df["moa_category"], y=df["trial_count"],
        name="Trials", marker_color="#66c2a5",
    ))
    fig.add_trace(go.Bar(
        x=df["moa_category"], y=df["intervention_count"],
        name="Interventions", marker_color="#fc8d62",
    ))
    fig.update_layout(
        title="Distribution by Mechanism of Action",
        xaxis_title="MOA Category",
        yaxis_title="Count",
        barmode="group",
        xaxis_tickangle=-45,
        height=550,
        margin=dict(l=60, r=30, t=30),
        xaxis=dict(automargin=True),
    )
    return fig


def plot_phase_distribution(data: list[PhaseDistribution]) -> go.Figure:
    """Pie chart of trial phase distribution.

    Small wedges (< 7% of total) get labels placed outside with connector
    lines so they remain readable. Larger wedges keep labels inside.
    """
    df = pd.DataFrame([d.model_dump() for d in data])
    if df.empty:
        return go.Figure().add_annotation(text="No data", showarrow=False)

    total = df["trial_count"].sum()
    threshold = 0.07  # 7% — slices below this get outside labels

    text_positions = [
        "outside" if (count / total) < threshold else "inside"
        for count in df["trial_count"]
    ]

    # Slightly pull out small slices so connector lines are clearer
    pull_values = [
        0.05 if (count / total) < threshold else 0
        for count in df["trial_count"]
    ]

    fig = go.Figure(
        go.Pie(
            labels=df["phase"],
            values=df["trial_count"],
            textinfo="percent+label",
            textposition=text_positions,
            pull=pull_values,
            insidetextorientation="horizontal",
            textfont_size=12,
            automargin=True,
            marker=dict(
                colors=px.colors.qualitative.Pastel,
            ),
        )
    )
    fig.update_layout(
        height=500,
        margin=dict(l=40, r=40, t=40, b=10),
        showlegend=False,
        uniformtext_minsize=10,
        uniformtext_mode="hide",
    )
    return fig


def plot_enrollment_histogram(
    enrollments: list[int], bins: int = 30
) -> go.Figure:
    """Histogram of trial enrollment counts."""
    if not enrollments:
        return go.Figure().add_annotation(text="No data", showarrow=False)

    fig = px.histogram(
        x=enrollments, nbins=bins,
        title="Distribution of Trial Enrollment",
        labels={"x": "Enrollment Count", "y": "Number of Trials"},
    )
    return fig
