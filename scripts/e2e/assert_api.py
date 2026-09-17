#!/usr/bin/env python3
"""Validate STAC API landing page links and /collections response."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request


def check_href(label: str, href: str) -> None:
    parsed = urllib.parse.urlparse(href)

    if href.startswith("/"):
        if "," in href:
            raise SystemExit(f"{label}: chemin invalide: {href!r}")
        return

    if not parsed.scheme or not parsed.netloc:
        raise SystemExit(f"{label}: URL invalide: {href!r}")
    if "," in parsed.netloc:
        raise SystemExit(f"{label}: hôte avec virgule: {href!r}")
    host = parsed.netloc.rsplit(":", 1)[0]
    if ":" in host:
        raise SystemExit(f"{label}: double port dans l'hôte: {href!r}")


def resolve_url(href: str, fetch_origin: str) -> str:
    if href.startswith("/"):
        return fetch_origin.rstrip("/") + href
    return href


def fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read().decode())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-data", required=True)
    parser.add_argument("--fetch-origin", required=True, help="Origin used to resolve path-absolute hrefs")
    args = parser.parse_args()

    doc = json.loads(sys.stdin.read())

    for link in doc.get("links", []):
        check_href(f"link rel={link.get('rel')}", link["href"])

    data_links = [link["href"] for link in doc.get("links", []) if link.get("rel") == "data"]
    if not data_links:
        raise SystemExit("lien rel=data manquant")
    if data_links[0] != args.expected_data:
        raise SystemExit(
            f"rel=data attendu {args.expected_data!r}, obtenu {data_links[0]!r}"
        )

    collections_url = resolve_url(data_links[0], args.fetch_origin)
    collections = fetch_json(collections_url)
    if not isinstance(collections.get("collections"), list) or not collections["collections"]:
        raise SystemExit("GET /collections vide ou invalide")

    print(f"OK: {len(collections['collections'])} collections")


if __name__ == "__main__":
    main()