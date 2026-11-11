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

// Offer a generated file. Falls back to copy-to-clipboard where downloads are blocked.
export async function offerFile(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  await sheet('Export ' + filename, `
    <p class="muted">Save the file, or copy its contents to paste somewhere else.</p>
    <div class="row-end">
      <button class="btn" data-copy>Copy</button>
      <a class="btn primary" href="${url}" download="${esc(filename)}" data-dl>Download</a>
    </div>`, (root, close) => {
    root.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); toast('Copied'); close(); }
      catch { toast('Copy was blocked by the browser', 'bad'); }
    });
    root.querySelector('[data-dl]').addEventListener('click', () => setTimeout(close, 300));
  });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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
