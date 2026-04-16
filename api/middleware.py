"""Request-scoped middleware for observability.

``RequestIDMiddleware`` generates a UUID for each incoming request, stores
it in a ``contextvars.ContextVar`` so any logger in the call stack can
include it, and echoes it back to the client in the ``X-Request-ID``
response header.

Usage in a router::

    import logging
    logger = logging.getLogger(__name__)
    # The request ID is automatically injected by the logging filter
    # installed in ``install_request_id_filter()``.
    logger.info("Processing trial %s", nct_id)
"""

from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# Module-level context var — readable from any async task in the same
# request scope without passing the value explicitly through the stack.
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

HEADER = "X-Request-ID"


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Assign a UUID to each request and expose it in the response headers."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Prefer a client-supplied ID (useful for end-to-end tracing through
        # a reverse proxy / load balancer); fall back to a fresh UUID.
        rid = request.headers.get(HEADER) or str(uuid.uuid4())
        token = request_id_var.set(rid)
        try:
            response = await call_next(request)
            response.headers[HEADER] = rid
            return response
        finally:
            request_id_var.reset(token)


class _RequestIDFilter(logging.Filter):
    """Inject ``%(request_id)s`` into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get("-")  # type: ignore[attr-defined]
        return True


def install_request_id_filter() -> None:
    """Attach the request-ID filter to the root logger so all downstream
    loggers inherit it automatically. Call once at app startup."""
    root = logging.getLogger()
    root.addFilter(_RequestIDFilter())
