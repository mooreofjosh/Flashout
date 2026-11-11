#!/usr/bin/env python3
"""Convert a folder of grandMA2 fixture library exports into data/ma2-library.json.

Reads .xml files, .zip packages containing an .xml, and the names of encrypted .xmlp
files (manufacturer@fixture@mode@revision). Only facts needed for prep and patching
are kept: manufacturer, fixture name, mode names, DMX footprint, beam type.

Usage: python3 tools/convert_ma2.py <source folder> <output json>
"""
import json, os, re, sys, zipfile
from lxml import etree as ET
from urllib.parse import unquote

PARSER = ET.XMLParser(recover=True, huge_tree=True, resolve_entities=False, no_network=True)


def find(el, name):
    for c in el:
        if isinstance(c.tag, str) and tag(c) == name:
            return c
    return None


def walk(el, name):
    return (e for e in el.iter() if isinstance(e.tag, str) and tag(e) == name)


def tag(el):
    return ET.QName(el).localname


def clean(s):
    return re.sub(r'\s+', ' ', unquote(s or '').replace('_', ' ')).strip()


def footprint(ft):
    """Highest DMX channel used by the fixture's patched instances."""
    modules = {}
    mods = find(ft, 'Modules')
    for i, m in enumerate(c for c in (mods if mods is not None else []) if isinstance(c.tag, str) and tag(c) == 'Module'):
        top = 0
        for ct in walk(m, 'ChannelType'):
            for a in ('coarse', 'fine', 'ultra'):
                v = ct.get(a)
                if v and v.isdigit():
                    top = max(top, int(v))
        modules[m.get('index', str(i))] = top
    total = 0
    insts = find(ft, 'Instances')
    inst_list = [c for c in (insts if insts is not None else []) if isinstance(c.tag, str) and tag(c) == 'Instance']
    if not inst_list:  # older files: no instance list, one module at channel 1
        return max(modules.values(), default=0)
    for inst in inst_list:
        width = modules.get(inst.get('module_index', '0'), 0)
        if not width:
            continue
        patch = inst.get('patch')
        start = int(patch) if patch and patch.isdigit() else 1
        total = max(total, start - 1 + width)
    return total


def parse_xml(data, fallback_name):
    root = ET.fromstring(data, PARSER)
    if root is None:
        raise ValueError('unreadable XML')
    ft = next(walk(root, 'FixtureType'), None)
    if ft is None:
        raise ValueError('no FixtureType')
    man_el = find(ft, 'manufacturer')
    man = (man_el.text if man_el is not None else '') or ''
    man = man.strip()
    beams = sorted({m.get('beamtype') for m in walk(ft, 'Module') if m.get('beamtype') not in (None, '', 'None')})
    date = ''
    for info in walk(ft, 'Info'):
        date = max(date, info.get('date') or '')
    return {
        'manufacturer': man or fallback_name[0],
        'name': (ft.get('name') or '').strip() or fallback_name[1],
        'mode': (ft.get('mode') or '').strip() or fallback_name[2],
        'channels': footprint(ft),
        'named': channels_from_mode(ft.get('mode') or fallback_name[2]),
        'beam': beams[0] if len(beams) == 1 else '',
        'date': date,
        'exact': True,
    }


def parse_name(filename):
    base = re.sub(r'\.(xmlp?|zip)$', '', os.path.basename(filename), flags=re.I)
    parts = base.split('@')
    while len(parts) < 4:
        parts.append('')
    return [clean(p) for p in parts[:4]]


def channels_from_mode(mode):
    m = re.search(r'(\d{1,3})\s*-?\s*(?:ch|chan|channels?)\b', mode, re.I) or re.search(r'(\d{1,3})ch', mode, re.I)
    return int(m.group(1)) if m and 0 < int(m.group(1)) <= 512 else 0


SUFFIX = re.compile(r'\b(lighting|lights?|professional|pro|technologies|technology|inc|ltd|gmbh|co|company|group|international)\b')


def man_key(name):
    k = SUFFIX.sub(' ', name.lower().replace('_', ' '))
    k = re.sub(r'[^a-z0-9]', '', k)
    return k or re.sub(r'[^a-z0-9]', '', name.lower())


