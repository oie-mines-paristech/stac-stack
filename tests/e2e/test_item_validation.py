from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from conftest import REPO_ROOT, ROOT_HREF, find_item_json, load_json
from fixtures.build_datasets import build_datasets

E2E_ROOT = Path(__file__).resolve().parent
METADATA_TEMPLATE = E2E_ROOT / "fixtures" / "metadata"


def test_zarr_without_suffix_is_catalogued(stac_output):
    _input, output = stac_output
    item = load_json(find_item_json(output, "zarr-nosuffix-cube_store"))

    assert "https://stac-extensions.github.io/zarr/v1.1.0/schema.json" in item["stac_extensions"]
    assert item["assets"]["cube_store"]["type"] == "application/vnd.zarr; version=3"
    band = item["assets"]["cube_store"]["bands"][0]
    assert band["name"] == "temperature"
    assert band["unit"] == "K"


def _run_generate_expect_failure(input_dir: Path, output_dir: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
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
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )


def test_missing_item_pattern_fails(tmp_path: Path):
    input_dir = tmp_path / "in"
    output_dir = tmp_path / "out"
    shutil.copytree(METADATA_TEMPLATE, input_dir)
    build_datasets(input_dir)

    metadata = input_dir / "zarr" / "metadata.yml"
    metadata.write_text(
        "id: test-zarr\n"
        "title: Zarr mapping tests\n"
        "description: Collection exercising Zarr to STAC mappings\n"
        "items:\n"
        "  - missing_dataset\n",
        encoding="utf-8",
    )

    result = _run_generate_expect_failure(input_dir, output_dir)
    assert result.returncode != 0
    assert "matched nothing" in result.stderr + result.stdout


def test_non_zarr_directory_item_fails(tmp_path: Path):
    input_dir = tmp_path / "in"
    output_dir = tmp_path / "out"
    shutil.copytree(METADATA_TEMPLATE, input_dir)
    build_datasets(input_dir)

    empty_dir = input_dir / "zarr" / "empty_dir"
    empty_dir.mkdir()

    metadata = input_dir / "zarr" / "metadata.yml"
    metadata.write_text(
        "id: test-zarr\n"
        "title: Zarr mapping tests\n"
        "description: Collection exercising Zarr to STAC mappings\n"
        "items:\n"
        "  - empty_dir\n",
        encoding="utf-8",
    )

    result = _run_generate_expect_failure(input_dir, output_dir)
    assert result.returncode != 0
    assert "cannot be opened as a Zarr store" in result.stderr + result.stdout
