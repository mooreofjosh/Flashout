# Flashout

**Prep it. Patch it. Flash it out.**

Fixture prep, patching and power planning for live-event lighting crews. Runs in any modern browser on a phone, tablet or laptop, can be installed to the home screen, and works offline. No accounts. Data stays on the device, with JSON backup and restore.

## Features

Two layouts, picked by screen width (or set in Settings):

- **Phone: prep on the floor.** A gig opens on the prep checklist. A Fixtures lookup finds a unit by number, channel, address or name, and shows its details with its checklist to tick and its faults.
- **Laptop: the full toolkit.**
  - **Worksheet**: a spreadsheet of every fixture (position, unit, fixture, mode, address, channel, purpose, colour, gobo, accessories, rigging, circuit, prep, faults, notes). Click a cell and type to edit; Enter/Tab/arrows move; click headings to sort (shift-click for a second sort); filter; group by position; choose columns; select rows to bulk-change, renumber or delete; Ctrl/⌘+D fills down.
  - **Prep**: checklist per fixture (flown: clamps, safeties, ID sticker, addressed, power cable, flashed out; ground: ID sticker onward), editable lists, fault notes.
  - **Patch**: auto-addressing, clash and out-of-range checks, CSV export.
  - **Power**: distros (default 32A 3-phase → 12 × 10A on Socapex or Wieland), fixture power specs, drag-and-drop circuits, phase-balancing auto-assign, Socapex/Wieland run and breakout count.
  - **Paperwork**: patch sheet, channel hookup, colour & gobo pull list, A4 labels, power plan, distro rack plots (per-circuit unit numbers, short fixture types, Wieland/Socapex connector labels and loom colours, amps), fault report. Every one exports to PDF.
- **Fixture library**: 1,900+ built-in fixtures (converted from grandMA2 library exports), Open Fixture Library search, GDTF and OFL JSON import, manual entry. Whole rigs import from **MVR** files.

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
