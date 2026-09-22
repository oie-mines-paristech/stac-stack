from typing import (
    Sequence,
    Tuple
)

import shapely


def to_2d_bbox(bbox: Sequence[float]) -> Tuple[float, float, float, float]:
    """Normalize a STAC bounding box to 2D (west, south, east, north).

    STAC bounding boxes may be 3D with six values
    (west, south, minZ, east, north, maxZ); the vertical component is dropped
    so that 2D spatial filters can compare them.
    """
    if len(bbox) >= 6:
        return (bbox[0], bbox[1], bbox[3], bbox[4])
    return (bbox[0], bbox[1], bbox[2], bbox[3])


def bbox_intersect(a: Sequence[float], b: Sequence[float]) -> bool:
    a = to_2d_bbox(a)
    b = to_2d_bbox(b)
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def geometries_intersect(a: shapely.Geometry, b: shapely.Geometry) -> bool:
    return shapely.intersects(a, b)
