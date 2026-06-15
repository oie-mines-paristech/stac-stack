from typing import (
    Optional
)
from urllib.parse import urljoin, urlparse

import requests
from requests import HTTPError

import pydantic
import pydantic_core

from stac_pydantic.catalog import Catalog
from stac_pydantic.collection import Collection
from stac_pydantic.item import Item
from stac_pydantic.links import Link
from stac_pydantic.shared import MimeTypes

from .errors import (
    BadStacObjectError
)
from .model import (
    guess_id_from_href
)
from .requests import (
    Session,
    is_file_uri
)


def _href_needs_resolution(href: str) -> bool:
    """True only for hrefs relative to the fetched document (not path-absolute or absolute URLs)."""
    if not href:
        return False
    parsed = urlparse(href)
    if parsed.scheme or parsed.netloc:
        return False
    return not href.startswith("/")


class IdObject(pydantic.BaseModel):

    id: str = pydantic.Field(..., alias="id", min_length=1)


def fetch_id(href: str, *, session: requests.Session = Session(), assume_best_practice_layout: bool = False) -> str:
    if assume_best_practice_layout:
        id = guess_id_from_href(href)
        if id is not None:
            return id

    with session.get(href, stream=True) as response:
        response.raise_for_status()

        content = b""

        for content_chunk in response.iter_content():
            content += content_chunk
            try:
                result = IdObject.model_validate(
                    pydantic_core.from_json(content, allow_partial=True)
                )
            except pydantic.ValidationError as error:
                pass
            except ValueError as error:
                raise BadStacObjectError(f"Bad JSON : {href}", href=href) from error
            else:
                return result.id

        try:
            return IdObject.model_validate_json(content).id
        except pydantic.ValidationError as error:
            raise BadStacObjectError(f"Not a STAC object : {href}", href=href) from error


def fetch_walkable(href: str, *, session: requests.Session = Session(), assume_absolute_hrefs: bool = False) -> Collection | Catalog:
    response = session.get(href)
    response.raise_for_status()

    errors = []
    catalog: Collection | Catalog

    for Model in (Collection, Catalog):
        try:
            catalog = Model.model_validate_json(response.text)
            break
        except pydantic.ValidationError as error:
            errors.append(error)
    else:
        raise BadStacObjectError(
            f"Bad STAC Catalog : {href}",
            href=href
        ) from ExceptionGroup(
            "Not a STAC Catalog or Collection",
            errors
        )

    # Resolve relative links from the fetched URL, not from the document's self link.
    # A relative self href (e.g. ./catalog.json) would break urljoin and yield paths like
    # "cube/collection.json" that requests cannot fetch.
    base_href = href
    if not assume_absolute_hrefs:
        for link in catalog.links.link_iterator():
            if _href_needs_resolution(link.href):
                link.href = urljoin(base_href, link.href)

        if isinstance(catalog, (Item, Collection)) and catalog.assets is not None:
            for asset in catalog.assets.values():
                if _href_needs_resolution(asset.href):
                    asset.href = urljoin(base_href, asset.href)

    return catalog


def fetch_item(href: str, *, session: requests.Session = Session(), assume_absolute_hrefs: bool = False) -> Item:
    response = session.get(href)
    response.raise_for_status()

    try:
        item = Item.model_validate_json(response.text)
    except pydantic.ValidationError as error:
        raise BadStacObjectError(
            f"Bad STAC Item : {href}",
            href=href
        ) from error

    base_href = href
    if not assume_absolute_hrefs:
        for link in item.links.link_iterator():
            if _href_needs_resolution(link.href):
                link.href = urljoin(base_href, link.href)

        if item.assets is not None:
            for asset in item.assets.values():
                if _href_needs_resolution(asset.href):
                    asset.href = urljoin(base_href, asset.href)

    return item
