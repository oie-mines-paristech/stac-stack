from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

E2E_ROOT = Path(__file__).resolve().parent
if str(E2E_ROOT) not in sys.path:
    sys.path.insert(0, str(E2E_ROOT))

from fixtures.build_datasets import build_datasets

REPO_ROOT = Path(__file__).resolve().parents[2]
METADATA_TEMPLATE = E2E_ROOT / "fixtures" / "metadata"
ROOT_HREF = "http://test/"


def run_generate_stac(input_dir: Path, output_dir: Path) -> None:
    subprocess.run(
        [
            "uv",
            "run",
            "generate-stac",
            "--input",
            str(input_dir),
            "--output",
            str(output_dir),
            "--root-href",
            ROOT_HREF,
        ],
        check=True,
        cwd=REPO_ROOT,
    )


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def find_item_json(output_dir: Path, item_id: str) -> Path:
    matches = list(output_dir.rglob(f"{item_id}.json"))
    if not matches:
        raise FileNotFoundError(f"No STAC item JSON found for id={item_id!r} under {output_dir}")
    return matches[0]


@pytest.fixture
def stac_output(tmp_path: Path) -> tuple[Path, Path]:
    input_dir = tmp_path / "in"
    output_dir = tmp_path / "out"
    shutil.copytree(METADATA_TEMPLATE, input_dir)
    build_datasets(input_dir)
    run_generate_stac(input_dir, output_dir)
    return input_dir, output_dir
