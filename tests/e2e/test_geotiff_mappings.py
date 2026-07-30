from __future__ import annotations

from conftest import find_item_json, load_json


def test_geotiff_bands_and_datetime_unknown(stac_output):
    _input, output = stac_output
    rgb = load_json(find_item_json(output, "geotiff-rgb"))
    single = load_json(find_item_json(output, "geotiff-single"))

    assert rgb["properties"]["stac_generator:datetime_unknown"] is True
    assert rgb["geometry"]["type"] == "Polygon"

    bands = rgb["assets"]["rgb"]["bands"]
    assert len(bands) == 3
    assert bands[0]["name"] == "Red"
    assert bands[0]["description"] == "Red"
    assert bands[1]["name"] == "Green"
    assert bands[2]["name"] == "Blue"
    assert bands[0]["data_type"] == "uint8"

    single_bands = single["assets"]["single"]["bands"]
    assert len(single_bands) == 1
    assert single_bands[0]["description"] == "Surface temperature"
    assert single_bands[0]["name"] == "Surface_temperature"
    assert single_bands[0]["nodata"] == -1.0
    assert single_bands[0]["data_type"] == "float32"
    assert single_bands[0]["statistics"]["minimum"] == 1.0
    assert single_bands[0]["statistics"]["maximum"] == 4.0

    assert single["bbox"][0] == 5.0
    assert single["bbox"][2] == 5.2
