// PDF export: vector PDFs drawn with jsPDF (bundled in vendor/, loaded on first use).

let libPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the PDF library'));
    document.head.append(s);
  });
}

export function loadPdfLib() {
  libPromise ||= (async () => {
    if (!window.jspdf) await loadScript(new URL('../vendor/jspdf.umd.min.js', import.meta.url).href);
    await loadScript(new URL('../vendor/jspdf.plugin.autotable.min.js', import.meta.url).href);
    return window.jspdf.jsPDF;
  })();
  libPromise.catch(() => { libPromise = null; });
  return libPromise;
}

// The built-in PDF fonts use Windows-1252: keep what they can show, swap the rest.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const SWAP = { '→': '->', '←': '<-', '✓': 'OK', '⚠': '!', '×': 'x', '≥': '>=', '≤': '<=', '−': '-' };
export function pdfText(v) {
  return String(v ?? '').replace(/[\s\S]/gu, (ch) => {
    if (SWAP[ch]) return SWAP[ch];
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10) return ch;
    if (c >= 32 && c < 127) return ch;
    if (c >= 160 && c <= 255) return ch;
    if (CP1252_EXTRA.includes(ch)) return ch;
    return '?';
  });
}

const GREY = '#555555';

function header(doc, { title, gigName, subtitle }, margin) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor('#111111');
  doc.text(pdfText(gigName || 'Flashout'), margin, margin + 5);
  doc.setFontSize(12);
  doc.text(pdfText(title), doc.internal.pageSize.getWidth() - margin, margin + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(GREY);
  if (subtitle) doc.text(pdfText(subtitle), margin, margin + 10.5);
  doc.setDrawColor('#111111');
  doc.setLineWidth(0.5);
  doc.line(margin, margin + 13, doc.internal.pageSize.getWidth() - margin, margin + 13);
  return margin + 19;
}

function footer(doc, margin) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor('#888888');
    const h = doc.internal.pageSize.getHeight();
    const w = doc.internal.pageSize.getWidth();
    doc.text(`Flashout · ${new Date().toLocaleDateString()}`, margin, h - 6);
    doc.text(`Page ${i} of ${n}`, w - margin, h - 6, { align: 'right' });
  }
}

/**
 * Tables document (patch sheet, power plan, fault report).
 * model: { title, gigName, subtitle, orientation, sections: [{ heading?, note?, head?, body?, columnStyles? }] }
 */
export async function tablesPdf(model) {
  const JsPDF = await loadPdfLib();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: model.orientation || 'portrait' });
  const margin = 12;
  let y = header(doc, model, margin);
  const pageH = doc.internal.pageSize.getHeight();
  for (const s of model.sections) {
    if (y > pageH - 30) { doc.addPage(); y = margin; }
    if (s.heading) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor('#111111');
      doc.text(pdfText(s.heading), margin, y + 4);
      y += 7;
    }
    if (s.note) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor('#333333');
      const lines = doc.splitTextToSize(pdfText(s.note), doc.internal.pageSize.getWidth() - margin * 2);
      doc.text(lines, margin, y + 3.5);
      y += lines.length * 4.4 + 2;
    }
    if (s.head && s.body) {
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin, bottom: 14 },
        head: [s.head.map(pdfText)],
        body: s.body.map((r) => r.map((c) => pdfText(c))),
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.4, textColor: '#111111', lineColor: '#9a9a9a', lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: '#e8e8e8', textColor: '#111111', fontStyle: 'bold' },
        columnStyles: s.columnStyles || {},
      });
      y = doc.lastAutoTable.finalY + 7;
    }
  }
  footer(doc, margin);
  return doc.output('blob');
}

/**
 * A4 label sheet, 3 × 7 (63.5 × 38.1 mm, e.g. Avery L7160 / J8160).
 * labels: [{ unit, addr, name, line1, line2 }]
 */
