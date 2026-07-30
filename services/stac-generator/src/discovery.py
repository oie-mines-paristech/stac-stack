from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ResolvedEntry:
    """
    Résultat d’une entrée `children` / `items` résolue.

    `path` est un chemin absolu sur disque.
    `rel_to_root` est le chemin relatif POSIX depuis le root d’entrée (pour href d’assets).
    """

    path: Path
    rel_to_root: Path


def expand_patterns(base_dir: Path, root_dir: Path, patterns: list[str]) -> list[ResolvedEntry]:
    out: list[ResolvedEntry] = []
    for pat in patterns:
        pat = pat.strip()
        if not pat:
            continue

        # Chemins relatifs à base_dir, possibilité de glob.
        matches = sorted(base_dir.glob(pat))
        if not matches:
            # Si pas de match, on tente aussi le chemin direct (sans glob).
            p = (base_dir / pat)
            if p.exists():
                matches = [p]
            else:
                raise ValueError(f"Pattern matched nothing: {pat!r} in {base_dir}")

        for m in matches:
            m = m.resolve()
            try:
                rel = m.relative_to(root_dir.resolve())
            except ValueError:
                raise ValueError(f"Chemin {m} n’est pas sous le root {root_dir}")
            out.append(ResolvedEntry(path=m, rel_to_root=rel))

    # Dédup en conservant l’ordre
    seen: set[Path] = set()
    dedup: list[ResolvedEntry] = []
    for e in out:
        if e.path in seen:
            continue
        seen.add(e.path)
        dedup.append(e)
    return dedup


def find_thumbnail(folder: Path) -> Path | None:
    # On accepte aussi "preview.*" comme vignette par défaut, car c'est très courant
    # dans les dossiers de données (et utile pour STAC Browser).
    for name in (
        "thumbnail.png",
        "thumbnail.jpg",
        "thumbnail.jpeg",
        "preview.png",
        "preview.jpg",
        "preview.jpeg",
    ):
        p = folder / name
        if p.exists() and p.is_file():
            return p
    return None

