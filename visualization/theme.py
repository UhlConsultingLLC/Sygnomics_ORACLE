"""Shared Plotly theme for consistent visualizations."""

import plotly.graph_objects as go
import plotly.io as pio

CT_PIPELINE_TEMPLATE = go.layout.Template(
    layout=go.Layout(
        font=dict(family="Arial, sans-serif", size=13, color="#333333"),
        title=dict(font=dict(size=18, color="#1a1a1a")),
        paper_bgcolor="white",
        plot_bgcolor="white",
        colorway=[
            "#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3",
            "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3",
        ],
        xaxis=dict(showgrid=True, gridcolor="#eeeeee", zeroline=False),
        yaxis=dict(showgrid=True, gridcolor="#eeeeee", zeroline=False),
        margin=dict(l=60, r=30, t=60, b=50),
    )
)

pio.templates["ct_pipeline"] = CT_PIPELINE_TEMPLATE
pio.templates.default = "ct_pipeline"


def get_color_palette(n: int = 8) -> list[str]:
    """Get the default color palette."""
    colors = [
        "#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3",
        "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3",
        "#1f78b4", "#33a02c", "#e31a1c", "#ff7f00",
    ]
    return colors[:n]
