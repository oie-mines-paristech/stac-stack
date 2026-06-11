from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import pystac
from pystac.extensions import datacube as stac_datacube

from discovery import expand_patterns, find_thumbnail
from geo_metadata import datacube_metadata_from_asset, extent_from_asset, union_extents
from mime import guess_mime_type
from models import FolderMetadata, normalize_asset_entry
from yaml_io import read_yaml


# Pour les datasets in-situ (point unique), on élargit artificiellement la bbox
# afin d'améliorer l'affichage dans les viewers.
POINT_BBOX_BUFFER_METERS = 100.0


@dataclass(frozen=True)
class BuildContext:
    root_dir: Path
    out_dir: Path
    root_href: str

    def asset_href(self, rel_to_root: Path) -> str:
        base = self.root_href.rstrip("/") + "/"
        return base + rel_to_root.as_posix().lstrip("/")


def _default_id(rel_dir: Path) -> str:
    s = rel_dir.as_posix().strip("/")
    return s if s else "root"


def _default_title(rel_dir: Path, folder: Path) -> str:
    if rel_dir.as_posix().strip("/") == "":
        return folder.name or "root"
    return folder.name


def _bbox_to_geom(bbox: list[float]) -> dict[str, Any]:
    minx, miny, maxx, maxy = bbox
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [minx, miny],
                [minx, maxy],
                [maxx, maxy],
                [maxx, miny],
                [minx, miny],
            ]
        ],
    }


def _is_point_bbox(bbox: list[float]) -> bool:
    return bbox[0] == bbox[2] and bbox[1] == bbox[3]


def _expand_point_bbox(bbox: list[float], *, buffer_m: float) -> list[float]:
    """
    Convertit un point (lon,lat) en bbox élargie +/- buffer_m (approximation degrés).
    """
    lon = float(bbox[0])
    lat = float(bbox[1])
    # Approximations: 1 deg lat ~ 111_320 m ; 1 deg lon ~ 111_320 * cos(lat)
    meters_per_deg_lat = 111_320.0
    cos_lat = max(0.1, abs(__import__("math").cos(__import__("math").radians(lat))))
    meters_per_deg_lon = meters_per_deg_lat * cos_lat
    dlat = buffer_m / meters_per_deg_lat
    dlon = buffer_m / meters_per_deg_lon
    return [lon - dlon, lat - dlat, lon + dlon, lat + dlat]


def _stac_datetime_props(start: datetime | None, end: datetime | None) -> dict[str, Any]:
    props: dict[str, Any] = {}
    if start is None and end is None:
        return props
    if start is not None and end is not None and start == end:
        props["datetime"] = start
        return props
    if start is not None:
        props["start_datetime"] = start
    if end is not None:
        props["end_datetime"] = end
    return props


def load_folder_metadata(folder: Path) -> FolderMetadata:
    yml = folder / "metadata.yml"
    data = read_yaml(yml)
    return FolderMetadata.model_validate(data)


def build_tree(ctx: BuildContext, folder: Path) -> pystac.Catalog | pystac.Collection:
    folder = folder.resolve()
    rel_dir = folder.relative_to(ctx.root_dir.resolve())

    meta = load_folder_metadata(folder)
    stac_id = meta.id or _default_id(rel_dir)
    title = meta.title or _default_title(rel_dir, folder)
    description = meta.description or title

    if meta.kind() == "catalog":
        cat = pystac.Catalog(id=stac_id, description=description, title=title)
        _add_folder_assets(ctx, folder, rel_dir, cat)
        for child in expand_patterns(folder, ctx.root_dir, meta.children or []):
            if not child.path.is_dir():
                raise ValueError(f"`children` must point to directories: {child.path}")
            child_meta = child.path / "metadata.yml"
            if not child_meta.exists():
                raise ValueError(f"metadata.yml missing for child {child.path}")
            child_obj = build_tree(ctx, child.path)
            cat.add_child(child_obj)
        _set_self_href(ctx, rel_dir, cat, is_collection=False)
        return cat

    # Collection
    coll = pystac.Collection(
        id=stac_id,
        description=description,
        title=title,
        extent=pystac.Extent(
            spatial=pystac.SpatialExtent([[-180.0, -90.0, 180.0, 90.0]]),
            temporal=pystac.TemporalExtent([[None, None]]),
        ),
    )
    _add_folder_assets(ctx, folder, rel_dir, coll)

    item_extents = []
    for entry in expand_patterns(folder, ctx.root_dir, meta.items or []):
        if entry.path.is_dir() and not entry.path.name.lower().endswith(".zarr"):
            continue
        item = _build_item_for_asset(ctx, entry.path, entry.rel_to_root, rel_dir)
        coll.add_item(item)
        ex = extent_from_asset(entry.path)
        if ex is not None:
            item_extents.append(ex)

    u = union_extents(item_extents)
    if u is not None:
        coll.extent = pystac.Extent(
            spatial=pystac.SpatialExtent([[u.bbox_wgs84[0], u.bbox_wgs84[1], u.bbox_wgs84[2], u.bbox_wgs84[3]]]),
            temporal=pystac.TemporalExtent([[u.start_datetime, u.end_datetime]]),
        )

    _set_self_href(ctx, rel_dir, coll, is_collection=True)
    return coll


def _set_self_href(ctx: BuildContext, rel_dir: Path, obj: pystac.Catalog | pystac.Collection, *, is_collection: bool) -> None:
    out_folder = ctx.out_dir / rel_dir
    out_folder.mkdir(parents=True, exist_ok=True)
    filename = "collection.json" if is_collection else "catalog.json"
    obj.set_self_href(str(out_folder / filename))


