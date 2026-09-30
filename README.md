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

### Visualisation d'assets custom (`assetViewers`)

Le browser sait injecter des blocs de prévisualisation **iframe** (viewer Zarr, notebooks, …)
pour les assets qui correspondent à un type MIME / rôle, sans toucher au code upstream. La
liste des viewers est fournie par la config runtime (**`branding/config.yaml`**, clé
`assetViewers`, ou `SB_assetViewers` en JSON) :

```yaml
assetViewers:
  # Viewer Zarr embarqué (servi par nginx sur /viewer/).
  - id: zarr
    title: "Zarr viewer"
    icon: "▦"                      # texte/emoji, ou URL (img) si commence par / ou http
    match:
      type: "application/vnd.zarr" # type MIME (paramètres ignorés)
      roles: [data]                # rôles requis (tous)
      # key: "data"                # clé d'asset exacte (optionnel)
    url: "/viewer/"                # BASE de l'URL viewer (sans query params)
    query:
      url: href                    # valeur = "href" (URL asset), variable ENV
                                   #   (majuscules, résolue au démarrage), ou
                                   #   attribut d'asset (e.g. viewer:default_var)
                                   #   — paramètre omis si valeur vide
    mode: append                   # append = bloc dédié, inplace = dans le bloc de l'asset
    height: 480                    # hauteur iframe (px)
    expand: true                   # bloc ouvert par défaut (append) ; défaut false
```

