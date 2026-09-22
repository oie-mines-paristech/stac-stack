import { marked } from 'marked';
import { AnsiUp } from 'ansi_up';
import DOMPurify from 'dompurify';
// notebookjs is a UMD bundle: it reads its deps from the globals we set below
// and would otherwise pull in jsdom (Node-only) through Vite's bundler. We ship
// the browser bundle as-is (`?url`) and load it as a classic script.
import notebookBundleUrl from 'notebookjs/notebook.min.js?url';
import './style.css';

const app = document.getElementById('app');
const status = document.getElementById('status');
const toolbar = document.getElementById('toolbar');
const toolbarTitle = document.getElementById('toolbar-title');
const toolbarDownload = document.getElementById('toolbar-download');

function setStatus(message) {
  if (!status) return;
  status.textContent = message || '';
  status.hidden = !message;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function renderNotebook(url) {
  setStatus('Loading notebook…');

  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Could not fetch notebook (HTTP ${response.status})`);
  }
  const ipynb = await response.json();

  // notebookjs reads markdown/ansi/sanitizer from window at load time.
  window.marked = { parse: (text) => marked.parse(text) };
  window.ansi_up = { ansi_to_html: (text) => new AnsiUp().ansi_to_html(text) };
  window.DOMPurify = DOMPurify;
  if (!window.nb) {
    await loadScript(notebookBundleUrl);
  }

  const notebook = window.nb.parse(ipynb);
  app.replaceChildren(notebook.render());
  setStatus('');
  document.title = notebook.title || 'Notebook preview';
  return notebook;
}

// The stack iframes this app and appends `embed=1`; a plain `window.self !==
// window.top` guard covers direct iframe uses. When standalone, offer a download.
function isEmbedded() {
  const embed = new URLSearchParams(window.location.search).get('embed');
  if (embed === '1' || embed === 'true') {
    return true;
  }
  return window.self !== window.top;
}

function showToolbar(url, title) {
  const filename = decodeURIComponent(new URL(url, window.location.href).pathname.split('/').pop());
  toolbarTitle.textContent = title || filename || '';
  toolbarDownload.href = url;
  toolbarDownload.download = filename || 'notebook.ipynb';
  toolbar.hidden = false;
}

const params = new URLSearchParams(window.location.search);
const url = params.get('url');
if (!url) {
  setStatus('Missing "url" query parameter.');
} else {
  renderNotebook(url)
    .then((notebook) => {
      if (!isEmbedded()) {
        showToolbar(url, notebook.title);
      }
    })
    .catch((error) => {
      setStatus(`Preview unavailable: ${error.message}`);
    });
}