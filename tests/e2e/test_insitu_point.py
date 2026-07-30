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


def test_insitu_scalar_latlon_zarr_geometry(stac_output):
    _input, output = stac_output
    item = load_json(find_item_json(output, "insitu-scalar_latlon"))

    assert item["geometry"]["type"] == "Point"
    assert item["geometry"]["coordinates"] == [3.5, 45.5, 176.0]
    assert len(item["bbox"]) == 6
    assert item["bbox"][2] == 176.0
    assert item["bbox"][5] == 176.0
    assert item["bbox"][0] < 3.5
    assert item["bbox"][3] > 3.5
    assert item["bbox"][1] < 45.5
    assert item["bbox"][4] > 45.5

    props = item["properties"]
    assert "latitude" not in props.get("cube:variables", {})
    assert "longitude" not in props.get("cube:variables", {})
    assert "altitude" not in props.get("cube:variables", {})
    band_names = {b["name"] for b in item["assets"]["scalar_latlon"]["bands"]}
    assert "latitude" not in band_names
    assert "longitude" not in band_names
    assert "altitude" not in band_names
    assert band_names == {"value"}
