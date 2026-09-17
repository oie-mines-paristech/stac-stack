# STAC Browser (for Mines Paris OIE)

Stack Docker : **stac-generator** (catalogue statique) + **static-api** (STAC API) + **stac-browser** (interface web) + **nginx** (reverse proxy + WebDAV), orchestrés par [`docker-compose.yml`](docker-compose.yml). Le catalogue est servi à la racine `/`.

## Déploiement Docker

Copier [`.env.example`](.env.example) vers `.env` et ajuster si besoin :

```bash
cp .env.example .env
docker compose up -d --build
```

| Variable | Défaut | Rôle |
|----------|--------|------|
| `HTTP_PORT` | `8000` | Port HTTP exposé sur l'hôte |
| `NGINX_UID` | `1000` | UID du worker nginx (fichiers dans `volumes/data`) |
| `NGINX_GID` | `1000` | GID du worker nginx |
| `WEBDAV_ADMIN` | *(vide)* | Login admin WebDAV — **requis** (`/data` tout-auth) ; vide ⇒ `/data` inaccessible |
| `WEBDAV_PASSWORD` | *(vide)* | Mot de passe admin WebDAV |

| Service | URL |
|---------|-----|
| Browser | `http://localhost:HTTP_PORT/` |
| API STAC | `http://localhost:HTTP_PORT/api/` |
| Données | `http://localhost:HTTP_PORT/data/...` |
| WebDAV admin (data + catalog) | `dav://localhost:HTTP_PORT/dav` |
| Viewer Zarr | `http://localhost:HTTP_PORT/viewer/` |
| Proxy Zarr (stores cross-origin) | `http://localhost:HTTP_PORT/viewer/proxy/https/{host}/{path}` |

Les stores same-origin (`/data/...`) passent en direct ; le proxy ne sert qu'à contourner CORS pour les URLs distantes.

### WebDAV (`/data`)

