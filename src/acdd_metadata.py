from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import pystac


def _split_csv_list(value: Any) -> list[str]:
    if value is None:
        return []
    text = str(value).strip()
    if not text:
        return []
    parts: list[str] = []
    current: list[str] = []
    in_quotes = False
    for ch in text:
        if ch == '"':
            in_quotes = not in_quotes
            continue
        if ch == "," and not in_quotes:
            part = "".join(current).strip()
            if part:
                parts.append(part)
            current = []
            continue
        current.append(ch)
    tail = "".join(current).strip()
    if tail:
        parts.append(tail)
    return parts


def _parse_iso_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[: len(fmt.replace("%", "0"))], fmt)
        except ValueError:
            continue
    return None


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def bbox_from_acdd_attrs(attrs: dict[str, Any]) -> list[float] | None:
    lat_min = _as_float(attrs.get("geospatial_lat_min"))
    lat_max = _as_float(attrs.get("geospatial_lat_max"))
    lon_min = _as_float(attrs.get("geospatial_lon_min"))
    lon_max = _as_float(attrs.get("geospatial_lon_max"))
    if None in {lat_min, lat_max, lon_min, lon_max}:
        return None
    minx, maxx = (lon_min, lon_max) if lon_min <= lon_max else (lon_max, lon_min)
    miny, maxy = (lat_min, lat_max) if lat_min <= lat_max else (lat_max, lat_min)
    return [minx, miny, maxx, maxy]


def datetime_range_from_acdd_attrs(attrs: dict[str, Any]) -> tuple[datetime | None, datetime | None]:
    start = _parse_iso_datetime(attrs.get("time_coverage_start"))
    end = _parse_iso_datetime(attrs.get("time_coverage_end"))
    return start, end


def _normalize_license(value: Any) -> str:
    text = str(value).strip()
    if not text:
        return "other"
    lower = text.lower()
    if lower in {"freely distributed", "none", "public domain"}:
        return "other"
    if re.match(r"^[A-Za-z0-9.+\\-]+$", text) and "-" in text:
        return text
    if text.startswith("http://") or text.startswith("https://"):
        return "other"
    return text if len(text) <= 64 and " " not in text else "other"


def _provider(name: Any, *, roles: list[str], url: Any | None = None, description: Any | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {"name": str(name).strip(), "roles": roles}
    if url is not None and str(url).strip():
        entry["url"] = str(url).strip()
    if description is not None and str(description).strip():
        entry["description"] = str(description).strip()
    return entry


def item_properties_from_acdd_attrs(attrs: dict[str, Any]) -> dict[str, Any]:
    props: dict[str, Any] = {}

    if title := attrs.get("title"):
        props["title"] = str(title)
    if summary := attrs.get("summary"):
        props["description"] = str(summary)
    if keywords := attrs.get("keywords"):
        props["keywords"] = _split_csv_list(keywords)
    if license_val := attrs.get("license"):
        props["license"] = _normalize_license(license_val)
    if platform := attrs.get("platform"):
        parts = _split_csv_list(platform)
        if parts:
            props["platform"] = parts[0]
    if instrument := attrs.get("instrument"):
        props["instruments"] = _split_csv_list(instrument)
    if program := attrs.get("program"):
        props["mission"] = str(program).split(",")[0].strip()
    if created := _parse_iso_datetime(attrs.get("date_created")):
        props["created"] = created.isoformat().replace("+00:00", "Z")
    if updated := _parse_iso_datetime(attrs.get("date_modified")):
        props["updated"] = updated.isoformat().replace("+00:00", "Z")

    providers: list[dict[str, Any]] = []
    if institution := attrs.get("institution"):
        providers.append(_provider(institution, roles=["producer"]))
    if creator := attrs.get("creator_name"):
        providers.append(
            _provider(
                creator,
                roles=["producer"],
                url=attrs.get("creator_url"),
                description=attrs.get("creator_email"),
            )
        )
    if publisher := attrs.get("publisher_name"):
        providers.append(
            _provider(
                publisher,
                roles=["host"],
                url=attrs.get("publisher_url"),
                description=attrs.get("publisher_email"),
            )
        )
    if providers:
        props["providers"] = providers

    extra_desc: list[str] = []
    for key in ("source", "comment", "acknowledgement", "project"):
        if val := attrs.get(key):
            extra_desc.append(f"{key}: {val}")
    if extra_desc:
        base = props.get("description", "")
        suffix = "\n\n".join(extra_desc)
        props["description"] = f"{base}\n\n{suffix}".strip() if base else suffix

    return props


def item_links_from_acdd_attrs(attrs: dict[str, Any]) -> list[pystac.Link]:
    links: list[pystac.Link] = []
    if metadata_link := attrs.get("metadata_link"):
        target = str(metadata_link).strip()
        if target:
            links.append(pystac.Link(rel="describedby", target=target, media_type="text/html"))
    if references := attrs.get("references"):
        for ref in _split_csv_list(references):
            if ref.startswith("http://") or ref.startswith("https://"):
                links.append(pystac.Link(rel="cite-as", target=ref))
    license_val = attrs.get("license")
    if license_val and str(license_val).strip().startswith("http"):
        links.append(pystac.Link(rel="license", target=str(license_val).strip()))
    return links


def item_id_from_acdd_attrs(attrs: dict[str, Any]) -> str | None:
    raw = attrs.get("id")
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or " " in text:
        return None
    authority = str(attrs.get("naming_authority", "")).strip()
    if authority and not text.startswith(authority):
        return f"{authority}-{text}".replace("/", "-")
    return text


def geotiff_properties_from_tags(tags: dict[str, str]) -> dict[str, Any]:
    props: dict[str, Any] = {}
    for key in ("TIFFTAG_IMAGEDESCRIPTION", "IMAGE_DESCRIPTION"):
        if desc := tags.get(key):
            props["description"] = str(desc)
            break
    return props
