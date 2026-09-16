# STAC Browser (for Mines Paris OIE)

Stack Docker : **stac-generator** (catalogue statique) + **static-api** (STAC API) + **stac-browser** (interface web) + **nginx** (reverse proxy), orchestrés par [`docker-compose.yml`](docker-compose.yml). Le catalogue est servi à la racine `/`.

## Déploiement Docker

Copier [`.env.example`](.env.example) vers `.env` et ajuster si besoin :

```bash
cp .env.example .env
docker compose up -d --build
```

| Variable | Défaut | Rôle |
|----------|--------|------|
| `HTTP_PORT` | `8000` | Port HTTP exposé sur l'hôte |

| Service | URL |
|---------|-----|
| Browser | `http://localhost:HTTP_PORT/` |
| API STAC | `http://localhost:HTTP_PORT/api/` |
| Données | `http://localhost:HTTP_PORT/data/...` |
| Viewer Zarr | `http://localhost:HTTP_PORT/viewer/` |
| Proxy Zarr (stores cross-origin) | `http://localhost:HTTP_PORT/viewer/proxy/https/{host}/{path}` |

Les stores same-origin (`/data/...`) passent en direct ; le proxy ne sert qu'à contourner CORS pour les URLs distantes.

### Personnalisation du browser par ENV

La config runtime du browser (`config.js`) est générée au démarrage à partir des variables `SB_*`
(schéma [`config.schema.json`](services/stac-browser/config.schema.json)) — titre, logo, URLs,
domaines autorisés, etc. Exemples :

```yaml
  browser:
    environment:
      SB_catalogTitle: "Mon catalogue"
      SB_catalogImage: "/img/logo.png"
      SB_allowedDomains: "example.org,data.example.org"
      SB_itemsPerPage: "100"
      SB_allowExternalAccess: "true"
```

Pas de rebuild nécessaire : les options runtime écrase le build. Les couleurs nécessitent un
fichier CSS monté (thème), non couvert par les ENV.

### Mode développement

Pour travailler sur **stac-generator**, **zarr-viewer** ou **stac-browser** sans rebuild d'image à chaque changement de code :

```bash
make dev
# ou : make dev-up
```

- Logs dans le terminal ; **Ctrl+C** arrête la stack.
- Overlay [`docker-compose.dev.yml`](docker-compose.dev.yml) :
  - `zarr-viewer` : `DEV=1` (`vite build --watch` → volume `/viewer/`), mounts ciblés sur le code.
  - `stac-generator` : mounts sur le code Python, debounce réduit.
  - `browser` : `DEV=1` → le container démarre le dev server (`vue-cli-service serve`, HMR) sur :8081, derrière nginx. Mounts sur `src/` et les fichiers de config.
- Le `.venv` Python reste celui de l'image ; rebuild si deps changent : `docker compose build stac-generator`.
- Rebuild si deps npm changent : `docker compose -f docker-compose.yml -f docker-compose.dev.yml build browser`.
- stac-browser : rechargement à chaud automatique sur `services/stac-browser/src/`. zarr-viewer : refresh manuel (pas de HMR).
- Sur macOS (Docker Desktop), si le dev server reboucle en permanence, ajouter dans un override local : `CHOKIDAR_USEPOLLING=true` (désactivé par défaut sur Linux car cela provoque des rebuilds infinis).

**Prod** (comportement par défaut) : `docker compose up --build`. Le service `zarr-viewer` build Vite dans l'image puis copie `dist/` dans le volume partagé au démarrage. `browser` build Vue puis sert `dist/` par un petit serveur statique Node. Viewer ou browser modifié → `docker compose build zarr-viewer browser`.

### Tests E2E déploiement

Vérifie automatiquement (ports dédiés pour ne pas perturber une stack en cours) :

| Cible Make | Scénario |
|------------|----------|
| `make test` | Les deux scénarios ci-dessous |
| `make test-direct` | HTTP direct `http://localhost:18001/` |
| `make test-proxy` | HTTPS auto-signé `https://localhost:18443/` via le nginx du stack |

```bash
make test
# ou séparément :
make test-direct
make test-proxy
make e2e-clean   # arrête les projets compose E2E
```

Prérequis : Docker, `curl`, `openssl`, Python 3.

Les tests contrôlent notamment :
- liens API en chemins absolus (`/api/collections`, sans `http://` embarqué)
- absence de mixed content (aucun lien `http://` quand la page est en HTTPS)
- `GET /collections` non vide
- page browser et `config.js` (`catalogUrl` path-absolute)
- viewer Zarr (`/viewer/`) et proxy same-origin (`…/viewer/proxy/https/…`)