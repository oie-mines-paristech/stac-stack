#!/usr/bin/env python3
"""Rewrite the mirror header block of repo-owned READMEs (GitHub side).

The GitLab copies carry a "contribute via GitHub" block; the GitHub mirror must
say it is a clone of the GitLab repository instead. Both live between the same
markers, so the mirror script can swap the block without touching the rest of
each README.

READMEs under a subtree (see .subtrees.yml) are skipped: they belong to upstream
repositories and must not receive our header.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

START = "<!-- mirror-header:start -->"
END = "<!-- mirror-header:end -->"
BLOCK = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)

GITHUB_BLOCK = f"""{START}
> **Mirror repository.** This repository is a read-only clone of the main GitLab
> repository [oie/stac-oie](https://git.sophia.minesparis.psl.eu/oie/stac-oie).
> Its content is synchronized automatically from GitLab `main`.
{END}"""


def owned_readmes(root: Path) -> list[Path]:
    tracked = subprocess.check_output(
        ["git", "-C", str(root), "ls-files", "*README*"], text=True
    ).split()
    config = (root / ".subtrees.yml").read_text()
    subtrees = {
        match.group(1).rstrip("/")
        for match in re.finditer(r"^\s+path:\s*(\S+)", config, re.MULTILINE)
    }
    return [
        root / path
        for path in tracked
        if not any(path.startswith(subtree + "/") for subtree in subtrees)
    ]


def rewrite(text: str) -> tuple[str, bool]:
    if BLOCK.search(text):
        return BLOCK.sub(lambda _: GITHUB_BLOCK, text, count=1), True
    title, newline, rest = text.partition("\n")
    if title.startswith("# "):
        return f"{title}\n\n{GITHUB_BLOCK}\n{newline}{rest}", False
    return f"{GITHUB_BLOCK}\n\n{text}", False


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    for path in owned_readmes(root):
        text = path.read_text()
        new_text, had_block = rewrite(text)
        if not had_block:
            print(
                f"warning: no {START} block in {path.relative_to(root)}; "
                "add one to the GitLab copy too",
                file=sys.stderr,
            )
        if new_text != text:
            path.write_text(new_text)


if __name__ == "__main__":
    main()
