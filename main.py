#!/usr/bin/env python
from __future__ import annotations
import argparse
from pathlib import Path
import sys

CURR_FOLDER = Path(__file__).resolve().parent

sys.path.append(str(CURR_FOLDER / "src"))

from stac_build import BuildContext, build_tree, save_catalog

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="generate-stac")
    p.add_argument("--input", required=True, help="Input root folder (must contain a metadata.yml)")
    p.add_argument("--output", required=True, help="Output folder (will be created if needed)")
    p.add_argument("--root-href", required=True, help='HTTP prefix for asset hrefs, e.g. "http://site.tld/path/"')
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    root_dir = Path(args.input).expanduser().resolve()
    out_dir = Path(args.output).expanduser().resolve()

    if not root_dir.exists() or not root_dir.is_dir():
        raise SystemExit(f"Invalid --input: {root_dir}")
    if not (root_dir / "metadata.yml").exists():
        raise SystemExit(f"metadata.yml not found at root: {root_dir / 'metadata.yml'}")

    out_dir.mkdir(parents=True, exist_ok=True)

    ctx = BuildContext(root_dir=root_dir, out_dir=out_dir, root_href=str(args.root_href))
    root = build_tree(ctx, root_dir)
    save_catalog(root, out_dir)


if __name__ == "__main__":
    main()

