from typing import (
    Optional,
    Sequence,
)

import logging

from stac_pydantic.item import Item
from stac_pydantic.collection import Collection
from stac_pydantic.catalog import Catalog

from .walk import (
    WalkResult,
)

from .model import (
    make_match_item_free_text,
    make_match_collection_free_text,
)


logger = logging.getLogger(__name__)


def make_filter_items_free_text(q: Optional[Sequence[str]] = None):

    match_free_text = make_match_item_free_text(q)

    def filter_items_free_text(walk_result: WalkResult) -> bool:
        if walk_result.type == Item:
            try:
                return match_free_text(walk_result.resolve())
            except Exception as error:
                logger.warning(f"Skipping walk_result (not branch) : {str(walk_result)} : {str(error)}", extra={
                    "error": error
                })

                return False
        else:
            return True

    return filter_items_free_text


def make_filter_collections_free_text(q: Optional[Sequence[str]] = None):

    match_free_text = make_match_collection_free_text(q)

    def filter_collections_free_text(walk_result: WalkResult) -> bool:
        if walk_result.type == (Collection, Catalog):
            walk_result.resolve()

        if walk_result.type == Collection:
            try:
                return match_free_text(walk_result.resolve())
            except Exception as error:
                logger.warning(f"Skipping walk_result : {str(walk_result)} : {str(error)}", extra={
                    "error": error
                })

                return False
        else:
            return True

    return filter_collections_free_text