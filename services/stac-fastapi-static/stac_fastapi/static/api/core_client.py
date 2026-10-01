from typing import (
    List,
    Optional,
    Type,
    Callable,
    TypeVar,
    Any,
    cast,
    Dict
)

from os import path
from urllib.parse import urljoin, urlparse

import orjson
from orjson import JSONDecodeError

from fastapi import Request, HTTPException

from stac_pydantic.shared import MimeTypes
from stac_pydantic.item import Item
from stac_pydantic.collection import Collection
from stac_pydantic.catalog import Catalog
from stac_pydantic.item_collection import ItemCollection

from stac_fastapi.types import stac
from stac_fastapi.types.core import Relations, BaseCoreClient
from stac_fastapi.static.api.requests import get_base_url, get_self_base_url

from pydantic import BaseModel, ValidationError

from .config import Settings

from stac_fastapi.static.core import (
    WalkResult,
    BadStacObjectFilterError,
    BadWalkResultError,
)

from stac_fastapi.static.core.model.links import (
    set_self_href,
)

from stac_fastapi.static.core.requests import (
    Session,
    file_uri_to_file_path,
)


def _rewrite_catalog_file_href(
    href: str,
    *,
    catalog_dir: str,
    base_api_href: str,
    root_catalog_file: Optional[str] = None,
) -> str:
    # Only rewrite file:// paths inside the catalog directory.
    # Path-absolute asset URLs (/stac/data/...) and file:///stac/... (from a bad
    # urljoin) must be left unchanged.
    if not href.startswith("file://"):
        return href

    file_path = file_uri_to_file_path(href)
    rel = path.relpath(file_path, catalog_dir)
    if rel.startswith(".."):
        return href

    # The root catalog has no file URL: it is exposed as the API landing page,
    # so that navigation from a collection's parent link reaches the API root
    # (whose children are the API collections) instead of the raw catalog file.
    if root_catalog_file is not None and file_path == root_catalog_file:
        return base_api_href

    return urljoin(base_api_href, rel)

from stac_fastapi.static.core.client import (
    search_items as _search_items,
    search_collections as _search_collections,
    search_collection_items as _search_collection_items,
    get_collection as _get_collection,
    get_item as _get_item,
    CollectionNotFoundError
)

from .models import (
    SearchItems,
    SearchCollections,
    SearchCollectionItems
)

from .links import LinksBuilder


