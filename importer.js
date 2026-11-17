'use strict';
/** Bulk registration import from Excel (.xlsx) or CSV. */
const ExcelJS = require('exceljs');
const { position } = require('../util');

function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

async function readRows(buffer, filename) {
  if (/\.csv$|\.txt$/i.test(filename)) return parseCsv(buffer.toString('utf8'));
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw Object.assign(new Error('Could not read that spreadsheet. Please upload an .xlsx or .csv file.'), { status: 400 }); }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = [];
    for (let c = 1; c <= r.cellCount; c++) vals.push(cellText(r.getCell(c).value));
    rows.push(vals);
  });
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

const HEADERS = {
  full_name: /^(full\s*name|student\s*name|name|player\s*name)$/i,
  class_grade: /^(class|grade|class\s*\/\s*grade|class\s*grade|section)$/i,
  primary_position: /^(preferred\s*(playing\s*)?position|primary\s*position|position|preferred)$/i,
  secondary_position: /^(secondary\s*(playing\s*)?position|second\s*position|secondary|alt(ernate)?\s*position)$/i,
  photo_file: /^(photo|photograph|photo\s*file|image|file)$/i,
};

/** Returns { rows: [{ line, full_name, class_grade, primary_position, secondary_position, photo_file, errors: [] }] } */
async function parseImport(buffer, filename) {
  const raw = await readRows(buffer, filename);
  if (!raw.length) return { rows: [], error: 'The file is empty.' };
  const hIndex = raw.findIndex((r) => r.some((c) => HEADERS.full_name.test(String(c).trim())));
  if (hIndex < 0) return { rows: [], error: 'Could not find a "Full Name" column. Please use the template.' };
  const header = raw[hIndex].map((c) => String(c).trim());
  const col = {};
  for (const [k, re] of Object.entries(HEADERS)) col[k] = header.findIndex((h) => re.test(h));
  const rows = raw.slice(hIndex + 1).map((r, i) => {
    const get = (k) => (col[k] >= 0 ? String(r[col[k]] ?? '').replace(/\s+/g, ' ').trim() : '');
    const out = { line: hIndex + i + 2, full_name: get('full_name'), class_grade: get('class_grade'), photo_file: get('photo_file'), errors: [] };
    if (out.full_name.length < 3) out.errors.push('Full name missing');
    if (out.full_name.length > 80) out.errors.push('Full name too long');
    if (!out.class_grade) out.errors.push('Class / Grade missing');
    try { out.primary_position = position(get('primary_position'), { name: 'Preferred position' }); } catch (e) { out.errors.push(e.message); }
    try { out.secondary_position = position(get('secondary_position'), { required: false }); } catch (e) { out.errors.push(e.message); }
    if (out.secondary_position === out.primary_position) out.secondary_position = null;
    return out;
  }).filter((r) => r.full_name || r.class_grade);
  return { rows };
}

module.exports = { parseImport, parseCsv };