nginx expose un endpoint WebDAV sur `/data` via le module [`nginx-dav-ext`](https://github.com/arut/nginx-dav-ext-module). Lecture publique, écriture admin — la racine WebDAV admin complète (`/dav`) est dédiée à Nautilus/rclone.

| Méthode | Sans credentials | Avec credentials |
|---------|:----------------:|:----------------:|
| `GET` / `HEAD` / `PROPFIND` / `OPTIONS` | 200 / 207 / 200 | 200 / 207 / 200 |
| `PUT` / `DELETE` / `MKCOL` / `COPY` / `MOVE` | **401** | 201 / 204 / 201 |
| `LOCK` / `UNLOCK` | — | 200 / 204 |

**Accès** (tout en HTTP, TLS géré par le reverse proxy externe) :

```bash
# Lecture publique
curl http://localhost:8000/data/           # index HTML (autoindex)
curl http://localhost:8000/data/file.tif

# Écriture admin
curl -u admin:motdepasse -T local.tif http://localhost:8000/data/file.tif
curl -u admin:motdepasse -X MKCOL http://localhost:8000/data/dir/
curl -u admin:motdepasse -X DELETE http://localhost:8000/data/file.tif

# Davfs2 / rclone (admin : écriture)
mount -t davfs http://localhost:8000/data /mnt/webdav  # login = WEBDAV_ADMIN
rclone mount remote: /mnt/webdav --dav-addr http://localhost:8000/data
```

### WebDAV admin (`/dav`)

En plus de `/data` (WebDAV monodossier), nginx expose une **racine WebDAV admin** sur `/dav` : `dav://localhost:8000/dav` montre les deux dossiers utiles au débug :

| Sous-dossier | Contenu | Accès |
|--------------|---------|-------|
| `dav://…/dav/data/` | `volumes/data` (données STAC) | lecture + écriture |
| `dav://…/dav/catalog/` | `volumes/catalog` (`status.log`, `catalog.json`, collections) | **lecture seule** (monté `:ro`) |

Même politique d'auth que `/data` (tout authentifié, `OPTIONS` ouvert pour GVfs). `/catalog` n'est **pas** exposé en HTTP publique — il n'existe que sous ce chemin WebDAV authentifié ; une URL type `http://…/catalog/status.log` retombe sur le SPA browser et ne sert jamais le fichier réel.

**Notes techniques** :
- `client_max_body_size 0` — aucune limite de taille pour les uploads.
- `create_full_put_path on` — PUT crée les répertoires intermédiaires automatiquement.
- MKCOL avec `/` final requis (rewrite automatique dans nginx).
- Les fichiers sont créés sur l'hôte avec l'ownership `NGINX_UID:NGINX_GID`.
- Le LOCK WebDAV est fonctionnel (LOCK 200 avec `Lock-Token`, UNLOCK 204, 423 si verrouillé sans token).

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

## Supply chain des images

Toutes les images de base sont **pinnées par digest SHA256** dans leur `Dockerfile` respectif, pour des builds reproductibles et immuables (la sortie de `docker compose build` est identique à la date du pin).

⚠ **`nginx` s'appuie sur l'image tiers `hakwerk/nginx-dav`** (nginx officiel + module dav-ext compilé en statique) :

- ce n'est **pas** une builds officielle Docker/nginx ;
- l'image est construite par la chaîne GitHub Actions du mainteneur — auditer [`hakwerk/nginx-dav`](https://github.com/hakwerk/nginx-dav) avant de se reposer dessus ;
- le digest est pîné dans [`services/nginx/Dockerfile`](services/nginx/Dockerfile) ; pour le mettre à jour :
  ```bash
  docker pull hakwerk/nginx-dav:latest
  docker inspect --format '{{index .RepoDigests 0}}' hakwerk/nginx-dav:latest
  ```
- l'ancien nginx custom (compilé en local) et le source vendored `dav-ext/` ont été retirés.

### Audit des images (état au 2026-09-16)

| Service | Image de base | Pin digest | Note |
|---------|---------------|:----------:|------|
| `nginx` | `hakwerk/nginx-dav` (nginx 1.31.4 + dav-ext statique + headers-more + fancyindex) | ✅ | ⚠ tiers, non-officiel Docker |
| `browser` | `node:lts-alpine` (= v24 au pin) | ✅ | — |
| `zarr-viewer` | `node:22-alpine` | ✅ | — |
| `stac-generator` | `python:3.12-slim` | ✅ | — |
| `static-api` (2 étages) | `python:3.12-alpine` | ✅ | uv installé **depuis PyPI `uv==0.12.15` pinné** au lieu du script `astral.sh` (trou de supply chain corrigé) |

**Re-pin après bump** (routine à chaque mise à jour d'une image) : modifier la version dans le `FROM`, puis `docker inspect --format '{{index .RepoDigests 0}}' <image>` et reporter le digest dans le `@sha256:` du `FROM`.

## Tests E2E déploiement

Vérifie automatiquement (ports dédiés pour ne pas perturber une stack en cours) :

| Cible Make | Scénario |
|------------|----------|
| `make test` | Les deux scénarios ci-dessous |
| `make test-direct` | HTTP direct `http://localhost:18001/` — API, browser, viewer, proxy Zarr |
| `make test-webdav` | WebDAV `/data` (lecture publique, écriture admin) + `/dav` (tout auth, catalog RO) |

```bash
make test
# ou séparément :
make test-direct
make test-webdav
make e2e-clean   # arrête les projets compose E2E
```

Prérequis : Docker, `curl`, Python 3.

Les tests contrôlent notamment :
- liens API en chemins absolus (`/api/collections`, sans `http://` embarqué)
- page browser et `config.js` (`catalogUrl` path-absolute)
- viewer Zarr (`/viewer/`) et proxy same-origin (`…/viewer/proxy/https/…`)
- WebDAV : `OPTIONS` retourne `DAV: 2`, `MKCOL` crée bien le dossier, `LOCK`/`UNLOCK` fonctionnent, `PUT`/`DELETE` rejettent les anon