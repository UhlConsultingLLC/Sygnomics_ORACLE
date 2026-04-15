"""Threshold analysis visualizations: ROC curves, Bland-Altman, calibration."""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from sklearn.metrics import auc, roc_curve

import visualization.theme  # noqa: F401


def plot_roc_curve(
    labels: np.ndarray,
    scores: np.ndarray,
    threshold: float | None = None,
    title: str = "ROC Curve",
) -> go.Figure:
    """Plot ROC curve with optional Youden's J threshold marker."""
    fpr, tpr, thresholds = roc_curve(labels, scores)
    roc_auc = auc(fpr, tpr)

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=fpr, y=tpr, mode="lines",
        name=f"ROC (AUC = {roc_auc:.3f})",
        line=dict(color="#66c2a5", width=2),
    ))
    fig.add_trace(go.Scatter(
        x=[0, 1], y=[0, 1], mode="lines",
        name="Random",
        line=dict(color="gray", dash="dash"),
    ))

    if threshold is not None:
        # Find the point on ROC curve closest to threshold
        idx = np.argmin(np.abs(thresholds - threshold))
        fig.add_trace(go.Scatter(
            x=[fpr[idx]], y=[tpr[idx]], mode="markers",
            name=f"Threshold = {threshold:.3f}",
            marker=dict(size=12, color="red", symbol="star"),
        ))

    fig.update_layout(
        title=title,
        xaxis_title="False Positive Rate",
        yaxis_title="True Positive Rate",
        xaxis=dict(range=[0, 1]),
        yaxis=dict(range=[0, 1.05]),
    )
    return fig


def plot_bland_altman(
    points_df: pd.DataFrame,
    mean_diff: float,
    upper_limit: float,
    lower_limit: float,
    title: str = "Bland-Altman Plot",
) -> go.Figure:
    """Bland-Altman plot of method agreement."""
    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=points_df["mean"], y=points_df["diff"],
        mode="markers",
        name="Observations",
        marker=dict(color="#66c2a5", size=6),
    ))

    # Mean difference line
    fig.add_hline(y=mean_diff, line_color="blue", line_dash="solid",
                  annotation_text=f"Mean: {mean_diff:.3f}")

    # Limits of agreement
    fig.add_hline(y=upper_limit, line_color="red", line_dash="dash",
                  annotation_text=f"+1.96 SD: {upper_limit:.3f}")
    fig.add_hline(y=lower_limit, line_color="red", line_dash="dash",
                  annotation_text=f"-1.96 SD: {lower_limit:.3f}")

    fig.update_layout(
        title=title,
        xaxis_title="Mean of Two Methods",
        yaxis_title="Difference (A - B)",
    )
    return fig


def plot_confusion_matrix(
    actuals: np.ndarray,
    predictions: np.ndarray,
    title: str = "Confusion Matrix",
) -> go.Figure:
    """Confusion matrix heatmap."""
    from sklearn.metrics import confusion_matrix
    cm = confusion_matrix(actuals, predictions, labels=[0, 1])

    fig = go.Figure(data=go.Heatmap(
        z=cm,
        x=["Predicted Negative", "Predicted Positive"],
        y=["Actual Negative", "Actual Positive"],
        colorscale="Blues",
        text=cm,
        texttemplate="%{text}",
        showscale=False,
    ))
    fig.update_layout(title=title, height=400, width=500)
    return fig
