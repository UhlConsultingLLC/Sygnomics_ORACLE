"""Visualization module — Plotly figure builders and export utilities.

Server-side figure construction for the API's ``/analysis/plots``
endpoint. ``theme`` defines the shared Plotly template (colors, fonts,
axes); ``summary_plots``, ``genomic_plots``, ``threshold_plots``, and
``comparison_plots`` produce JSON-serializable figures; ``export``
handles PNG/SVG rendering via Kaleido.
"""
