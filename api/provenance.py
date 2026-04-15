"""Helpers that stamp backend exports with build/runtime provenance.

Every machine-readable artifact the API emits (CSV, JSON, XLSX, …) should
carry enough metadata to trace it back to (a) the exact build that produced
it and (b) the API call that produced it. Importers can then answer
questions like "what commit generated this figure?" or "when was this
snapshot taken?" without having to hunt through logs.

Usage from a router:

    from api.provenance import (
        build_export_metadata,
        csv_header_lines,
        provenance_filename,
        wrap_json_export,
    )

    meta = build_export_metadata(endpoint="/export/csv/trials", params={"status": "RECRUITING"})
    body = csv_header_lines(meta) + df.to_csv(index=False)
    headers = {"Content-Disposition": f"attachment; filename={provenance_filename('trials', 'csv', meta)}"}
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from config.version import get_version_info


def _now_utc_iso() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def build_export_metadata(
    *,
    endpoint: str,
    params: dict[str, Any] | None = None,
    row_count: int | None = None,
) -> dict[str, Any]:
    """Return the canonical metadata block attached to every export."""
    info = get_version_info()
    meta: dict[str, Any] = {
        "app": info["name"],
        "app_version": info["version"],
        "git_sha": info["git_sha"],
        "build_id": info["build_id"],
        "build_time": info["build_time"],
        "exported_at": _now_utc_iso(),
        "endpoint": endpoint,
    }
    if params:
        meta["params"] = params
    if row_count is not None:
        meta["row_count"] = row_count
    return meta


def csv_header_lines(meta: dict[str, Any]) -> str:
    """Three-line ``# … `` header prepended to every CSV export.

    Designed so the resulting file is still valid CSV for importers that
    support comment rows (pandas ``read_csv(..., comment='#')`` etc.) and
    self-documenting for anyone opening it in a text editor.
    """
    short = (
        f"# {meta['app']} {meta['build_id']} · {meta['endpoint']} "
        f"· exported {meta['exported_at']}"
    )
    build = f"# built: {meta['build_time']}"
    # Params/row_count embedded as JSON on one line so the comment is parseable.
    import json as _json

    detail = _json.dumps(
        {k: v for k, v in meta.items() if k in {"params", "row_count"}},
        separators=(",", ":"),
        default=str,
    )
    ctx = f"# context: {detail}" if detail != "{}" else "# context: {}"
    return "\n".join([short, build, ctx]) + "\n"


def wrap_json_export(payload: Any, meta: dict[str, Any]) -> dict[str, Any]:
    """Wrap a JSON response body with a top-level ``metadata`` block.

    Keeping ``data`` nested means older consumers that expected a top-level
    array need to change, but every artifact is now self-describing which is
    the whole point. Breaking change is acceptable at the 1.0.0 boundary.
    """
    return {"metadata": meta, "data": payload}


def provenance_filename(base: str, ext: str, meta: dict[str, Any]) -> str:
    """Build a filename that includes the build ID and export timestamp.

    Example: ``trials_v1.0.0_d160ce3_20260415T1204Z.csv``

    Collisions are effectively impossible because the timestamp is per-second
    and two distinct exports rarely land in the same second from the same
    build.
    """
    sha = meta["git_sha"]
    version = meta["app_version"]
    # exported_at = 2026-04-15T12:04:27Z; collapse to 20260415T120427Z
    stamp = meta["exported_at"].replace("-", "").replace(":", "")
    return f"{base}_v{version}_{sha}_{stamp}.{ext.lstrip('.')}"
