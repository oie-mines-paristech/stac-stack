from unittest.mock import MagicMock, PropertyMock

from stac_fastapi.static.api.requests import get_base_url


def test_get_base_url_from_root_path():
    request = MagicMock()
    request.app.state.router_prefix = ""
    type(request.app).root_path = PropertyMock(return_value="/stac/api/")
    assert get_base_url(request) == "/stac/api/"


def test_get_base_url_from_router_prefix():
    request = MagicMock()
    request.app.state.router_prefix = "api"
    type(request.app).root_path = PropertyMock(return_value="/api/")
    assert get_base_url(request) == "/api/"


def test_get_base_url_empty():
    request = MagicMock()
    request.app.state.router_prefix = ""
    type(request.app).root_path = PropertyMock(return_value="/")
    assert get_base_url(request) == "/"
