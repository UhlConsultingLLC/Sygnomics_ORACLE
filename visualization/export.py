"""Export utilities for figures and data."""

from pathlib import Path

import pandas as pd
import plotly.graph_objects as go


def export_figure(
    fig: go.Figure,
    path: str | Path,
    formats: list[str] | None = None,
    width: int = 900,
    height: int = 600,
) -> list[Path]:
    """Export a Plotly figure to one or more file formats.

    Args:
        fig: Plotly Figure object.
        path: Base path without extension.
        formats: List of formats (e.g., ["png", "svg"]). Defaults to ["png", "svg"].
        width: Image width in pixels.
        height: Image height in pixels.

    Returns:
        List of paths to exported files.
    """
    if formats is None:
        formats = ["png", "svg"]

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    exported = []

    for fmt in formats:
        output_path = path.with_suffix(f".{fmt}")
        if fmt == "html":
            fig.write_html(str(output_path))
        elif fmt == "json":
            fig.write_json(str(output_path))
        else:
            fig.write_image(str(output_path), width=width, height=height, format=fmt)
        exported.append(output_path)

    return exported


def export_dataframe(
    df: pd.DataFrame,
    path: str | Path,
    fmt: str = "csv",
) -> Path:
    """Export a DataFrame to CSV or other format.

    Args:
        df: pandas DataFrame.
        path: Output file path.
        fmt: Format ("csv" or "tsv").

    Returns:
        Path to exported file.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    if fmt == "tsv":
        df.to_csv(path, sep="\t", index=False)
    else:
        df.to_csv(path, index=False)

    return path
