from __future__ import annotations

from conftest import find_item_json, load_json


def test_acdd_global_metadata(stac_output):
    _input, output = stac_output
    item = load_json(find_item_json(output, "acdd-fixture-001"))

    props = item["properties"]
    assert props["title"] == "ACDD fixture dataset"
    assert props["description"] == "Dataset with ACDD global metadata only"
    assert "test" in props["keywords"]
    assert props["license"] == "CC-BY-4.0"
    assert props["platform"] == "test-platform"
    assert props["instruments"] == ["test-sensor"]
    assert props["mission"] == "test-program"
    assert props["created"].startswith("2020-01-01")
    assert props["updated"].startswith("2020-06-01")

    providers = {p["name"]: p for p in props["providers"]}
    assert "Test Institution" in providers
    assert "Test Creator" in providers
    assert "Test Publisher" in providers

    assert item["bbox"] == [1.0, 47.0, 2.0, 48.0]
    assert props["start_datetime"].startswith("2019-01-01")
    assert props["end_datetime"].startswith("2019-12-31")

    rels = {link["rel"]: link["href"] for link in item["links"]}
    assert rels["describedby"] == "https://example.com/metadata"
    assert rels["cite-as"] == "https://example.com/paper"
