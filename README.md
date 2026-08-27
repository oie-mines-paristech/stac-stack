# STAC Browser (for Mines Paris OIE)

Stack Docker : **stac-generator** (catalogue statique) + **static-api** (STAC API) + **stac-browser** (interface web), orchestrés par [`docker-compose.yml`](docker-compose.yml).

## Déploiement Docker

Copier [`.env.example`](.env.example) vers `.env` et ajuster si besoin :

```bash
cp .env.example .env
docker compose up -d --build
```

| Variable | Défaut | Rôle |
|----------|--------|------|
| `PORT` | `8000` | Port exposé sur l'hôte |
| `PATH_PREFIX` | `/` | Préfixe URL de toute la stack |

### `PATH_PREFIX=/` (défaut)

| Service | URL |
|---------|-----|
| Browser | `http://localhost:PORT/` |
| API STAC | `http://localhost:PORT/api/` |
| Données | `http://localhost:PORT/data/...` |
| Viewer Zarr | `http://localhost:PORT/viewer/` |
| Proxy Zarr (stores cross-origin) | `http://localhost:PORT/viewer/proxy/https/{host}/{path}` |

Les stores same-origin (`/data/...`) passent en direct ; le proxy ne sert qu'à contourner CORS pour les URLs distantes.

### `PATH_PREFIX=/stac/` (coexistence avec d'autres apps)

Utile derrière un reverse proxy HTTPS qui route `https://monsite.tld/stac/` vers ce conteneur **sans retirer** le préfixe `/stac` :

```bash
PATH_PREFIX=/stac/ docker compose build stac-browser   # build obligatoire
PATH_PREFIX=/stac/ docker compose up -d
```

| Service | URL |
|---------|-----|
| Browser | `https://monsite.tld/stac/` |
| API STAC | `https://monsite.tld/stac/api/` |
| Données | `https://monsite.tld/stac/data/...` |
| Viewer Zarr | `https://monsite.tld/stac/viewer/` |
| Proxy Zarr (stores cross-origin) | `https://monsite.tld/stac/viewer/proxy/https/{host}/{path}` |

Le proxy externe doit transmettre `Host`, `X-Forwarded-Proto` (et idéalement `X-Forwarded-Host`). Exemple nginx :

```nginx
location /stac {
    proxy_pass http://localhost:7777/stac;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Port $server_port;
}
```

Ne pas dupliquer `X-Forwarded-Host` sur plusieurs proxies (valeurs séparées par des virgules) : cela casse les liens de l'API STAC. La stack interne normalise déjà cet en-tête avant d'appeler `static-api`.

Exemple minimal Caddy :

```caddy
monsite.tld {
    reverse_proxy localhost:8000
}
```

**Notes :**

- Changer `PATH_PREFIX` impose de **rebuilder** l'image `stac-browser` (`pathPrefix` est une option de build).
- Après changement de préfixe, le **stac-generator** régénère les hrefs d'assets (`ROOT_HREF` dérivé automatiquement : `{PATH_PREFIX}data`).
- Formes acceptées : `/`, `/stac`, `/stac/` (normalisées en `/` ou `/stac/`).

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
  - `stac-browser` : image `Dockerfile.dev` (nginx + `vue-cli-service serve`), HMR sur le code Vue monté dans `/app/src`.
- Le `.venv` Python reste celui de l'image ; rebuild si deps changent : `docker compose build stac-generator`.
- Rebuild si deps npm changent : `docker compose -f docker-compose.yml -f docker-compose.dev.yml build stac-browser`.
- Refresh manuel du navigateur après modification zarr-viewer (pas de HMR). stac-browser : rechargement à chaud automatique sur `services/stac-browser/src/`.
- Sur macOS (Docker Desktop), si le dev server reboucle en permanence, ajouter dans un override local : `CHOKIDAR_USEPOLLING=true` (désactivé par défaut sur Linux car cela provoque des rebuilds infinis).

**Prod** (comportement par défaut) : `docker compose up --build`. Le service `zarr-viewer` build Vite dans l'image puis copie `dist/` dans le volume partagé au démarrage. Viewer modifié → `docker compose build zarr-viewer` (ou `make rebuild-viewer`).

### Tests E2E déploiement

Vérifie automatiquement deux scénarios (ports dédiés pour ne pas perturber une stack en cours) :

| Cible Make | Scénario |
|------------|----------|
| `make test` | Les deux scénarios ci-dessous |
| `make test-direct` | HTTP direct `localhost:18001` avec `PATH_PREFIX=/` puis `/stac/` |
| `make test-proxy` | Nginx HTTPS auto-signé `https://localhost:18443/stac/` → stack sur `:18002` |

