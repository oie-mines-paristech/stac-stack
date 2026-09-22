
from stac_fastapi.static.core.lib.geometries_intersect import (
    bbox_intersect,
    to_2d_bbox,
)


def test_to_2d_bbox():
    assert to_2d_bbox((2, 2, 5, 5)) == (2, 2, 5, 5)
    # 3D: (west, south, minZ, east, north, maxZ) -> (west, south, east, north)
    assert to_2d_bbox((2, 2, 10, 5, 5, 20)) == (2, 2, 5, 5)


def test_bbox_intersect_3d():
    # The item bbox from the fisheye catalog is 3D; a 2D query bbox that
    # contains it must intersect it (regression for the missing search results).
    item_bbox = (7.0514, 43.6134, 176.0, 7.0539, 43.6152, 176.0)
    assert bbox_intersect((7.0, 43.5, 7.1, 43.7), item_bbox)
    assert bbox_intersect(item_bbox, (7.0, 43.5, 7.1, 43.7))
    assert not bbox_intersect((0.0, 0.0, 1.0, 1.0), item_bbox)


def test_bbox_intersect():

    ref_bbox = (2, 2, 5, 5)

    window = (
        (0, 1),
        (1, 3),
        (3, 4),
        (4, 6),
        (6, 7)
    )

    test_bboxes = set(
        (x[0], y[0], x[1], y[1])
        for x in window
        for y in window
    )

    expected_not_to_intersect = set(
        bbox
        for bbox in test_bboxes
        if bbox[0] == 0 or bbox[2] == 7 or bbox[1] == 0 or bbox[3] == 7
    )

    expected_to_intersect = test_bboxes - expected_not_to_intersect

    for bbox in expected_to_intersect:
        assert bbox_intersect(bbox, ref_bbox)

    for bbox in expected_not_to_intersect:
        assert not bbox_intersect(bbox, ref_bbox)
