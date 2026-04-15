"""GET /version — build provenance for the running backend.

Consumed by:
  - The frontend (fetched once on app load and cached in the VersionContext,
    displayed in the sidebar footer and stamped into client-side exports).
  - CI smoke tests to confirm the deployed container matches the expected SHA.
  - Users clicking the little version badge in the UI to copy the build ID
    onto a report / email when reporting bugs.

The payload is intentionally small and side-effect-free so it is safe to call
on every page load.
"""

from __future__ import annotations

import platform
import sys

from fastapi import APIRouter

from config.version import get_version_info

router = APIRouter(tags=["version"])


@router.get("/version")
def version() -> dict[str, str]:
    info = dict(get_version_info())
    # Runtime context — useful when debugging "why does this export look
    # different from yesterday's?" across machines.
    info["python_version"] = sys.version.split()[0]
    info["platform"] = f"{platform.system()}-{platform.release()}"
    return info
