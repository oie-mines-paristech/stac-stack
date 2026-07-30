from __future__ import annotations

from conftest import find_item_json, load_json


def test_zarr_matches_netcdf_mappings(stac_output):
    _input, output = stac_output
    item = load_json(find_item_json(output, "zarr-cube"))

    assert "https://stac-extensions.github.io/datacube/v2.2.0/schema.json" in item["stac_extensions"]
    band = item["assets"]["cube"]["bands"][0]
    assert band["name"] == "temperature"
    assert band["unit"] == "K"
    assert band["statistics"]["minimum"] == 250.0
    assert item["assets"]["cube"]["type"] == "application/vnd.zarr; version=3"
