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
 * Distro breaker labels: one landscape page per distro.
 * sheets: [{ title, subtitle, rows: [{ tag: { label, colour, via, bg, fg }, cells: [{ ch, meta, feeds: [{ pos, lines: [] }], load, spare, bg, fg }] }] }]
 */
export async function breakersPdf(sheets) {
  const JsPDF = await loadPdfLib();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const m = 8;
  sheets.forEach((sheet, si) => {
    if (si > 0) doc.addPage();
    doc.setTextColor('#111111');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
    doc.text(pdfText(sheet.title), m, m + 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor('#444444');
    doc.text(pdfText(sheet.subtitle), pageW - m, m + 8, { align: 'right' });
    doc.setDrawColor('#111111'); doc.setLineWidth(0.8); doc.line(m, m + 11, pageW - m, m + 11);

    const cols = Math.max(1, ...sheet.rows.map((r) => r.cells.length));
    const tagW = 34, gap = 2.5;
    const top = m + 15;
    const avail = pageH - top - m;
    const rowH = Math.min(52, (avail - gap * (sheet.rows.length - 1)) / Math.max(1, sheet.rows.length));
    const cellW = (pageW - m * 2 - tagW - gap * cols) / cols;
    const band = Math.min(11, rowH * 0.24);

    sheet.rows.forEach((row, ri) => {
      const y = top + ri * (rowH + gap);
      // run tag
      const t = row.tag;
      doc.setLineWidth(0.4); doc.setDrawColor('#111111');
      doc.setFillColor(t.bg || '#f2f2f2');
      doc.roundedRect(m, y, tagW, rowH, 2, 2, 'FD');
      doc.setTextColor(t.fg || '#111111');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      const cx = m + tagW / 2;
      doc.text(pdfText(t.label), cx, y + rowH / 2 - 3, { align: 'center' });
      if (t.colour) { doc.setFontSize(12); doc.text(pdfText(t.colour.toUpperCase()), cx, y + rowH / 2 + 3, { align: 'center' }); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      if (t.via) doc.text(pdfText(t.via), cx, y + rowH / 2 + 8, { align: 'center' });

      row.cells.forEach((c, ci) => {
        const x = m + tagW + gap + ci * (cellW + gap);
        doc.setFillColor('#ffffff'); doc.setDrawColor('#111111'); doc.setLineWidth(0.4);
        doc.roundedRect(x, y, cellW, rowH, 2, 2, 'FD');
        // coloured band: rounded top corners, square bottom edge
        doc.setFillColor(c.bg || '#e6e6e6');
        doc.roundedRect(x, y, cellW, band, 2, 2, 'F');
        doc.rect(x, y + band / 2, cellW, band / 2, 'F');
        doc.line(x, y + band, x + cellW, y + band);
        doc.roundedRect(x, y, cellW, rowH, 2, 2, 'S');
        doc.setTextColor(c.fg || '#111111');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(24, band * 2.3));
        doc.text(pdfText(c.ch), x + 2.5, y + band - 2.2);
        doc.setFontSize(9.5);
        doc.text(pdfText(c.meta), x + cellW - 2.5, y + band - 3, { align: 'right' });

        const innerW = cellW - 5;
        let ty = y + band + 5;
        const maxY = y + rowH - (c.load ? 6 : 2.5);
        doc.setTextColor('#111111');
        if (c.spare) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor('#999999');
          doc.text('SPARE', x + cellW / 2, y + band + (rowH - band) / 2 + 2, { align: 'center' });
        } else {
          for (const f of c.feeds) {
            if (ty > maxY) break;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
            doc.text(doc.splitTextToSize(pdfText(f.pos), innerW)[0], x + 2.5, ty);
            ty += 4.6;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
            for (const line of f.lines) {
              for (const part of doc.splitTextToSize(pdfText(line), innerW)) {
                if (ty > maxY) break;
                doc.text(part, x + 2.5, ty);
                ty += 4;
              }
            }
            ty += 1.2;
          }
        }
        if (c.load) {
          doc.setDrawColor('#cccccc'); doc.setLineWidth(0.2);
          doc.line(x, y + rowH - 5, x + cellW, y + rowH - 5);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor('#333333');
          doc.text(pdfText(c.load), x + 2.5, y + rowH - 1.6);
        }
      });
    });
  });
  return doc.output('blob');
}
