import { marked } from 'marked';
import { AnsiUp } from 'ansi_up';
import DOMPurify from 'dompurify';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism.css';
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
  const root = notebook.render();
  collapseHiddenInputs(notebook);
  highlightCode(root);
  app.replaceChildren(root);
  setStatus('');
  document.title = notebook.title || 'Notebook preview';
  return notebook;
}

// Code cells tagged `hide_input` get their input collapsed behind a toggle
// (native <details> marker gives the "> / v" arrow, like a JupyterLab fold).
// Outputs, if any, stay visible.
function collapseHiddenInputs(notebook) {
  for (const sheet of notebook.worksheets) {
    for (const cell of sheet.cells) {
      if (cell.type !== 'code') continue;
      const tags = cell.raw?.metadata?.tags ?? [];
      if (!tags.includes('hide_input')) continue;
      const input = cell.el?.querySelector('.nb-input');
      if (!input) continue;
      const details = document.createElement('details');
      details.className = 'nb-collapsed';
      details.append(summaryFor(cell), input.cloneNode(true));
      input.replaceWith(details);
    }
  }
}

// notebookjs ships without a highlighter; tokenize every code cell with Prism.
function highlightCode(root) {
  for (const code of root.querySelectorAll('pre code[data-language]')) {
    const lang = code.getAttribute('data-language');
    if (!Prism.languages[lang]) continue;
    code.classList.add(`language-${lang}`);
    Prism.highlightElement(code);
  }
}

function summaryFor(cell) {
  const raw = Array.isArray(cell.raw.source) ? cell.raw.source.join('') : cell.raw.source;
  const line = ((raw.split('\n').find((l) => l.trim()) || 'Code').trim());
  const summary = document.createElement('summary');
  const arrow = document.createElement('span');
  arrow.className = 'nb-fold-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '>';
  const label = line.length > 80 ? `${line.slice(0, 80)}…` : line;
  summary.append(arrow, label);
  const foldMarker = document.createElement('span');
  foldMarker.className = 'nb-fold-marker';
  foldMarker.setAttribute('aria-hidden', 'true');
  foldMarker.textContent = '…';
  summary.append(foldMarker);
  return summary;
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