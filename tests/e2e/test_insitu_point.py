from __future__ import annotations

from conftest import find_item_json, load_json


def test_insitu_point_geometry(stac_output):
    _input, output = stac_output
    item = load_json(find_item_json(output, "insitu-point"))

    assert item["geometry"]["type"] == "Point"
    assert item["geometry"]["coordinates"] == [3.0, 45.0]
    assert item["bbox"][0] < 3.0
    assert item["bbox"][2] > 3.0
    assert item["bbox"][1] < 45.0
    assert item["bbox"][3] > 45.0