def wrap_error(type: Type[BaseException] | tuple[Type[BaseException]], status_code: int = 500):

    WrappedCallable = TypeVar("WrappedCallable", bound=Callable[..., Any])

    def wrap_error(func: WrappedCallable) -> WrappedCallable:
        def wrapped_func(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except type as error:
                raise HTTPException(status_code=status_code, detail=error) from error

        return cast(WrappedCallable, wrapped_func)

    return wrap_error


search_items = wrap_error(BadStacObjectFilterError, status_code=400)(_search_items)
search_collections = wrap_error(BadStacObjectFilterError, status_code=400)(_search_collections)
search_collection_items = wrap_error(BadStacObjectFilterError, status_code=400)(_search_collection_items)
get_collection = wrap_error(BadStacObjectFilterError, status_code=400)(_get_collection)
get_item = wrap_error(BadStacObjectFilterError, status_code=400)(_get_item)


def _canonical_api_href(
    link,
    object: Catalog | Collection | Item,
    base_api_href: str,
) -> Optional[str]:
    """Returns the canonical API URL for a navigation link, or None.

    The catalog is also served as plain files (StaticFiles), so links between
    STAC entities would otherwise point into the file tree (e.g.
    ``/api/<collection>/collection.json``). Those URLs expose the raw JSON
    without the API links (items link, queryables, …) and break navigation in
    stac-browser. Rewrite the navigation links to the API routes so that the
    browser always stays on the API endpoints.
    """
    rel = link.rel
    if rel == "root":
        return base_api_href
    if isinstance(object, Item) and rel in ("parent", "collection"):
        if object.collection:
            return urljoin(base_api_href, f"collections/{object.collection}")
    elif isinstance(object, Collection) and rel == "item":
        item_id = path.splitext(path.basename(urlparse(link.href).path))[0]
        if item_id:
            return urljoin(base_api_href, f"collections/{object.id}/items/{item_id}")
    return None


@wrap_error(BadWalkResultError, status_code=500)
def resolve(
    result: WalkResult,
    *,
    request: Request,
    catalog_is_file: bool = True,
    catalog_href: bool = True,
    pre_resolve: Optional[Callable[[Catalog | Collection | Item], None]] = None
) -> Catalog | Collection | Item:
    base_api_href = get_base_url(request)
    self_base_href = get_self_base_url(request)
    object: Catalog | Collection | Item = result.resolve()

    # if isinstance(object, Item):
    #     object.properties.walk_path = str(result.walk_path)

    if pre_resolve is not None:
        pre_resolve(object)

    if catalog_is_file:
        root_catalog_file = file_uri_to_file_path(catalog_href)
        catalog_dir = path.dirname(root_catalog_file)

        for link in object.links.link_iterator():
            link.href = _canonical_api_href(link, object, base_api_href) or _rewrite_catalog_file_href(
                link.href,
                catalog_dir=catalog_dir,
                base_api_href=base_api_href,
                root_catalog_file=root_catalog_file,
            )
            link.title = link.title if link.title is not None else link.rel.capitalize()

        if isinstance(object, (Item, Collection)) and object.assets is not None:
            for asset in object.assets.values():
                asset.href = _rewrite_catalog_file_href(
                    asset.href,
                    catalog_dir=catalog_dir,
                    base_api_href=base_api_href,
                    root_catalog_file=root_catalog_file,
                )

    # A published relative catalog (pystac RELATIVE_PUBLISHED) carries no `self`
    # link on items and non-root collections, and the file-tree href it would
    # carry is not an API route. Emit the canonical API self link instead: STAC
    # requires it on items, and stac-browser reads it to build the item URL —
    # without it the UI falls back to the base URL. `self` is the one link the
    # schema forces to be an absolute IRI, hence the origin-qualified base.
    if isinstance(object, Item):
        if object.collection:
            set_self_href(
                object,
                urljoin(self_base_href, f"collections/{object.collection}/items/{object.id}"),
            )
    elif isinstance(object, Collection):
        set_self_href(object, urljoin(self_base_href, f"collections/{object.id}"))

    return object


def add_collection_links(collection: Collection, request: Request) -> None:
    """Add the API links that stac-browser expects to a collection response.

    Mirrors a standard STAC API: without the `items` link, stac-browser only
    sees the individual `item` links and never loads the item list, so it can't
    show item footprints (e.g. point markers) on the collection map.
    """
    for link in (
        LinksBuilder()
        .build_queryables_link(request, collection_id=collection.id)
        .build_items_link(request, collection_id=collection.id)._links
    ):
        collection.links.append(link)


def _root_catalog_metadata(settings: Settings) -> Dict[str, str]:
    """Read title/description from the static root catalog.

    The landing page mirrors the catalog the generator produced from
    `metadata.yml`, so the browser UI follows the chain
    `metadata.yml -> catalog.json -> /api/`. Falls back to the Settings
    stubs when the file is unavailable or has no title/description.
    """
    href = getattr(settings, "catalog_href", "")
    if not isinstance(href, str) or not href.startswith("file://"):
        return {}
    try:
        with open(file_uri_to_file_path(href), "rb") as fh:
            catalog = orjson.loads(fh.read())
    except Exception:
        return {}
    return {
        key: catalog[key]
        for key in ("title", "description")
        if isinstance(catalog.get(key), str) and catalog.get(key)
    }


class CoreClient(BaseCoreClient):

    def landing_page(self, request: Request, **kwargs):
        """Landing page.

        Called with `GET /`.

        Returns:
            API landing page, serving as an entry point to the API.
        """
        settings: Settings = request.app.state.settings
        session: Session = request.app.state.session
        base_url = get_base_url(request)

        landing_page = self._landing_page(
            base_url=base_url,
            conformance_classes=self.conformance_classes(),
            extension_schemas=[],
        )

        landing_page["links"].extend([
            {
                "rel": Relations.queryables.value,
                "type": MimeTypes.jsonschema.value,
                "title": "Queryables",
                "href": urljoin(base_url, "queryables"),
            },
            {
                "rel": Relations.service_desc.value,
                "type": MimeTypes.openapi.value,
                "title": "OpenAPI service description",
                "href": str(request.url_for("openapi")),
            },
            {
                "rel": Relations.service_doc.value,
                "type": MimeTypes.html.value,
                "title": "OpenAPI service documentation",
                "href": str(request.url_for("swagger_ui_html")),
            }
        ])

        # `self` is the only link the STAC schema requires to be an absolute IRI.
        for link in landing_page["links"]:
            if link["rel"] == Relations.self.value:
                link["href"] = get_self_base_url(request)

        # Title/description come from the root catalog (metadata.yml), not from
        # hardcoded API stubs, so the browse UI mirrors the catalog metadata.
        landing_page.update(_root_catalog_metadata(settings))

        # Collections are exposed via the standard `data` link (/collections).
        # Do not also emit `child` links here: stac-browser loads both sources and
        # fails to deduplicate them when catalogUrl is a relative path like /api/.

        return landing_page

    def _search(
        self,
        request: Request,
        query: SearchItems
    ) -> stac.ItemCollection:
        settings: Settings = request.app.state.settings
        session: Session = request.app.state.session
        catalog_is_file: bool = request.app.state.catalog_is_file

        page = search_items(
            collections=query.collections,
            ids=query.ids,
            bbox=query.bbox,
            intersects=query.intersects,
            datetime=(query.start_date, query.end_date),
            walk_marker=query.walk_marker,
            limit=query.limit,
            filter=query.filter,
            q=query.q,
            settings=settings,
            session=session
        )

        return ItemCollection(
            type="FeatureCollection",
            features=[
                resolve(
                    walk_result,
                    request=request,
                    catalog_is_file=catalog_is_file,
                    catalog_href=settings.catalog_href
                )
                for walk_result
                in page.page
            ],
            links=LinksBuilder().build_self_link(
                request
            ).build_root_link(
                request
            ).build_pagination_links(request, page).links
        ).model_dump()

    def post_search(
        self,
        kwargs: SearchItems,
        request: Request,
        **_kwargs
    ) -> stac.ItemCollection:
        """Cross catalog search (POST).

        Called with `POST /search`.

        Args:
            search_request: search request parameters.

        Returns:
            ItemCollection containing items which match the search criteria.
        """

        return self._search(
            request=request,
            query=kwargs
        )

    def get_search(
        self,
        request: Request,
        **kwargs,
    ) -> stac.ItemCollection:
        """Cross catalog search (GET).

        Called with `GET /search`.

        Returns:
            ItemCollection containing items which match the search criteria.
        """

        try:
            query = SearchItems(
                filter=kwargs["filter_expr"],
                **{
                    "filter-lang": kwargs["filter_lang"]
                },
                token=kwargs["token"],
                collections=kwargs["collections"],
                ids=kwargs["ids"],
                bbox=kwargs["bbox"],
                intersects=orjson.loads(kwargs["intersects"]) if kwargs["intersects"] else None,
                datetime=kwargs["datetime"],
                limit=kwargs["limit"],
                q=kwargs.get("q"),
            )
        except (ValidationError, JSONDecodeError) as error:
            raise HTTPException(status_code=400, detail=error) from error

        return self._search(
            request=request,
            query=query
        )

    def get_item(self, request: Request, item_id: str, collection_id: str, **kwargs) -> stac.Item:
        """Get item by id.

        Called with `GET /collections/{collection_id}/items/{item_id}`.

        Args:
            item_id: Id of the item.
            collection_id: Id of the collection.

        Returns:
            Item.
        """
        settings: Settings = request.app.state.settings
        session: Session = request.app.state.session
        catalog_is_file: bool = request.app.state.catalog_is_file

        item_walk_result = get_item(
            item_id=item_id,
            collection_id=collection_id,
            settings=settings,
            session=session
        )

        if not item_walk_result:
            raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")
        else:
            return resolve(
                item_walk_result,
                request=request,
                catalog_is_file=catalog_is_file,
                catalog_href=settings.catalog_href
            ).model_dump()

    def all_collections(
        self,
        request: Request,
        **kwargs
    ) -> stac.Collections:
        """Get all available collections.

        Called with `GET /collections`.

        Returns:
            A list of collections.
        """
        settings: Settings = request.app.state.settings
        session: Session = request.app.state.session
        catalog_is_file: bool = request.app.state.catalog_is_file

        try:
            query = SearchCollections(
                filter=kwargs["filter_expr"],
                **{
                    "filter-lang": kwargs["filter_lang"]
                },
                token=kwargs["token"],
                bbox=kwargs["bbox"],
                datetime=kwargs["datetime"],
                limit=kwargs["limit"],
                q=kwargs.get("q"),
            )
        except (ValidationError, JSONDecodeError) as error:
            raise HTTPException(status_code=400, detail=error) from error

        page = search_collections(
            walk_marker=query.walk_marker,
            limit=query.limit,
            bbox=query.bbox,
            datetime=(query.start_date, query.end_date),
            filter=query.filter,
            q=query.q,
            session=session,
            settings=settings
        )

        return {
            "collections": [
                collection.model_dump()
                for collection
                in [
                    resolve(
                        walk_result,
                        request=request,
                        catalog_is_file=catalog_is_file,
                        catalog_href=settings.catalog_href,
                        pre_resolve=lambda collection: add_collection_links(collection, request)
                    )
                    for walk_result
                    in page.page
                ]
            ],
            "links": LinksBuilder().build_self_link(
                request
            ).build_root_link(
                request
            ).build_pagination_links(request, page).links
        }

    def get_collection(
        self,
        request: Request,
        collection_id: str,
        **kwargs
    ) -> stac.Collection:
        """Get collection by id.

        Called with `GET /collections/{collection_id}`.

        Args:
            collection_id: Id of the collection.

        Returns:
            Collection.
        """
        settings: Settings = request.app.state.settings
        session: Session = request.app.state.session
        catalog_is_file: bool = request.app.state.catalog_is_file

        collection_walk_result = get_collection(
            collection_id=collection_id,
            settings=settings,
            session=session
        )

        if not collection_walk_result:
            raise HTTPException(status_code=404, detail=f"Collection {collection_id} not found.")
        else:
            return resolve(
                collection_walk_result,
                request=request,
                catalog_is_file=catalog_is_file,
                catalog_href=settings.catalog_href,
                pre_resolve=lambda collection: add_collection_links(collection, request)
            ).model_dump()

    def item_collection(
        self,
        request: Request,
        **kwargs,
    ) -> stac.ItemCollection:
        """Get all items from a specific collection.

        Called with `GET /collections/{collection_id}/items`

        Args:
            collection_id: id of the collection.
            limit: number of items to return.
            token: pagination token.

        Returns:
            An ItemCollection.
        """
        settings: Settings = request.app.state.settings
        session: Session = request.app.state.session
        catalog_is_file: bool = request.app.state.catalog_is_file

        try:
            query = SearchCollectionItems(
                filter=kwargs["filter_expr"],
                **{
                    "filter-lang": kwargs["filter_lang"]
                },
                token=kwargs["token"],
                bbox=kwargs["bbox"],
                datetime=kwargs["datetime"],
                limit=kwargs["limit"],
                collection_id=kwargs["collection_id"],
                q=kwargs.get("q"),
            )
        except (ValidationError, JSONDecodeError) as error:
            raise HTTPException(status_code=400, detail=error) from error

        try:
            page = search_collection_items(
                collection_id=query.collection_id,
                bbox=query.bbox,
                intersects=None,
                datetime=query.datetime,
                limit=query.limit,
                walk_marker=query.walk_marker,
                filter=query.filter,
                q=query.q,
                session=session,
                settings=settings,
            )
        except CollectionNotFoundError as error:
            raise HTTPException(status_code=404, detail=f"Collection {query.collection_id} not found.") from error

        return ItemCollection(
            type="FeatureCollection",
            features=[
                resolve(
                    walk_result,
                    request=request,
                    catalog_is_file=catalog_is_file,
                    catalog_href=settings.catalog_href,
                )
                for walk_result
                in page.page
            ],
            links=LinksBuilder().build_self_link(
                request
            ).build_root_link(
                request
            ).build_pagination_links(request, page).links
        ).model_dump()
