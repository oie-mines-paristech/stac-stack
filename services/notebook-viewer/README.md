# Notebook Viewer

Minimal web app that renders a [Jupyter notebook](https://jupyter.org/) in the
browser, using [notebookjs](https://github.com/jsvine/notebookjs). Used as an
in-iframe preview for STAC assets of type `application/x-ipynb+json`.

## Usage

The notebook is passed as a query parameter:

```
https://<host>/notebook-viewer/?url=<NOTEBOOK-URL>
```

`<NOTEBOOK-URL>` may be absolute or root-relative (e.g.
`/data/fisheye/ikarus-access.ipynb`); it is fetched by the browser. Markdown,
ANSI text, `text/plain` / `text/html` / image outputs are rendered. HTML outputs
are sanitized with DOMPurify and cell JavaScript is **not** executed.

### Embedded vs standalone

When embedded (`?embed=1`, or any iframe), the standalone chrome is hidden.
Opened directly, a toolbar with the notebook title and a **Download .ipynb**
button is shown. The STAC browser appends `embed=1` automatically
(`assetViewers` → `embed`, default on). The `window.self !== window.top` check
also covers iframes loaded without the parameter.

## Local development

```bash
npm install
npm run dev
```

## Standalone deployment

```bash
make serve
# → http://localhost:8080/?url=<NOTEBOOK-URL>
```

In the OIE stack the app is built once and its static output is served by the
nginx reverse proxy under `/notebook-viewer/` (see the root `docker-compose.yml`).