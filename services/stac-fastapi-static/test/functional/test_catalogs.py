from urllib.parse import urljoin

import requests


def test_landing_child_links_use_api_routes(api_base_href: str):
    response = requests.get(api_base_href)
    response.raise_for_status()

    children = {
        link["title"]: link["href"]
        for link in response.json()["links"]
        if link.get("rel") == "child"
    }

    # Collection children -> /collections/{id} (the raw file has no `items`
    # link, so its map would show no item markers).
    assert children["Fisheye cameras"].endswith("/collections/fisheye")
    assert children["Land surface temperature"].endswith("/collections/cube")
    assert children["GeoTIFF samples"].endswith("/collections/tiffs")
    # The sub-catalog -> /catalogs/{path}.
    assert children["In situ irradiance datasets"].endswith("/catalogs/in-situ")


def test_catalog_document_rewrites_links_to_api_routes(api_base_href: str):
    response = requests.get(urljoin(api_base_href, "catalogs/in-situ"))
    response.raise_for_status()
    document = response.json()

    assert document["type"] == "Catalog"
    assert document["id"] == "in-situ"

    child_hrefs = [
        link["href"]
        for link in document["links"]
        if link.get("rel") == "child"
    ]
    assert len(child_hrefs) >= 18
    for href in child_hrefs:
        assert "/collections/" in href, href
        assert not href.endswith(".json"), href

    # A rewritten child resolves to a live collection route.
    requests.get(urljoin(api_base_href, child_hrefs[0])).raise_for_status()

    # root/parent navigate back to the landing page (the API root), not to
    # the raw root catalog file.
    for rel in ("root", "parent"):
        link = next(link for link in document["links"] if link["rel"] == rel)
        assert link["href"] in ("/", api_base_href, api_base_href.rstrip("/") + "/")


def test_catalog_unknown_and_traversal_paths_404(api_base_href: str):
    for path in (
        "catalogs/does-not-exist",
        "catalogs/%2e%2e%2fdoes-not-exist",
    ):
        assert requests.get(urljoin(api_base_href, path)).status_code == 404, path