def _add_folder_assets(ctx: BuildContext, folder: Path, rel_dir: Path, obj: pystac.Catalog | pystac.Collection) -> None:
    thumb = find_thumbnail(folder)
    if thumb is not None:
        rel = thumb.resolve().relative_to(ctx.root_dir.resolve())
        href = ctx.asset_href(rel)
        media_type = guess_mime_type(thumb)
        # STAC: les assets sont définis pour Collection/Item, pas pour Catalog.
        # Pour un Catalog, on ajoute un link "icon" (souvent compris par les viewers).
        if isinstance(obj, pystac.Collection):
            obj.add_asset(
                "thumbnail",
                pystac.Asset(
                    href=href,
                    media_type=media_type,
                    roles=["thumbnail"],
                    title="thumbnail",
                ),
            )
        else:
            obj.add_link(
                pystac.Link(
                    rel="icon",
                    target=href,
                    media_type=media_type,
                    title="thumbnail",
                )
            )

    meta = load_folder_metadata(folder)
    for entry in meta.assets:
        spec = normalize_asset_entry(entry)
        p = (folder / spec.file).resolve()
        if not p.exists():
            raise ValueError(f"Referenced asset not found: {p}")
        rel = p.relative_to(ctx.root_dir.resolve())
        obj.add_asset(
            spec.name or p.stem,
            pystac.Asset(
                href=ctx.asset_href(rel),
                media_type=spec.mime or guess_mime_type(p),
                roles=spec.roles,
                title=spec.name or p.name,
            ),
        )


def _item_id_from_rel(rel_to_root: Path) -> str:
    # Stable + readable, avoids simple collisions.
    parts = list(rel_to_root.parts)
    name = parts[-1]
    if name.lower().endswith(".zarr"):
        name = name[:-5]
    else:
        name = Path(name).stem
    if len(parts) > 1:
        return "-".join([*parts[:-1], name]).replace(" ", "_")
    return name.replace(" ", "_")


def _build_item_for_asset(ctx: BuildContext, asset_path: Path, rel_asset: Path, rel_collection_dir: Path) -> pystac.Item:
    ex = extent_from_asset(asset_path)
    bbox = ex.bbox_wgs84 if ex is not None else [-180.0, -90.0, 180.0, 90.0]
    geom: dict[str, Any]
    if _is_point_bbox(bbox):
        # In-situ: géométrie point + bbox élargie
        geom = {"type": "Point", "coordinates": [bbox[0], bbox[1]]}
        bbox = _expand_point_bbox(bbox, buffer_m=POINT_BBOX_BUFFER_METERS)
    else:
        geom = _bbox_to_geom(bbox)
    props: dict[str, Any] = {}
    start_dt: datetime | None = None
    end_dt: datetime | None = None
    dt: datetime | None = None

    if ex is not None:
        tprops = _stac_datetime_props(ex.start_datetime, ex.end_datetime)
        dt = tprops.get("datetime")
        start_dt = tprops.get("start_datetime")
        end_dt = tprops.get("end_datetime")

    if dt is None and start_dt is None and end_dt is None:
        # STAC Items require `datetime` OR (`start_datetime`/`end_datetime`).
        # When we cannot infer any temporal info, we set a sentinel value and
        # explicitly mark it as unknown.
        dt = datetime(1970, 1, 1)
        props["stac_generator:datetime_unknown"] = True

    item = pystac.Item(
        id=_item_id_from_rel(rel_asset),
        geometry=geom,
        bbox=bbox,
        datetime=dt,
        properties=props,
        start_datetime=start_dt,
        end_datetime=end_dt,
    )

    key = asset_path.stem if not (asset_path.is_dir() and asset_path.name.lower().endswith(".zarr")) else asset_path.name[:-5]
    asset = pystac.Asset(
        href=ctx.asset_href(rel_asset),
        media_type=guess_mime_type(asset_path),
        roles=["data"],
        title=asset_path.name,
    )
    # Nécessaire pour certaines extensions (EO) qui exigent un owner.
    asset.set_owner(item)

    # Datacube + EO extensions pour NetCDF/Zarr (dimensions + variables + unités).
    cube = datacube_metadata_from_asset(asset_path)
    if cube is not None:
        cube_dims, cube_vars = cube

        # Datacube via l'API pystac.extensions.datacube
        dc_ext = stac_datacube.DatacubeExtension.ext(item, add_if_missing=True)
        dc_ext.dimensions = {k: stac_datacube.Dimension.from_dict(v) for k, v in cube_dims.items()}
        dc_ext.variables = {k: stac_datacube.Variable.from_dict(v) for k, v in cube_vars.items()}

        # Bands (Common Metadata) sur l'asset.
        # `bands` remplace `eo:bands` (et `raster:bands`) : les champs EO restent possibles via des clés `eo:*` dans chaque Band Object.
        asset.extra_fields["bands"] = [
            {k: v for k, v in {"name": name, "description": spec.get("description"), "unit": spec.get("unit")}.items() if v is not None}
            for name, spec in cube_vars.items()
        ]

    item.add_asset(key, asset)

    # Self href in `<collection>/items/<id>.json`
    out_items_dir = ctx.out_dir / rel_collection_dir / "items"
    out_items_dir.mkdir(parents=True, exist_ok=True)
    item.set_self_href(str(out_items_dir / f"{item.id}.json"))
    return item


def save_catalog(root: pystac.Catalog | pystac.Collection, out_dir: Path) -> None:
    # We want relative links between STAC JSON files, while keeping asset hrefs (often absolute HTTP).
    root.save(catalog_type=pystac.CatalogType.RELATIVE_PUBLISHED)