def main(src, out):
    entries, problems = [], []
    for dirpath, _, files in os.walk(src):
        if '.git' in dirpath:
            continue
        for fn in sorted(files):
            path = os.path.join(dirpath, fn)
            low = fn.lower()
            fallback = parse_name(fn)
            try:
                if low.endswith('.xml'):
                    with open(path, 'rb') as f:
                        entries.append(parse_xml(f.read(), fallback))
                elif low.endswith('.zip'):
                    with zipfile.ZipFile(path) as z:
                        xmls = [n for n in z.namelist() if n.lower().endswith('.xml') and '/' not in n.strip('/')]
                        if not xmls:
                            raise ValueError('no .xml inside zip')
                        for n in xmls:
                            entries.append(parse_xml(z.read(n), parse_name(n)))
                elif low.endswith('.xmlp'):
                    man, name, mode, _ = fallback
                    entries.append({'manufacturer': man, 'name': name, 'mode': mode or 'Default',
                                    'channels': channels_from_mode(mode), 'named': 0, 'beam': '', 'date': '', 'exact': False})
            except Exception as e:
                problems.append(f'{fn}: {e}')

    # Status per mode: 1 = counted from the file, 0 = taken from an encrypted file name,
    # 2 = file and mode name disagree (larger used: safer to over-reserve than to overlap).
    for e in entries:
        e['status'] = 1 if e['exact'] else 0
        if e['exact'] and e['named'] and e['named'] != e['channels']:
            e['status'] = 2 if e['channels'] else 1
            e['channels'] = max(e['channels'], e['named'])

    # Group by manufacturer + fixture, one mode each; prefer readable files, then newest revision.
    groups = {}
    for e in entries:
        key = (man_key(e['manufacturer']), re.sub(r'[^a-z0-9]', '', e['name'].lower()))
        g = groups.setdefault(key, {'manufacturer': e['manufacturer'], 'name': e['name'], 'beam': e['beam'], 'modes': {}})
        if len(e['manufacturer']) > len(g['manufacturer']):
            g['manufacturer'] = e['manufacturer']
        if e['beam'] and not g['beam']:
            g['beam'] = e['beam']
        mk = re.sub(r'[^a-z0-9]', '', e['mode'].lower())
        cur = g['modes'].get(mk)
        better = cur is None or (e['exact'], e['date']) > (cur['exact'], cur['date'])
        if better:
            g['modes'][mk] = e

    # One display spelling per manufacturer: the most common, preferring mixed case.
    from collections import Counter
    spellings = {}
    for e in entries:
        spellings.setdefault(man_key(e['manufacturer']), Counter())[e['manufacturer'].replace('_', ' ').strip()] += 1
    for g in groups.values():
        c = spellings[man_key(g['manufacturer'])]
        g['manufacturer'] = max(c, key=lambda n: (n != n.upper() and n != n.lower(), c[n], len(n)))

    out_list = []
    for g in sorted(groups.values(), key=lambda g: (g['manufacturer'].lower(), g['name'].lower())):
        modes = sorted(g['modes'].values(), key=lambda m: (m['channels'] or 9999, m['mode'].lower()))
        # [manufacturer, name, beam, [[mode, channels, exact(1/0)], ...]]
        out_list.append([g['manufacturer'], g['name'], g['beam'],
                         [[m['mode'], m['channels'], m['status']] for m in modes]])

    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'source': 'grandMA2 fixture library export', 'fixtures': out_list}, f, ensure_ascii=False, separators=(',', ':'))

    modes = sum(len(x[3]) for x in out_list)
    exact = sum(1 for x in out_list for m in x[3] if m[2])
    check = sum(1 for x in out_list for m in x[3] if m[2] == 2)
    print(f'{check} modes where file and mode name disagree (flagged)')
    unknown = sum(1 for x in out_list for m in x[3] if not m[1])
    print(f'{len(entries)} files read -> {len(out_list)} fixtures, {modes} modes '
          f'({exact} exact, {modes - exact} from encrypted file names, {unknown} with unknown channel count)')
    print(f'{len(problems)} problems')
    for p in problems[:30]:
        print('  ', p)
    print(f'output {os.path.getsize(out) / 1024:.0f} KB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