```bash
make test
# ou séparément :
make test-direct
make test-proxy
make e2e-clean   # arrête les projets compose E2E
```

Prérequis : Docker, `curl`, `openssl`, Python 3.

Les tests contrôlent notamment :
- liens API en chemins absolus (`/stac/api/collections`, sans `http://` embarqué)
- absence de mixed content (aucun lien `http://` quand la page est en HTTPS)
- `GET /collections` non vide
- page browser et `config.js` (`catalogUrl` path-absolute)
- viewer Zarr (`/viewer/` ou `/stac/viewer/`) et proxy same-origin (`…/viewer/proxy/https/…`)

## Git submodules and subtrees

### Submodules (OIE-owned services)

`services/zarr-viewer` and `services/stac-generator` are **git submodules** pointing at their standalone repos. Those repos are the source of truth; develop there (or inside the submodule checkout), then bump the gitlink in this monorepo.

Clone with submodules initialized:

```bash
git clone --recurse-submodules git@git.sophia.minesparis.psl.eu:oie/stac-oie.git
# or after a plain clone:
git submodule update --init --recursive
```

Daily workflow (example: zarr-viewer):

```bash
cd services/zarr-viewer
git checkout main && git pull origin main
cd ../..
git add services/zarr-viewer
git commit -m "Bump zarr-viewer submodule."
```

Docker builds require submodule checkouts (`docker compose build` reads `services/zarr-viewer` and `services/stac-generator` from disk).

The JPEG-XL codec (`@oie-minesparis-psl/jpegxl-zarr`) is **not** a submodule: it is consumed via npm in the viewer (`package.json`).

### Subtrees (upstream without OIE main, or diverged fork)

`services/stac-browser` and `services/stac-fastapi-static` remain **git subtrees** (see [`subtrees.yaml`](subtrees.yaml)).

```bash
./scripts/sync-subtree.sh status [name]   # tree + git link; exit 0 if all in sync
./scripts/sync-subtree.sh pull <name>     # fetch upstream into monorepo
./scripts/sync-subtree.sh push <name>     # export monorepo-only changes + reconcile
```

`git subtree push` fails on this monorepo (recursion depth on deep history). `push` exports directory contents to the upstream repo, then runs `git subtree pull` in the monorepo to keep git history linked.

Typical workflow for `stac-browser`:

1. Make changes in `services/stac-browser` (or pull from upstream).
2. `./scripts/sync-subtree.sh pull stac-browser` when updating from upstream.
3. `./scripts/sync-subtree.sh status stac-browser` should report `state=in sync` when aligned.

---

