// Small UI helpers: escaping, dialogs, toasts, downloads.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2600);
}

// Modal sheet. `body` is HTML; `onOpen(root, close)` wires it up. Resolves with close(value).
export function sheet(title, body, onOpen) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></header>
        <div class="sheet-body">${body}</div>
      </div>`;
    const close = (value) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(undefined); });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    onOpen?.(wrap.querySelector('.sheet'), close);
    const first = wrap.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  });
}

export function confirmSheet(title, message, okLabel = 'OK', danger = false) {
  return sheet(title, `
    <p>${esc(message)}</p>
    <div class="row-end">
      <button class="btn" data-close>Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>
    </div>`, (root, close) => root.querySelector('[data-ok]').addEventListener('click', () => close(true)));
}

// Read a form's named fields into an object.
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; continue; }
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

// Saving files. Inside claude.ai the page may not download directly, so use the host's
// "downloads" capability there (the viewer confirms the save); anywhere else, a normal download.
let downloadsCap = null;
export function getDownloads() {
  if (!window.claude?.use) return Promise.resolve(null);
  downloadsCap ||= Promise.resolve(window.claude.use('downloads')).catch(() => null);
  return downloadsCap;
}

export async function saveFile(filename, data, mime = 'application/octet-stream') {
  const cap = await getDownloads();
  if (cap) {
    try {
      await cap.save({ filename, data });
      return 'saved';
    } catch (e) {
      if (e?.code === 'declined') return 'declined';
      if (e?.code === 'rate_limited') { toast('A save is already waiting for you to confirm', 'bad'); return 'busy'; }
      if (e?.code === 'too_large') { toast('That file is too large to save here', 'bad'); return 'failed'; }
      // anything else: fall back to a normal browser download below
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}

// Offer a generated text file: save it, or copy its contents.
export async function offerFile(filename, text, mime = 'text/plain') {
  await sheet('Export ' + filename, `
    <p class="muted">Save the file, or copy its contents to paste somewhere else.</p>
    <div class="row-end">
      <button class="btn" data-copy>Copy</button>
      <button class="btn primary" data-dl>Save file</button>
    </div>`, (root, close) => {
    root.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); toast('Copied'); close(); }
      catch { toast('Copy was blocked by the browser', 'bad'); }
    });
    root.querySelector('[data-dl]').addEventListener('click', async () => {
      const r = await saveFile(filename, text, mime);
      if (r === 'saved' || r === 'downloaded') close();
    });
  });
}

export function printNow() {
  try { window.print(); }
  catch { toast('Printing is blocked here. Open the app in its own browser tab to print.', 'bad'); }
}

export function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve(multiple ? [...input.files] : input.files[0] || null));
    input.click();
  });
}
