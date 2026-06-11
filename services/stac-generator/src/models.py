from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AssetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str
    roles: list[str] = Field(default_factory=list)
    name: str | None = None
    mime: str | None = None


AssetEntry = Annotated[AssetSpec | str, Field(union_mode="left_to_right")]


class FolderMetadata(BaseModel):
    """
    `metadata.yml` schema (catalog or collection).

    - `children` => catalog
    - `items` => collection
    """

    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    title: str | None = None
    description: str | None = None

    assets: list[AssetEntry] = Field(default_factory=list)
    children: list[str] | None = None
    items: list[str] | None = None

    @model_validator(mode="after")
    def _validate_kind(self) -> "FolderMetadata":
        if self.children and self.items:
            raise ValueError("`metadata.yml`: `children` and `items` are mutually exclusive")
        if (not self.children) and (not self.items):
            raise ValueError("`metadata.yml`: you must define either `children` or `items`")
        return self

    def kind(self) -> Literal["catalog", "collection"]:
        return "catalog" if self.children is not None else "collection"


def normalize_asset_entry(entry: AssetEntry) -> AssetSpec:
    if isinstance(entry, str):
        stem = entry.rsplit("/", 1)[-1].split(".", 1)[0]
        return AssetSpec(file=entry, roles=[stem], name=stem)
    return entry

