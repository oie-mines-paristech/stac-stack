"""Request helpers (same-origin path-absolute API base URL)."""

from starlette.requests import Request


def _api_path_prefix(request: Request) -> str:
    app = request.app
    # router_prefix is often empty; root_path carries PATH_PREFIX/api/ from compose.
    return (getattr(app.state, "router_prefix", None) or app.root_path or "").strip("/")


def get_base_url(request: Request) -> str:
    """Path-absolute API base (e.g. /stac/api/).

    Avoids embedding http/https in STAC links. The browser resolves these paths
    against the current page origin, so TLS termination at a reverse proxy cannot
    produce mixed-content failures when X-Forwarded-Proto is missing or wrong.
    """
    prefix = _api_path_prefix(request)
    if prefix:
        return f"/{prefix}/"
    return "/"


def get_self_base_url(request: Request) -> str:
    """Absolute API base (e.g. https://host/stac/api/) for `rel: self` links.

    The STAC link schema only accepts absolute IRIs for `self`; every other link
    stays path-absolute (see `get_base_url`). Scheme and host come from the
    forwarded headers uvicorn honours, so TLS termination at a reverse proxy
    yields the public origin.
    """
    origin = f"{request.url.scheme}://{request.url.netloc}"
    prefix = _api_path_prefix(request)
    if prefix:
        return f"{origin}/{prefix}/"
    return f"{origin}/"