export async function labelsPdf(labels, { outlines = false } = {}) {
  const JsPDF = await loadPdfLib();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = 63.5, H = 38.1, left = 7.2, top = 15.15, pitchX = 66.04, pitchY = 38.1, pad = 3.5;
  labels.forEach((l, i) => {
    const onPage = i % 21;
    if (i > 0 && onPage === 0) doc.addPage();
    const x = left + (onPage % 3) * pitchX;
    const y = top + Math.floor(onPage / 3) * pitchY;
    if (outlines) { doc.setDrawColor('#bbbbbb'); doc.setLineWidth(0.2); doc.roundedRect(x, y, W, H, 2.5, 2.5); }
    doc.setTextColor('#111111');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text(pdfText(l.unit || '-'), x + pad, y + pad + 8);
    doc.setFont('courier', 'bold');
    doc.setFontSize(18);
    doc.text(pdfText(l.addr), x + W - pad, y + pad + 7, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(doc.splitTextToSize(pdfText(l.name), W - pad * 2)[0] || '', x + pad, y + 19);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor('#333333');
    if (l.line1) doc.text(doc.splitTextToSize(pdfText(l.line1), W - pad * 2)[0], x + pad, y + 24.5);
    if (l.line2) doc.text(doc.splitTextToSize(pdfText(l.line2), W - pad * 2)[0], x + pad, y + 29);
  });
  return doc.output('blob');
}

/**
 * Distro rack plot: landscape A4, as many racks per page as fit.
 * racks: [{ title, viaLabel, cols: [{ label, phase, units: [], type, tag, amps, bg, fg }] }]
 */
export async function racksPdf(racks, { gigName = '', subtitle = '' } = {}) {
  const JsPDF = await loadPdfLib();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const m = 8;
  const headW = 24;
  const rows = { title: 9, circuit: 6.5, units: 12, type: 5.5, tag: 6, amps: 5.5 };
  const blockH = Object.values(rows).reduce((a, b) => a + b, 0);
  const gap = 4;
  let y = m + 7;

  const pageHeader = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor('#111111');
    doc.text(pdfText(gigName ? `${gigName} · Distro racks` : 'Distro racks'), m, m + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor('#555555');
    if (subtitle) doc.text(pdfText(subtitle), pageW - m, m + 3, { align: 'right' });
  };
  // Text centred in a cell, shrunk until it fits the width.
  const fit = (text, cx, cy, w, size, bold = true) => {
    const t = pdfText(text);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    let s = size;
    doc.setFontSize(s);
    while (s > 4.5 && doc.getTextWidth(t) > w - 1.5) { s -= 0.5; doc.setFontSize(s); }
    doc.text(t, cx, cy, { align: 'center', baseline: 'middle' });
  };
  const cell = (x, yy, w, h, fill) => {
    doc.setDrawColor('#000000'); doc.setLineWidth(0.25);
    if (fill) { doc.setFillColor(fill); doc.rect(x, yy, w, h, 'FD'); } else doc.rect(x, yy, w, h, 'S');
  };

  pageHeader();
  racks.forEach((r) => {
    if (y + blockH > pageH - m) { doc.addPage(); pageHeader(); y = m + 7; }
    const n = Math.max(1, r.cols.length);
    const colW = (pageW - m * 2 - headW) / n;
    const x0 = m + headW;
    // title row: name over each half, underlined
    doc.setTextColor('#000000');
    const halves = n > 6 ? [[0, Math.ceil(n / 2)], [Math.ceil(n / 2), n]] : [[0, n]];
    for (const [a, b] of halves) {
      const cx = x0 + ((a + b) / 2) * colW;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
      const t = pdfText(r.title);
      doc.text(t, cx, y + rows.title / 2 + 0.5, { align: 'center', baseline: 'middle' });
      const tw = doc.getTextWidth(t);
      doc.setLineWidth(0.4); doc.line(cx - tw / 2, y + rows.title - 0.8, cx + tw / 2, y + rows.title - 0.8);
    }
    let yy = y + rows.title;
    const rowDefs = [
      ['circuit', 'Circuit'], ['units', 'Unit No'], ['type', 'Type'], ['tag', r.viaLabel], ['amps', 'Amps'],
    ];
    for (const [key, label] of rowDefs) {
      const h = rows[key];
      const dark = key === 'circuit';
      cell(m, yy, headW, h, dark ? '#111111' : '#ffffff');
      doc.setTextColor(dark ? '#ffffff' : '#000000');
      fit(label, m + headW / 2, yy + h / 2, headW, 10);
      r.cols.forEach((c, i) => {
        const x = x0 + i * colW;
        const coloured = (key === 'units' || key === 'tag') && c.bg;
        cell(x, yy, colW, h, dark ? '#111111' : coloured ? c.bg : '#ffffff');
        doc.setTextColor(dark ? '#ffffff' : coloured ? c.fg : '#000000');
        const cx = x + colW / 2;
        if (key === 'circuit') fit(c.label + (c.phase ? `  ${c.phase}` : ''), cx, yy + h / 2, colW, 10);
        else if (key === 'units') {
          const lines = c.units.length ? c.units : [''];
          const lh = Math.min(5, (h - 1) / lines.length);
          lines.slice(0, 3).forEach((u, li) => fit(u, cx, yy + h / 2 + (li - (Math.min(lines.length, 3) - 1) / 2) * lh, colW, lines.length > 1 ? 9.5 : 11));
        } else if (key === 'type') fit(c.type, cx, yy + h / 2, colW, 7);
        else if (key === 'tag') fit(c.tag, cx, yy + h / 2, colW, 10);
        else fit(c.amps, cx, yy + h / 2, colW, 8.5, false);
      });
      yy += h;
    }
    y += blockH + gap;
  });
  return doc.output('blob');
}
