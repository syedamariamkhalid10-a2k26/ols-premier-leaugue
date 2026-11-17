'use strict';
/** Generic table export to Excel (.xlsx), CSV and PDF. */
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const cfg = require('../config');

const LOGO = path.join(cfg.ROOT, 'public', 'img', 'ols-logo.png');
const NAVY = '#1B2A4A';
const RED = '#E2434B';

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // protect against spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value ? c.value(r) : r[c.key])).join(','));
  return '﻿' + lines.join('\r\n');
}

async function toXlsx({ title, sheets }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OLS Premier League';
  wb.created = new Date();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31));
    ws.addRow([sh.title || title]).font = { bold: true, size: 14, color: { argb: 'FF1B2A4A' } };
    if (sh.subtitle) ws.addRow([sh.subtitle]).font = { italic: true, color: { argb: 'FF5A6474' } };
    ws.addRow([]);
    const head = ws.addRow(sh.columns.map((c) => c.label));
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2A4A' } };
      cell.alignment = { vertical: 'middle' };
    });
    for (const r of sh.rows) {
      ws.addRow(sh.columns.map((c) => {
        const v = c.value ? c.value(r) : r[c.key];
        return v === undefined ? null : v;
      }));
    }
    sh.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || Math.max(10, Math.min(40, c.label.length + 6)); });
    ws.views = [{ state: 'frozen', ySplit: head.number }];
  }
  return wb.xlsx.writeBuffer();
}

function toPdf({ title, subtitle, sections }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'portrait', bufferPages: true, info: { Title: title, Author: 'OLS Premier League' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 72;

    const header = () => {
      try { doc.image(LOGO, 36, 26, { height: 30 }); } catch { /* logo optional */ }
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text('OLS PREMIER LEAGUE', 36, 30, { width: W, align: 'right' });
      doc.fillColor(RED).font('Helvetica').fontSize(7.5).text('BUILDING AL-QAWIYY, AL-AMEEN MUSLIMS', 36, 44, { width: W, align: 'right' });
      doc.moveTo(36, 62).lineTo(36 + W, 62).lineWidth(1).strokeColor(RED).stroke();
      doc.y = 72;
    };
    header();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(title, 36, doc.y);
    if (subtitle) doc.fillColor('#5A6474').font('Helvetica').fontSize(9).text(subtitle);
    doc.moveDown(0.6);

    for (const sec of sections) {
      if (sec.heading) {
        if (doc.y > doc.page.height - 120) { doc.addPage(); header(); }
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(sec.heading, 36, doc.y);
        doc.moveDown(0.3);
      }
      if (sec.lines) {
        doc.font('Helvetica').fontSize(9.5).fillColor('#222');
        for (const l of sec.lines) doc.text(l, 36, doc.y, { width: W });
        doc.moveDown(0.6);
      }
      if (sec.columns) {
        const cols = sec.columns;
        const totalW = cols.reduce((s, c) => s + (c.pdfWidth || 1), 0);
        const widths = cols.map((c) => ((c.pdfWidth || 1) / totalW) * W);
        const drawHead = () => {
          const y = doc.y;
          doc.rect(36, y, W, 16).fill(NAVY);
          let x = 36;
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff');
          cols.forEach((c, i) => { doc.text(c.label, x + 3, y + 4, { width: widths[i] - 6, lineBreak: false, ellipsis: true }); x += widths[i]; });
          doc.y = y + 16;
        };
        drawHead();
        doc.font('Helvetica').fontSize(8).fillColor('#222');
        sec.rows.forEach((r, ri) => {
          if (doc.y > doc.page.height - 50) { doc.addPage(); header(); drawHead(); doc.font('Helvetica').fontSize(8); }
          const y = doc.y;
          if (ri % 2) doc.rect(36, y, W, 14).fill('#F1F3F7');
          doc.fillColor('#222');
          let x = 36;
          cols.forEach((c, i) => {
            const v = c.value ? c.value(r) : r[c.key];
            const txt = v === null || v === undefined ? '' : (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
            doc.text(txt, x + 3, y + 3, { width: widths[i] - 6, lineBreak: false, ellipsis: true });
            x += widths[i];
          });
          doc.y = y + 14;
        });
        if (!sec.rows.length) doc.fillColor('#777').text('No records.', 36, doc.y + 3);
        doc.moveDown(1);
      }
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#8A93A3').fontSize(7).font('Helvetica')
        .text(`Generated ${new Date().toLocaleString('en-GB', { timeZone: process.env.TZ || 'Asia/Karachi' })}  ·  Page ${i + 1} of ${range.count}`,
          36, doc.page.height - 28, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

/** Send a single table in the requested format. */
async function sendTable(res, format, { filename, title, subtitle, columns, rows, extraSections = [] }) {
  const safe = filename.replace(/[^a-z0-9_-]+/gi, '-');
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.csv"`);
    return res.send(toCsv(columns, rows));
  }
  if (format === 'pdf') {
    const buf = await toPdf({ title, subtitle, sections: [...extraSections, { columns, rows }] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
    return res.send(buf);
  }
  const buf = await toXlsx({ title, sheets: [{ name: title, title, subtitle, columns, rows }] });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.xlsx"`);
  return res.send(Buffer.from(buf));
}

module.exports = { toCsv, toXlsx, toPdf, sendTable, csvCell };
