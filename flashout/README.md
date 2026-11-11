# Flashout

**Prep it. Patch it. Flash it out.**

Fixture prep, patching and power planning for live-event lighting crews. Runs in any modern browser on a phone, tablet or laptop, can be installed to the home screen, and works offline. No accounts. Data stays on the device, with JSON backup and restore.

## Features

- **Gigs**: venue, client, date and notes. Copy a previous gig as a starting point.
- **Fixture library**: 1,900+ built-in fixtures (converted from grandMA2 library exports), Open Fixture Library search, GDTF and OFL JSON import, or manual entry.
- **Rig**: add fixtures by position, flown or ground. Import a whole rig from an **MVR** file (Vectorworks, grandMA3, Capture…).
- **Prep**: a checklist on each fixture (flown: clamps, safeties, ID sticker, addressed, power cable, flashed out; ground: ID sticker onward). Lists are editable, and fault notes are kept per unit.
- **Patch**: auto-addressing, clash and out-of-range checks, CSV export.
- **Power**: distros (default 32A 3-phase → 12 × 10A on Socapex or Wieland), drag-and-drop circuit assignment, auto-assign that balances phases and keeps multicore runs to one position, load warnings, multicore run and breakout count.
- **Print**: patch sheets, A4 labels (21 per sheet), power plan with multicore pull list, fault report.

## Running it

No build step. Serve this `flashout` folder with any static web server:

```bash
cd flashout
python3 -m http.server 8000
```

Then open http://localhost:8000. To host it with GitHub Pages, publish this folder, for example with a Pages workflow that uploads `flashout/`.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html`, `css/`, `icons/`, `manifest.webmanifest`, `sw.js` | App shell, styles, icons, install and offline support |
| `js/app.js` | Router |
| `js/store.js` | Local storage, backup and restore |
| `js/patch.js` | DMX addressing and clash detection |
| `js/power.js` | Power maths, auto-assign, multicore count |
| `js/fixtures.js`, `js/zip.js` | GDTF / Open Fixture Library import |
| `js/mvr.js` | MVR import |
| `js/builtin.js`, `data/ma2-library.json` | Built-in fixture library |
| `js/views/` | Screens |
| `tools/convert_ma2.py` | Rebuilds `data/ma2-library.json` from a folder of grandMA2 fixture exports |

## Rebuilding the fixture library

The grandMA2 exports are in the folders next to `flashout/` in this repository. From inside `flashout/`:

```bash
pip install lxml
python3 tools/convert_ma2.py .. data/ma2-library.json
```

Encrypted `.xmlp` files only provide manufacturer, fixture and mode names. Their channel counts are marked unknown, and the app asks you to confirm them.

Always check channel counts and power figures against the manufacturer's manual and the venue's supply.
