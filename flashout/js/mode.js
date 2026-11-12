// Phone vs laptop layout. Phone: prep-focused. Laptop: full tools.
import * as store from './store.js';

const wide = window.matchMedia('(min-width: 900px)');

export function layoutSetting() {
  return store.getState().settings.layout || 'auto';
}

export function getMode() {
  const s = layoutSetting();
  if (s === 'phone' || s === 'laptop') return s;
  return wide.matches ? 'laptop' : 'phone';
}

export const isLaptop = () => getMode() === 'laptop';

// Calls fn when the effective mode changes (window resized past the breakpoint).
export function onModeChange(fn) {
  let last = getMode();
  const check = () => { const m = getMode(); if (m !== last) { last = m; fn(m); } };
  wide.addEventListener?.('change', check);
  return check;
}
