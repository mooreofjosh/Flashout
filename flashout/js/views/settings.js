import * as store from '../store.js';
import { esc, toast, offerFile, pickFile, confirmSheet } from '../ui.js';
import { refresh } from '../app.js';
import { fixtureFromFile } from '../fixtures.js';

export const settingsView = {
  render() {
    const s = store.getState();
    const { checklists } = s.settings;
    return {
      title: 'Settings',
      section: 'settings',
      html: `
        <section class="card">
          <h3>Sync</h3>
          <p class="small" data-sync-text>…</p>
          <p class="muted small">Open Flashout on your phone and laptop while signed in to Claude, and your gigs, fixture library and settings stay in step. Each device keeps its own copy, so it keeps working with no signal and catches up when it's back online. Changes on both devices are merged; only an edit to the same field on both at once takes the newer one. Your layout choice stays per device.</p>
          <div class="toolbar"><button class="btn" data-action="syncNow">Sync now</button></div>
        </section>
        <section class="card">
          <h3>Fixture library</h3>
          <p class="muted small">Fixtures you've added to gigs are saved here, so their modes and power specs are ready next time. You don't need to come here to add fixtures: <strong>+ Add fixtures</strong> in a gig searches everything.</p>
          <p class="small">${s.fixtureTypes.length} saved fixture${s.fixtureTypes.length === 1 ? '' : 's'}${(() => { const n = s.fixtureTypes.filter((t) => t.modes.some((m) => !m.channels || m.check) || !(t.powerW || t.currentA)).length; return n ? ` · <span class="warn-text">${n} missing channel counts or power specs</span>` : ''; })()}</p>
          <div class="toolbar">
            <a class="btn primary" href="#library">Manage fixtures</a>
            <button class="btn" data-action="importFixtures">Import fixture files (.gdtf / .json)</button>
          </div>
        </section>
        <section class="card">
          <h3>Layout</h3>
          <p class="muted small">Phone layout is for prep on the floor. Laptop layout has the worksheet, patch, power and paperwork. Automatic picks by screen width.</p>
          <fieldset class="seg" aria-label="Layout">
            ${[['auto', 'Automatic'], ['phone', 'Phone'], ['laptop', 'Laptop']].map(([v, l]) => `<label><input type="radio" name="layout" value="${v}" data-change="layout" ${(s.settings.layout || 'auto') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
          </fieldset>
        </section>
        <section class="card">
          <h3>Prep checklists</h3>
          <p class="muted small">One item per line. Each fixture gets the list for how it's rigged.</p>
          <form class="form" data-checklists>
            <div class="grid2">
              <label>Flown<textarea name="flown" rows="7">${esc(checklists.flown.join('\n'))}</textarea></label>
              <label>Ground<textarea name="ground" rows="7">${esc(checklists.ground.join('\n'))}</textarea></label>
            </div>
            <div class="row-split">
              <button type="button" class="btn" data-action="resetLists">Reset to defaults</button>
              <button class="btn primary">Save checklists</button>
            </div>
          </form>
        </section>
        <section class="card">
          <h3>Backup</h3>
          <p class="muted small">Your gigs and fixture library are saved only in this browser on this device. Export a backup now and then, or to move to another device.</p>
          <p class="small">${s.gigs.length} gigs · ${s.fixtureTypes.length} fixtures in library ${store.isPersistent() ? '' : '· <span class="bad-text">not saving in this browser</span>'}</p>
          <div class="toolbar">
            <button class="btn primary" data-action="backup">Export backup</button>
            <button class="btn" data-action="restore">Restore from backup</button>
          </div>
        </section>
        <section class="card">
          <h3>About</h3>
          <p class="muted small">Flashout: fixture prep, patch and paperwork for live events. Fixture data comes from the built-in library (converted from grandMA2 fixture files), <a href="https://open-fixture-library.org" target="_blank" rel="noopener">Open Fixture Library</a> and GDTF files. Always check channel counts and power figures against the manufacturer's manual.</p>
        </section>`,
      mount(root) {
        import('../sync.js').then(({ getSyncStatus, onSyncStatus }) => {
          const el = root.querySelector('[data-sync-text]');
          const draw = (st) => {
            if (!el.isConnected) return;
            const words = { synced: '✓ Synced', syncing: 'Syncing…', connecting: 'Connecting…', offline: 'Offline', signedout: 'Not syncing', error: 'Sync problem', unavailable: 'Not available', off: 'Not started' };
            el.textContent = `${words[st.state] || st.state}${st.lastSync ? ` · last synced ${new Date(st.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}${st.detail ? ` · ${st.detail}` : ''}`;
          };
          draw(getSyncStatus());
          onSyncStatus(draw);
        });
        root.querySelector('[data-checklists]').addEventListener('submit', (e) => {
          e.preventDefault();
          const lines = (t) => [...new Set(t.split('\n').map((x) => x.trim()).filter(Boolean))];
          s.settings.checklists = { flown: lines(e.target.flown.value), ground: lines(e.target.ground.value) };
          store.save();
          toast('Checklists saved');
          refresh();
        });
      },
      actions: {
        async importFixtures() {
          const files = await pickFile('.gdtf,.json,.zip', true);
          let added = 0;
          for (const file of files || []) {
            try { const before = s.fixtureTypes.length; store.addType(await fixtureFromFile(file)); if (s.fixtureTypes.length > before) added++; }
            catch (err) { toast(`${file.name}: ${err.message}`, 'bad'); }
          }
          if (added) toast(`Added ${added} fixture${added > 1 ? 's' : ''} to your library`);
          refresh();
        },
        syncNow() { import('../sync.js').then((m) => { m.syncNow(); toast('Syncing…'); }); },
        layout(el) { s.settings.layout = el.value; store.save(); refresh(); },
        resetLists() {
          s.settings.checklists = structuredClone(store.DEFAULT_CHECKLISTS);
          store.save();
          toast('Checklists reset');
          refresh();
        },
        backup() {
          const date = new Date().toISOString().slice(0, 10);
          offerFile(`flashout-backup-${date}.json`, JSON.stringify(store.getState(), null, 1), 'application/json');
        },
        async restore() {
          const file = await pickFile('.json,application/json');
          if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            if (!(await confirmSheet('Restore backup?', `Replace everything in the app with this backup (${data.gigs?.length ?? 0} gigs, ${data.fixtureTypes?.length ?? 0} fixtures)?`, 'Restore', true))) return;
            store.replaceAll(data);
            toast('Backup restored');
            refresh();
          } catch (err) { toast(err.message || 'Could not read that file', 'bad'); }
        },
      },
    };
  },
};
