#!/usr/bin/env python3
"""Validate STAC API landing page links and /collections response."""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.parse
import urllib.request


def check_href(label: str, href: str, *, https_page: bool) -> None:
    parsed = urllib.parse.urlparse(href)

    if parsed.scheme == "http" and https_page:
        raise SystemExit(
            f"{label}: lien HTTP sur page HTTPS (mixed content): {href!r}"
        )

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
    if https_page and parsed.scheme != "https":
        raise SystemExit(f"{label}: schéma HTTPS attendu, obtenu {parsed.scheme}: {href!r}")


def resolve_url(href: str, fetch_origin: str) -> str:
    if href.startswith("/"):
        return fetch_origin.rstrip("/") + href
    return href


def fetch_json(url: str, *, https_page: bool) -> dict:
    if https_page and url.startswith("https://"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(url, context=ctx) as response:
            return json.loads(response.read().decode())
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read().decode())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-data", required=True)
    parser.add_argument("--fetch-origin", required=True, help="Origin used to resolve path-absolute hrefs")
    parser.add_argument("--https", action="store_true", help="Page is served over HTTPS")
    args = parser.parse_args()

    doc = json.loads(sys.stdin.read())

    for link in doc.get("links", []):
        check_href(f"link rel={link.get('rel')}", link["href"], https_page=args.https)

    data_links = [link["href"] for link in doc.get("links", []) if link.get("rel") == "data"]
    if not data_links:
        raise SystemExit("lien rel=data manquant")
    if data_links[0] != args.expected_data:
        raise SystemExit(
            f"rel=data attendu {args.expected_data!r}, obtenu {data_links[0]!r}"
        )

    collections_url = resolve_url(data_links[0], args.fetch_origin)
    collections = fetch_json(collections_url, https_page=args.https)
    if not isinstance(collections.get("collections"), list) or not collections["collections"]:
        raise SystemExit("GET /collections vide ou invalide")

    mode = "HTTPS" if args.https else "HTTP"
    print(f"OK: {len(collections['collections'])} collections ({mode})")


if __name__ == "__main__":
    main()