Chaque entrée rend un bloc pour tout asset qui matche le `match`. Le mode `append` crée un
nouvel accordéon (titre + icône, contrôlé par `expand`) ; `inplace` insère l'iframe à
l'intérieur du bloc normal de l'asset. Un bloc est toujours rendu séparément par asset
correspondant. Sous chaque iframe, deux actions (même look que les actions d'assets classiques) :
passer en « full-tab » (l'iframe prend tout le viewport, bouton flottant pour sortir) et ouvrir
le viewer dans un nouvel onglet.

En plus du viewer Zarr, un second bloc **`zarr-subset`** (icône 📦) permet de sélectionner des
variables et des plages, puis de télécharger un ZIP du sous-ensemble (FastAPI + mod_zip, servi
par nginx sur `/zarr-subset/`). Le service reçoit l'`href` de l'asset comme **URI** (chemin
externe, profondeur libre) et le résout entre le point de montage HTTP (`ZARR_URI_PREFIX`) et
le bind-mount interne (`ZARR_ROOT`) : aucune métadonnée STAC supplémentaire n'est nécessaire.
Voir [`services/zarr-subset-zip`](services/zarr-subset-zip) (sous-module OIE).

### TLS termination (optional Caddy profile)

The stack is HTTP-only by default and expects to sit behind an external reverse proxy. To terminate
TLS itself instead, enable the `tls` profile: a [Caddy](https://caddyserver.com/) container takes over
`:80`/`:443` and reverse-proxies everything to nginx, which keeps serving every route (`/`, `/api/`,
`/data`, `/dav/`, `/viewer/`) unchanged.

```bash
# DOMAIN must already resolve to this host (see below)
make up-tls          # BIND_ADDR=127.0.0.1 docker compose --profile tls up -d
make down            # caddy goes away with the profile
```

Two variables in `.env` drive it (see `.env.example`):

| Variable | Role |
| --- | --- |
| `DOMAIN` | Hostname Caddy answers for. Must resolve to this host. |
| `TLS` | Caddy `tls` directive: `internal` (self-signed) or `"acme you@host"` (Let's Encrypt). |

`EXTERNAL_URL`, advertised in the STAC items, defaults to `https://${DOMAIN}/` — declare `DOMAIN`
before it. Without the profile the stack is reached over plain HTTP, so point `EXTERNAL_URL` back at
`http://localhost:${HTTP_PORT}/`.

**Self-signed** (`TLS=internal`) works offline. Browsers warn until you trust Caddy's local root:

```bash
docker compose exec caddy caddy trust   # installs it in the host trust store
docker compose exec caddy caddy trust --remove   # undo
```

Caddy logs `failed to install root certificate … tee: exit status 1` on startup: that is the *host*
trust store, unreachable from an unprivileged container. Harmless, and the two commands above are the
supported way to trust it.

**Let's Encrypt** (`TLS="acme you@example.com"`) additionally requires the domain to resolve to
this host over public DNS, inbound `:80`/`:443` reachable, and ports 80/443 free — stop whatever else
holds them (`systemctl status nginx`, `ss -tlnp | grep -E ':(80|443)'`). Renewal is automatic.

Certificates, the ACME account and Caddy's internal CA persist in `volumes/certificates/` (gitignored),
so `make down && make up-tls` reuses them instead of re-requesting — which matters for Let's Encrypt
rate limits. Caddy runs as `$NGINX_UID:$NGINX_GID` with `NET_BIND_SERVICE`, like nginx, so that
directory stays owned by you rather than `root:root 0700`.

`make up-tls` also pins nginx to `127.0.0.1`, which closes the plaintext `:8000` entry point so
`http://host:8000/dav/` is not still reachable in clear. Compose has no way to make `ports`
conditional on a profile, so this is done by exporting `BIND_ADDR` in the target; running
`docker compose --profile tls up -d` by hand leaves it on `0.0.0.0` unless you prefix
`BIND_ADDR=127.0.0.1` yourself.

For a purely local test, map the domain to loopback:

```bash
echo '127.0.0.1 stac.oie.local' | sudo tee -a /etc/hosts
```

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
- `nginx` embarque aussi **mod_zip** (flux ZIP), compilé en **module dynamique** contre la
  version exacte de nginx de l'image de base au build (`services/nginx/Dockerfile`) — pas de
  conteneur nginx dédié côté `zarr-subset-zip`.

### Audit des images (état au 2026-09-30)

| Service | Image de base | Pin digest | Note |
|---------|---------------|:----------:|------|
| `nginx` | `hakwerk/nginx-dav` (nginx 1.31.4 + dav-ext statique + headers-more + fancyindex) | ✅ | ⚠ tiers, non-officiel Docker |
| `browser` | `node:lts-alpine` (= v24.21.0 au pin) | ✅ | 2 étages `FROM` pinnés ; `deps` hérité l'est aussi |
| `zarr-viewer` | `node:22-alpine` | ✅ | — |
| `stac-generator` | `python:3.12-slim` | ✅ | uv installé **depuis PyPI `uv==0.12.15` pinné** (identique à `static-api`) |
| `static-api` (2 étages) | `python:3.12-alpine` | ✅ | uv installé **depuis PyPI `uv==0.12.15` pinné** au lieu du script `astral.sh` (trou de supply chain corrigé) |
| `zarr-subset-zip` | `python:3.12-slim` | ✅ | API FastAPI (sous-module OIE) ; uv via `COPY --from=ghcr.io/astral-sh/uv:0.12.21` pinné par digest ; mod_zip chargé dans `nginx` |
| `caddy` (profil `tls`) | `caddy:2-alpine` | ✅ | image officielle, pin dans [`docker-compose.yml`](docker-compose.yml) |
| *frontend syntax* (les 7 `Dockerfile`) | `docker/dockerfile:1.7` | ✅ | directive `# syntax=` elle-même épinglée par digest |

**Re-pin après bump** (routine à chaque mise à jour d'une image) : modifier la version dans le `FROM`, puis `docker inspect --format '{{index .RepoDigests 0}}' <image>` et reporter le digest dans le `@sha256:` du `FROM`. Pour le frontend syntax, `docker buildx imagetools inspect docker/dockerfile:1.7`.

### Images publiées

Les 7 images *first-party* portent un nom explicite et une version. Le `build:`
reste présent : le dépôt reste requis (config nginx, `branding/`, volumes), les
images évitent seulement la compilation.

La version vient du fichier commité **`VERSION`**, lu par le `Makefile`. Un clone
ne dépend donc d'aucune variable d'environnement ni d'un tag git local :

```bash
make up          # tire stac-stack-*:$(cat VERSION)
```

| Fichier | Rôle |
|---------|------|
| `VERSION` | version publiée, bumpée par `release.sh` |

Le registre est figé dans `docker-compose.yml` (`ghcr.io/oie-mines-paristech`).
Chaque release pousse aussi le tag `:latest` à côté du tag de version, donc un
`docker compose up` sans le `Makefile` résout également.

`VERSION` est délibérément hors de `.env` : ce dernier porte des secrets d'hôte et
ne doit jamais faire foi sur un artefact publié.

Pour forcer une version précise sans modifier le dépôt :

```bash
STACK_VERSION=2026.09.30 docker compose build
```

Noms dérivés : `stac-stack-nginx`, `stac-stack-static-api`, `stac-stack-zarr-subset-zip`,
`stac-stack-browser`, `stac-stack-generator`, `stac-stack-zarr-viewer`,
`stac-stack-notebook-viewer`. `caddy` reste une image tierce pinnée, jamais publiée par ce dépôt.

Chaque image porte deux labels OCI, injectés par compose (ancrage `x-oci-labels`) :

| Label | Valeur | Usage |
|-------|--------|-------|
| `org.opencontainers.image.revision` | SHA du commit, ou `unreleased` | Renovate, `docker inspect`, traçabilité image → commit |
| `org.opencontainers.image.version` | tag de release, ou `dev` | version lisible sans le registre |

Une image construite hors release s'auto-identifie `unreleased` / `dev` : elle ne peut pas
être confondue avec une version publiée.

### Publier une release

Rien n'est publié tant que la source n'est pas committée — **y compris les sous-modules**.

```bash
make release-check                 # garde-fou seul, sans effet de bord (gate CI)
make release VERSION=2026.09.30    # check → tag git → build → push
```

`scripts/release.sh` refuse la release si :

- le worktree du dépôt parent a des modifications non committées ;
- un sous-module a des modifications non committées **dans son propre worktree**
  (le message indique le fichier et la commande `git add` à faire ensuite) ;
- un sous-module est checkout sur un commit que le parent n'enregistre pas
  (gitlink divergent — `git submodule status` le signale par un `+`, `git status` seul ne le voit pas) ;
- un sous-module n'est pas initialisé, ou est en conflit de merge ;
- le tag demandé existe déjà.

Le tag gitannoté est créé **après** le premier push réussi, pour qu'un build en échec
ne laisse jamais un tag pointer sur un commit non publié. `scripts/release.sh push <image>`
applique la même règle au niveau de l'image : refuses de pousser une image dont le label
`revision` n'est pas le commit courant — donc un `docker push` manuel ne contourne pas le garde-fou.

## Tests E2E déploiement

Vérifie automatiquement (ports dédiés pour ne pas perturber une stack en cours) :

| Cible Make | Scénario |
|------------|----------|
| `make test` | Les deux scénarios ci-dessous |
| `make test-direct` | HTTP direct `http://localhost:18001/` — API, browser, viewer, proxy Zarr |
| `make test-webdav` | WebDAV `/data` (lecture publique, écriture admin) + `/dav` (tout auth, catalog RO) |
| `make test-release` | Roundtrip de release : build → push vers un registre local → purge des tags locaux → `pull` → `up --no-build` → smoke test |

```bash
make test
# ou séparément :
make test-direct
make test-webdav
make e2e-clean   # arrête les projets compose E2E
```

Prérequis : Docker, `curl`, Python 3.

`make test-release` est le test le plus important pour la distribution : il prouve
qu'un déploiement peut démarrer **sans jamais builder**, en ne faisant que `pull`.
Il utilise un registre `registry:2` jetable sur `localhost:5000` et le tag `test`,
pour ne toucher à aucun tag publié — et il ne laisse rien derrière lui (stack,
images `:test`, conteneur du registre sont supprimés en sortie, y compris en cas
d'échec).

```bash
make test-release   # ~3 min : registre local jetable puis roundtrip
```

Les tests contrôlent notamment :
- liens API en chemins absolus (`/api/collections`, sans `http://` embarqué)
- page browser et `config.js` (`catalogUrl` path-absolute)
- viewer Zarr (`/viewer/`) et proxy same-origin (`…/viewer/proxy/https/…`)
- WebDAV : `OPTIONS` retourne `DAV: 2`, `MKCOL` crée bien le dossier, `LOCK`/`UNLOCK` fonctionnent, `PUT`/`DELETE` rejettent les anon