from stac_pydantic.collection import Collection
from stac_pydantic.item import Item

from stac_fastapi.static.core.model.free_text import (
    make_match_item_free_text,
    make_match_collection_free_text,
)


def _item() -> Item:
    return Item.model_validate({
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": "fisheye-ikarus",
        "collection": "fisheye",
        "geometry": {"type": "Point", "coordinates": [7.05, 43.61]},
        "bbox": [7.05, 43.61, 7.05, 43.61],
        "properties": {
            "datetime": "2024-08-13T06:00:00Z",
            "title": "All-sky camera raw sensor data",
            "keywords": ["all-sky camera", "Bayer", "HDR"],
        },
        "assets": {},
        "links": [],
    })


def _collection() -> Collection:
    return Collection.model_validate({
        "type": "Collection",
        "stac_version": "1.0.0",
        "id": "fisheye",
        "title": "Fisheye cameras",
        "description": "Solar irradiance data from fisheye cameras",
        "keywords": ["solar", "irradiance"],
        "license": "other",
        "extent": {
            "spatial": {"bbox": [[7.052667, 43.614339, 7.052667, 43.614339]]},
            "temporal": {"interval": [[None, None]]},
        },
        "links": [],
    })


def test_item_free_text():
    item = _item()

    # Empty query matches everything
    assert make_match_item_free_text(None)(item)
    assert make_match_item_free_text([])(item)

    # Matches id, title and keywords, case-insensitively
    assert make_match_item_free_text(["ikarus"])(item)
    assert make_match_item_free_text(["ALL-SKY"])(item)
    assert make_match_item_free_text(["bayer"])(item)

    # OR semantics: any term matches
    assert make_match_item_free_text(["bayer", "nonexistent"])(item)

    # No term present -> no match
    assert not make_match_item_free_text(["nonexistent"])(item)


def test_collection_free_text():
    collection = _collection()

    assert make_match_collection_free_text(["fisheye"])(collection)
    assert make_match_collection_free_text(["irradiance"])(collection)
    assert make_match_collection_free_text(["solar", "nonexistent"])(collection)
    assert not make_match_collection_free_text(["nonexistent"])(collection)