This is a [Spatio-Temporal Asset Catalog (STAC)](https://github.com/radiantearth/stac-spec) browser for static catalogs.
Minimal support for APIs is implemented, but it not the focus of the Browser and may lead to issues.
It attempts to surface all included data in a user-centric way (an approach
which can inform how data is represented in the evolving spec). It is
implemented as a single page application (SPA) for ease of development and to
limit the overall number of catalog reads necessary when browsing (as catalogs
may be nested and do not necessarily contain references to their parents).

Version: **3.3.4** (supports all STAC versions between 0.6.0 and 1.1.0)

This package has also been published to npm as [`@radiantearth/stac-browser`](https://www.npmjs.com/package/@radiantearth/stac-browser).

It's not officially supported, but you may also be able to use it for
certain _OGC API - Records_ and _OGC API - Features_ compliant servers.

**Please note that STAC Browser is currently with limited funding for both maintenance, bug fixes and improvements. This means issues and PRs may be addressed very slowly.
If you care about STAC Browser and have some funds to support the future of STAC Browser, please contact matthias@mohr.ws**

**Table of Contents:**

- [STAC Browser (for CDSE)](#stac-browser-for-cdse)
  - [Examples](#examples)
  - [Get Started](#get-started)
    - [Private query parameters](#private-query-parameters)
    - [Migrate from old versions](#migrate-from-old-versions)
  - [Customize](#customize)
    - [Options](#options)
    - [Languages](#languages)
      - [Custom phrases](#custom-phrases)
    - [Themes](#themes)
    - [Basemaps](#basemaps)
    - [Actions](#actions)
    - [Additional metadata fields](#additional-metadata-fields)
      - [Example](#example)
      - [Translation](#translation)
    - [Customize through root catalog](#customize-through-root-catalog)
    - [Custom extensions](#custom-extensions)
  - [Docker](#docker)
  - [Contributing](#contributing)
    - [Adding a new language](#adding-a-new-language)
  - [Sponsors](#sponsors)

## Examples

A demo instance is running at <https://radiantearth.github.io/stac-browser/>.

The catalog section of [STAC Index](https://stacindex.org) is also built on top of STAC Browser (currently v2).

## Get Started

First, you need to clone or download this repository.

Then switch into the newly created folder and install all dependencies:

```bash
npm install
```

By default, STAC Browser will let you browse all catalogs on STAC Index.

To browse only your own static STAC catalog or STAC API, set the `catalogUrl` CLI parameter when running the dev server.
In this example we point to EarthSearch (`https://earth-search.aws.element84.com/v1/`):

```bash
npm start -- --open --catalogUrl="https://earth-search.aws.element84.com/v1/"
```

To open a local file on your system, see the chapter [Using Local Files](docs/local_files.md).

If you'd like to publish the STAC Browser instance use the following command:

```bash
npm run build -- --catalogUrl="https://earth-search.aws.element84.com/v1/"
```

This will only work on the root path of your domain though. If you'd like to publish in a sub-folder,
you can use the [`pathPrefix`](docs/options.md#pathprefix) option.

> [!NOTE]  
> If you are using a recent version of node/npm on Windows, you may need to use `npm run build -- -- ...` instead of `npm run build -- ...`, see <https://github.com/npm/cli/issues/7375> for details.

After building, `dist/` will contain all assets necessary
host the browser. These can be manually copied to your web host of choice.
**Important:** If `historyMode` is set to `history` (which is the default value), you'll need to add
an additional configuration file for URL rewriting.
Please see the [`historyMode`](docs/options.md#historymode) option for details.

You can customize STAC Browser, too. See the options and theming details below.
If not stated otherwise, all options can either be specified via CLI, ENV variables or in the [config file](config.js).
You can also provide configuration options "at runtime" (after the build).

### Private query parameters

**_experimental_**

STAC Browser supports "private query parameters", e.g. for passing an API key through. Any query parameter that is starting with a `~` will be stored internally, removed from the URL and be appended to STAC requests. This is useful for token-based authentication via query parameters.

So for example if your API requires to pass a token via the `API_KEY` query parameter, you can request STAC Browser as such:
`https://examples.com/stac-browser/?~API_KEY=123` which will change the URL to `https://examples.com/stac-browser/` and store the token `123` internally. The request then will have the query parameter attached and the Browser will request e.g. `https://examples.com/stac-api/?API_KEY=123`.

Please note: If the server hosting STAC Browser should not get aware of private query parameters and you are having `historyMode` set to `"history"`, you can also append the private query parameters to the hash so that it doesn't get transmitted to the server hosting STAC Browser.
In this case use for example `https://examples.com/stac-browser/#?~API_KEY=123` instead of `https://examples.com/stac-browser/?~API_KEY=123`.

### Migrate from old versions

Please read the [migration documentation](docs/migrate.md) for details.

## Customize

### Options

STAC Browser supports customization through a long list of options that can be set in various ways.

Please read the **[documentation for the options](docs/options.md)**.

### Languages

STAC Browser can be translated into other languages and can localize number formats, date formats etc.

You need to change the [`locale`](docs/options.md#locale) and [`supportedLocales`](docs/options.md#supportedlocales) settings to select the default language and the languages available to users.

The following languages are currently supported:

- Arabic `ar`
- German `de` (Germany `de`, Switzerland `de-CH`)
- Spanish `es`
- English `en` (International `en`, US `en-US`, UK `en-GB`)
- French `fr` (Canada `fr-CA`, France `fr`, Switzerland `fr-CH`)
- Italian `it` (Italy `it`, Switzerland `it-CH`)
- Romanian `ro`
- Japanese `ja`
- Portuguese `pt` (Brazil `pt-BR`, Portugal `pt`)

We manage the translations in Crowdin, please see <https://crowdin.com/project/stac-browser/> for details.

To add your own language, please follow the guide below: [Adding a new language](#adding-a-new-language)

The following contributors kindly provide the translations:

- [@jfbourgon](https://github.com/jfbourgon): `fr`, `fr-CA`
- [@mneagul](https://github.com/mneagul): `ro`
- [@m-mohr](https://github.com/m-mohr): `de`, `en`, `en-GB`, `en-US`
- [@p1d1d1](https://github.com/p1d1d1): `de-CH`, `fr-CH`, `it`, `it-CH`
- [@psacra](https://github.com/psacra): `pt`
- [@randa-11295](https://github.com/randa-11295): `ar`
- [@rnanclares](https://github.com/rnanclares): `es`
- [@uba](https://github.com/uba): `pt-BR`

#### Custom phrases

You can define custom phrases in the `custom.json`.
This is especially useful for phrases that are coming from non-standadized metadata fields (see the chapter "[Additional metadata fields](#additional-metadata-fields)").
If you've found metadata labels (e.g. "Price" and "Generation Time") that are not translated,
you can add it to the `custom.json`. For metadata fields you need to add it to a the object `fields`
as it is the group for the metadata-related phrases.
There you can add as many phrases as you like. For example:

```json
{
  "fields": {
    "Price": "Preis",
    "Generation Time": "Generierungszeit"
  }
}
```

### Themes

You can customize STAC Browser in the `src/theme` folder. It contains Sass files (a CSS preprocessor), which you can change to suit your needs.

The easiest solution is to start with the `variables.scss` file and customize the options given there.
For simplicity we just provide some common options as default, but you can also add and customize any Bootstrap variable,
see <https://getbootstrap.com/docs/4.0/getting-started/theming/> for details.

The file `page.scss` contains some Sass declarations for the main sections of STAC Browser and you can adopt those to suit your needs.

If you need even more flexibility, you need to dig into the Vue files and their dependencies though.

### Basemaps

The file `basemaps.config.js` contains the configuration for the basemaps.
You can update either just the `BASEMAPS` object or you can write a custom function `configureBasemap` that returns the desired options for [vue2-leaflet](https://vue2-leaflet.netlify.app/).
[XYZ](https://vue2-leaflet.netlify.app/components/LTileLayer.html#props) and [WMS](https://vue2-leaflet.netlify.app/components/LWMSTileLayer.html#props) basemaps are supported and have different options that you can set.

### Actions

STAC Browser has a pluggable interface to share or open assets and links with other services, which we call "actions".

More information about how to add or implement actions can be found in the **[documentation](docs/actions.md)**.

### Additional metadata fields

The metadata that STAC Browser renders is rendered primarily through the library [`stac-fields`](https://www.npmjs.com/package/@radiantearth/stac-fields).
It contains a lot of rules for rendering [many existing STAC extensions](https://github.com/stac-utils/stac-fields/blob/main/fields.json) nicely.
Nevertheless, if you use custom extensions to the STAC specification you may want to register your own rendering rules for the new fields.
This can be accomplished by customizing the file [`fields.config.js`](./fields.config.js).
It uses the [Registry](https://github.com/stac-utils/stac-fields/blob/main/README.md#registry) defined in stac-fields to add more extensions and fields to stac-fields and STAC Browser.

To add your own fields, please consult the documentation for the [Registry](https://github.com/stac-utils/stac-fields/blob/main/README.md#registry).

#### Example

If you have a custom extension with the title "Radiant Earth" that uses the prefix `radiant:` you can add the extension as such:

```js
Registry.addExtension("radiant", "Radiant Earth");
```

If this extension has a boolean field `radiant:public_access` that describes whether an entity can be accessed publicly or not, this could be described as follows:

```js
Registry.addMetadataField("radiant:public_access", {
  label: "Data Access",
  formatter: (value) => (value ? "Public" : "Private"),
});
```

This displays the field (with a value of `true`) in STAC Browser as follows: `Data Access: Public`.

The first parameter is the field name, the second parameter describes the field using a ["field specification"](https://github.com/stac-utils/stac-fields/blob/main/README.md#fieldsjson).
Please check the field specification for available options.

#### Translation

STAC Browser supports [multiple languages](#languages).
If you use more than one language, you likely want to also translate the phrases that you've added above (in the example `Data Access`, `Public` and `Private`, assuming that `Radiant Earth` is a name and doesn't need to be translated).
All new phrases should be added to the [active languages](docs/options.md#supportedlocales).
To add the phrases mentioned above you need to go through the folders in `src/locales` and in the folders of the active languages update the file `custom.json` as described in the section that describes [adding custom phrases](#custom-phrases).
All new phrases must be added to the property `fields`.

Below you can find an example of an updated `custom.json` for the German language (folder `de`). It also includes the `authConfig`, which is contained in the file by default for [other purposes](docs/options.md#authconfig).

```json
{
  "authConfig": {
    "description": ""
  },
  "fields": {
    "Data Access": "Zugriff auf die Daten",
    "Public": "Öffentlich",
    "Private": "Privat"
  }
}
```

### Customize through root catalog

You can also provide a couple of the config options through the root catalog.
You need to provide a field `stac_browser` and then you can set any of the following options:

- `apiCatalogPriority`
- `authConfig` (except for the `formatter` as function)
- `cardViewMode`
- `cardViewSort`
- `crossOriginMedia`
- `defaultThumbnailSize`
- `displayGeoTiffByDefault`
- `showThumbnailsAsAssets`

### Custom extensions

STAC Browser supports some non-standardized extensions to the STAC specification that you can use to improve the user-experience.

1. [Provider Object](https://github.com/radiantearth/stac-spec/blob/master/collection-spec/collection-spec.md#provider-object):
   Add an `email` (or `mail`) field with an e-mail address and the mail will be shown in the Browser.
2. [Alternative Assets Object](https://github.com/stac-extensions/alternate-assets?tab=readme-ov-file#alternate-asset-object):
   Add a `name` field and it will be used as title in the tab header, the same applies for the core Asset Object.
3. A link with relation type `icon` and a Browser-supported media type in any STAC entity will show an icon in the header and the lists of Catalogs, Collections and Items.

## Docker

You can use the Docker to work with STAC Browser. Please read [Docker documentation](docs/docker.md) for more details.

## Contributing

We are happy to review and accept Pull Requests.
STAC Browser is following the [STAC code of conduct](https://github.com/radiantearth/stac-spec/blob/master/CODE_OF_CONDUCT.md).

STAC Browser uses [Vue](https://vuejs.org/) and [vue-cli](https://cli.vuejs.org/), so you need a recent version of [NodeJS and npm](https://nodejs.org/en/) installed.

You can run the following commands (see also "[Get started](#get-started)" above):

- `npm run install`: Install the dependencies, this is required once at the beginning.
- `npm start`: Start the development server
- `npm run lint`: Lint the source code files
- `npm run build`: Compile the source code into deployable files for the web. The resulting files can be found in the folder `dist` and you can then deploy STAC Browser on a web host. There are two other variants:
  - `npm run build:report`: Same as above, but also generates a bundle size report (see `dist/report.html`), which should not be deployed.
  - `npm run build:minimal`: Same as above, but tries to generate a minimal version without bundle size report and without source maps.
- `npm run i18n:fields`: Generates an updated version of the locales from the stac-fields package.

The [release process is documented separately](docs/release.md).

### Adding a new language

You can translate STAC Browser into other languages.
You can also use one of the existing languages and provide an alternate version for a specifc country, e.g. a Australian English (en-AU) version of the US-English language pack (en).

**Please follow this guide:**

- Copy the `en` folder (or any other language without a country code that you want to base the translation on).
  - Note: If you start with the `en` folder, you have to remove the leading `//` from the line `// { fields: require('./fields.json') }` in the file `default.js`.
- Name the new folder according to [RFC5646](https://www.rfc-editor.org/rfc/rfc5646).
- Add the language to the list of supported locales ([`supportedLocales`](docs/options.md#supportedlocales)) in the `config.js` file.
- Add the language to the [list of languages in this README file](#languages).
- Add yourself to the list of code owners (`.github/CODEOWNERS`) for this language (we'll invite you to this repository after you've opened a PR). **Persons contributing languages are expected to maintain them long-term! If you are not able to maintain the language pack, please indicate so in the PR and we'll release it separately.**
- Translate the `.json` files, most importantly `config.json`, `fields.json` and `texts.json`.
  - Please note that you never need to translate any object keys!
  - If you base your language on another existing language (e.g. create `en-IN` based on `en`) you can delete individual files and import existing files from other languages in `default.js`.
- Adapt the `datepicker.js`, `duration.js` and `validation.js` files to import the existing definitions from their corresponding external packages, but you could also define the specifics yourself.
- Check that your translation works by running the development server (`npm start`) and navigating to the STAC Browser instance in your browser (usually `http://localhost:8080`).
- Once completed, please open a pull request and we'll get back to you as soon as possible.
- After merging the PR for the first time, we'll add you to our translation management tool Crowdin: <https://crowdin.com/project/stac-browser/>. Please get in touch to get your invite!

## Sponsors

The following sponsors have provided a substantial amount of funding for STAC Browser in the past:

- [Radiant Earth](https://radiant.earth) (base funding for versions 1, 2 and 3)
- [swisstopo](https://www.swisstopo.admin.ch/) (maintenance, base funding for version 3 and 4)
- [National Resources Canada](https://natural-resources.canada.ca/home) (multi-language support, maintenance)
- [Matthias Mohr - Softwareentwicklung](https://mohr.ws) (maintenance)
- [Spacebel](https://spacebel.com) (collection search, mapping)
- [Planet](https://planet.com) (authentication, maintenance)
- [CloudFerro](https://cloudferro.com) (authentication, alternate asset and storage extension)
- [Geobeyond](http://www.geobeyond.it/) (mapping)
