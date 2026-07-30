from __future__ import annotations

from conftest import find_item_json, load_json


def test_netcdf_datacube_and_bands(stac_output):
    _input, output = stac_output
    item = load_json(find_item_json(output, "netcdf-cube"))

    assert "https://stac-extensions.github.io/datacube/v2.2.0/schema.json" in item["stac_extensions"]
    props = item["properties"]
    assert props["start_datetime"].startswith("2020-01-01")
    assert props["end_datetime"].startswith("2020-01-03")

    cube_vars = props["cube:variables"]["temperature"]
    assert cube_vars["unit"] == "K"
    assert cube_vars["description"] == "Air temperature"
    assert cube_vars["dimensions"] == ["time", "lat", "lon"]

    band = item["assets"]["cube"]["bands"][0]
    assert band["name"] == "temperature"
    assert band["unit"] == "K"
    assert band["description"] == "Air temperature"
    assert band["nodata"] == -999.0
    assert band["data_type"] == "float32"
    assert band["statistics"]["minimum"] == 250.0
    assert band["statistics"]["maximum"] == 310.0

    bbox = item["bbox"]
    assert bbox[0] == 2.0
    assert bbox[2] == 2.1
    assert bbox[1] == 48.0
    assert bbox[3] == 48.1

    assert item["assets"]["cube"]["href"] == "http://test/netcdf/cube.nc"
