from typing import (
    Any,
    Callable,
    Iterable,
    Optional,
    Sequence,
)

from stac_pydantic.collection import Collection
from stac_pydantic.item import Item


def _iter_strings(value: Any) -> Iterable[str]:
    """Yields every string contained in a (nested) value."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _iter_strings(item)
    elif isinstance(value, (list, tuple, set)):
        for item in value:
            yield from _iter_strings(item)


def _terms(q: Optional[Sequence[str]]) -> list[str]:
    # Basic free-text search: case-insensitive, comma-separated terms combined
    # with OR, spaces have no special meaning.
    return [term.strip().lower() for term in (q or []) if term and term.strip()]


def make_match_item_free_text(
    q: Optional[Sequence[str]] = None,
) -> Callable[[Item], bool]:
    terms = _terms(q)

    if not terms:
        def match(item: Item) -> bool:
            return True
    else:
        def match(item: Item) -> bool:
            # Relevant textual fields of an Item: its id, its collection id and
            # every textual property (title, description, keywords, ...).
            fields = {
                "id": item.id,
                "collection": item.collection,
                "properties": item.properties.model_dump(),
            }
            text = " ".join(_iter_strings(fields)).lower()

            return any(term in text for term in terms)

    return match


def make_match_collection_free_text(
    q: Optional[Sequence[str]] = None,
) -> Callable[[Collection], bool]:
    terms = _terms(q)

    if not terms:
        def match(collection: Collection) -> bool:
            return True
    else:
        def match(collection: Collection) -> bool:
            fields = {
                "id": collection.id,
                "title": collection.title,
                "description": collection.description,
                "keywords": collection.keywords,
            }
            text = " ".join(_iter_strings(fields)).lower()

            return any(term in text for term in terms)

    return match