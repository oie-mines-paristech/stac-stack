#!/usr/bin/env python
from __future__ import annotations
import argparse
import errno
import json
import os
import shutil
import tempfile
import traceback
from pathlib import Path
import sys
import threading
import time

CURR_FOLDER = Path(__file__).resolve().parent

sys.path.append(str(CURR_FOLDER / "src"))

from stac_build import BuildContext, build_tree, save_catalog


def _write_status(out_dir: Path, content: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "status.log").write_text(content, encoding="utf-8")


def _generate(*, root_dir: Path, out_dir: Path, root_href: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    ctx = BuildContext(root_dir=root_dir, out_dir=out_dir, root_href=root_href)
    root = build_tree(ctx, root_dir)
    save_catalog(root, out_dir)


def _publish_into_mount(*, src: Path, dst: Path) -> None:
    """Publie le contenu de `src` dans `dst` quand `dst` est un point de montage."""
    dst.mkdir(parents=True, exist_ok=True)
    src_names = {entry.name for entry in src.iterdir()}
    for entry in src.iterdir():
        dest = dst / entry.name
        if entry.is_dir() and dest.exists():
            shutil.rmtree(dest)
        os.replace(str(entry), str(dest))
    for entry in dst.iterdir():
        if entry.name == src.name:
            continue
        if entry.name not in src_names:
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()


def _make_tmp_dir(*, out_dir: Path, parent: Path) -> Path:
    """Crée un répertoire temporaire sur le même filesystem que `out_dir` si possible."""
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        tmp_dir = Path(tempfile.mkdtemp(prefix=f".{out_dir.name}.tmp-", dir=str(parent)))
        if os.stat(tmp_dir).st_dev == os.stat(out_dir).st_dev:
            return tmp_dir
        shutil.rmtree(tmp_dir)
    except OSError:
        pass
    return Path(tempfile.mkdtemp(prefix=f".{out_dir.name}.tmp-", dir=str(out_dir)))


def _try_atomic_publish(*, tmp_dir: Path, out_dir: Path, parent: Path) -> None:
    if tmp_dir.parent == out_dir:
        _publish_into_mount(src=tmp_dir, dst=out_dir)
        return

    backup_dir = None
    try:
        if out_dir.exists():
            backup_dir = Path(
                tempfile.mkdtemp(prefix=f".{out_dir.name}.bak-", dir=str(parent))
            )
            shutil.rmtree(backup_dir)
            os.replace(str(out_dir), str(backup_dir))
        os.replace(str(tmp_dir), str(out_dir))
    except OSError as exc:
        if exc.errno != errno.EBUSY:
            raise
        _publish_into_mount(src=tmp_dir, dst=out_dir)
    finally:
        if backup_dir is not None:
            shutil.rmtree(backup_dir, ignore_errors=True)


def _atomic_generate_to_output(*, root_dir: Path, out_dir: Path, root_href: str) -> None:
    """
    Génère dans un répertoire temporaire puis remplace `out_dir` uniquement en cas de succès.
    Si une génération échoue, on conserve la sortie précédente et on écrit `status.log` dans `out_dir`.
    """
    parent = out_dir.parent
    parent.mkdir(parents=True, exist_ok=True)

    tmp_dir = _make_tmp_dir(out_dir=out_dir, parent=parent)
    status_path = out_dir / "status.log"

    def _rewrite_local_links_to_relative(*, folder_root: Path) -> None:
        """
        Convertit les liens STAC `links[].href` qui pointent vers un chemin local absolu
        sous `folder_root` en hrefs relatifs (./..., ../...).
        Les hrefs d'assets (ex: root-href HTTP) ne sont pas modifiés.
        """
        root_str = str(folder_root.resolve())

        for json_path in folder_root.rglob("*.json"):
            try:
                data = json.loads(json_path.read_text(encoding="utf-8"))
            except Exception:
                continue

            changed = False
            links = data.get("links")
            if isinstance(links, list):
                for link in links:
                    if not isinstance(link, dict):
                        continue
                    href = link.get("href")
                    if not isinstance(href, str):
                        continue
                    # Ne toucher que les chemins locaux pointant dans le dossier de sortie.
                    if not href.startswith(root_str):
                        continue
                    try:
                        target = Path(href)
                        rel = os.path.relpath(str(target), start=str(json_path.parent))
                        rel = rel.replace(os.sep, "/")
                        if not rel.startswith("."):
                            rel = "./" + rel
                        link["href"] = rel
                        changed = True
                    except Exception:
                        continue

            if changed:
                json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    start = time.perf_counter()
    try:
        if not root_dir.exists() or not root_dir.is_dir():
            raise FileNotFoundError(f"Invalid --input: {root_dir}")
        if not (root_dir / "metadata.yml").exists():
            raise FileNotFoundError(f"metadata.yml not found at root: {root_dir / 'metadata.yml'}")

        _generate(root_dir=root_dir, out_dir=tmp_dir, root_href=root_href)
        _write_status(tmp_dir, "OK\n")

        # Important: ne jamais publier de chemins locaux. On réécrit les liens `self`/`root`/`parent`
        # absolus (souvent écrits par pystac via self_href) en liens relatifs.
        _rewrite_local_links_to_relative(folder_root=tmp_dir)

        _try_atomic_publish(tmp_dir=tmp_dir, out_dir=out_dir, parent=parent)

        elapsed = time.perf_counter() - start
        print(f"[stac-generator] generation OK in {elapsed:.2f}s -> {out_dir}", flush=True)
    except Exception:
        elapsed = time.perf_counter() - start
        tb = traceback.format_exc()
        msg = "\n".join(
            [
                "ERROR",
                f"elapsed_s={elapsed:.3f}",
                f"input={root_dir}",
                f"output={out_dir}",
                "",
                tb,
            ]
        )

        # Conserver la sortie précédente et écrire un status.log informatif.
        try:
            _write_status(out_dir, msg + "\n")
        except Exception:
            # Si on ne peut pas écrire dans out_dir, on log au moins sur stderr.
            print("[stac-generator] failed to write status.log", file=sys.stderr)

        print(
            f"[stac-generator] generation FAILED in {elapsed:.2f}s (kept previous output)",
            file=sys.stderr,
            flush=True,
        )
        print(tb, file=sys.stderr, flush=True)
        raise
    finally:
        # Si tmp_dir n'a pas été déplacé vers out_dir, on nettoie.
        try:
            if tmp_dir.exists() and tmp_dir != out_dir:
                shutil.rmtree(tmp_dir)
        except Exception:
            pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="generate-stac")
    p.add_argument("--input", required=True, help="Input root folder (must contain a metadata.yml)")
    p.add_argument("--output", required=True, help="Output folder (will be created if needed)")
    p.add_argument("--root-href", required=True, help='HTTP prefix for asset hrefs, e.g. "http://site.tld/path/"')
    p.add_argument("--watch", action="store_true", help="Watch --input and continuously regenerate --output")
    p.add_argument(
        "--watch-debounce",
        type=float,
        default=10.0,
        help="Debounce delay (seconds) before regenerating after changes when --watch is enabled (default: 10)",
    )
    p.add_argument(
        "--skip-initial",
        action="store_true",
        help="In watch mode, skip the initial generation (e.g. after a strict bootstrap run)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    root_dir = Path(args.input).expanduser().resolve()
    out_dir = Path(args.output).expanduser().resolve()

    def run_once() -> None:
        _atomic_generate_to_output(root_dir=root_dir, out_dir=out_dir, root_href=str(args.root_href))

    # One-shot mode
    if not args.watch:
        start = time.perf_counter()
        try:
            print(f"[stac-generator] generating once from {root_dir} -> {out_dir}", flush=True)
            run_once()
        except Exception:
            # Status is already written by _atomic_generate_to_output.
            raise SystemExit(1)
        finally:
            elapsed = time.perf_counter() - start
            print(f"[stac-generator] done in {elapsed:.2f}s", flush=True)
        return

    if args.watch_debounce < 0:
        raise SystemExit("--watch-debounce must be >= 0")

    # Watch mode (debounced)
    try:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except Exception as e:  # pragma: no cover
        raise SystemExit(
            "watch mode requires the 'watchdog' dependency. "
            "Install it (e.g. `uv sync`) and retry."
        ) from e

    lock = threading.Lock()
    timer: threading.Timer | None = None
    pending = False
    regenerating = False

    def _schedule_regen() -> None:
        nonlocal timer, pending
        with lock:
            pending = True
            if timer is not None:
                timer.cancel()
            timer = threading.Timer(args.watch_debounce, _regen_if_needed)
            timer.daemon = True
            timer.start()

    def _regen_if_needed() -> None:
        nonlocal pending, regenerating
        with lock:
            if regenerating:
                # We'll run again right after current regeneration finishes.
                return
            if not pending:
                return
            pending = False
            regenerating = True

        try:
            print(
                f"[watch] changes stabilized, regenerating (debounce={args.watch_debounce:g}s)...",
                flush=True,
            )
            run_once()
        except Exception:
            # Don't crash the watcher on regeneration errors.
            pass
        finally:
            with lock:
                regenerating = False
                # If changes happened during regeneration, schedule another run.
                if pending:
                    _schedule_regen()

    class Handler(FileSystemEventHandler):
        def on_any_event(self, event) -> None:  # type: ignore[override]
            # Ignore output dir changes if output is nested within input.
            try:
                src = Path(getattr(event, "src_path", "")).resolve()
                if out_dir in src.parents or src == out_dir:
                    return
            except Exception:
                pass
            etype = getattr(event, "event_type", "unknown")
            src_path = getattr(event, "src_path", "")
            # Ne réagir qu'aux événements qui correspondent à une écriture / création / déplacement.
            # (ignore notamment opened/closed qui peuvent spammer selon l'OS/FS)
            if etype not in {"created", "modified", "moved"}:
                return
            print(f"[watch] change detected ({etype}): {src_path}", flush=True)
            _schedule_regen()

    # Initial build, then watch forever (unless already done by a strict bootstrap).
    if args.skip_initial:
        print("[watch] skipping initial generation (--skip-initial)", flush=True)
    else:
        print(f"[watch] initial generation from {root_dir} -> {out_dir}", flush=True)
        try:
            run_once()
        except Exception:
            print(
                "[watch] initial generation failed",
                file=sys.stderr,
                flush=True,
            )
            raise SystemExit(1) from None

    obs = Observer()
    obs.schedule(Handler(), str(root_dir), recursive=True)
    obs.start()
    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        pass
    finally:
        with lock:
            if timer is not None:
                timer.cancel()
        obs.stop()
        obs.join()


if __name__ == "__main__":
    main()

