"""Runtime build identity for ORACLE.

Every file, figure, and data export the application emits should be stamped
with the `build_id` returned by :func:`get_version_info` so a user can trace
any artifact back to the exact commit that produced it.

Resolution order for the git SHA (first hit wins):

1. ``config/_build_info.py`` — written at ``pip install`` / ``pip install -e``
   time by :func:`setup._write_build_info` and never committed (``.gitignore``).
   This is the authoritative source for installed / packaged distributions
   where the ``.git`` directory is unavailable.
2. ``git rev-parse HEAD`` against the repo root — used during local dev when
   working directly off the source tree.
3. The literal string ``"unknown"`` — a dev environment without git AND
   without ``_build_info.py`` (should not happen in a normal install).

The version string in :data:`APP_VERSION` is kept in sync manually with
``pyproject.toml`` and ``frontend/package.json`` on every release.
"""

from __future__ import annotations

import subprocess
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

APP_NAME = "ORACLE"
APP_VERSION = "1.0.0"

_REPO_ROOT = Path(__file__).resolve().parent.parent
_BUILD_INFO = Path(__file__).parent / "_build_info.py"


def _read_baked_info() -> dict[str, str]:
    """Load values written by setup.py at install time. Empty dict on failure."""
    if not _BUILD_INFO.exists():
        return {}
    try:
        ns: dict[str, object] = {}
        exec(_BUILD_INFO.read_text(encoding="utf-8"), ns)  # noqa: S102 — trusted file
        return {
            k: str(v)
            for k, v in ns.items()
            if k in {"BUILD_SHA", "BUILD_TIME"} and v is not None
        }
    except Exception:
        return {}


def _resolve_git_sha_from_repo() -> str | None:
    """Run git against the repo root; return short SHA or None on failure."""
    git_dir = _REPO_ROOT / ".git"
    if not git_dir.exists():
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(_REPO_ROOT), "rev-parse", "--short=7", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            sha = result.stdout.strip()
            return sha or None
    except Exception:
        pass
    return None


@lru_cache(maxsize=1)
def get_git_sha() -> str:
    """Return the 7-char git SHA identifying the build. Never raises."""
    baked = _read_baked_info().get("BUILD_SHA")
    if baked:
        return baked[:7]
    live = _resolve_git_sha_from_repo()
    if live:
        return live
    return "unknown"


@lru_cache(maxsize=1)
def get_build_time() -> str:
    """Return the build time as an ISO-8601 string in UTC, e.g. 2026-04-15T12:04:27Z.

    If ``_build_info.py`` was written at install time, that value wins; otherwise
    the process start time is used so dev runs still have a plausible stamp.
    """
    baked = _read_baked_info().get("BUILD_TIME")
    if baked:
        return baked
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def get_build_id() -> str:
    """Canonical stamp: ``<version>+<sha>`` (e.g. ``1.0.0+d160ce3``)."""
    return f"{APP_VERSION}+{get_git_sha()}"


def get_version_info() -> dict[str, str]:
    """Full provenance dict — used by the ``/version`` endpoint and stamped
    into every machine-readable export the app emits."""
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "git_sha": get_git_sha(),
        "build_time": get_build_time(),
        "build_id": get_build_id(),
    }
