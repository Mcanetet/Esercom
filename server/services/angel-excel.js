const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const config = require('../config');

function ensureReportsDir(empresaSlug) {
  const slug = String(empresaSlug || 'shared').replace(/[^a-z0-9_-]/gi, '') || 'shared';
  const dir = path.join(config.dataDir, 'reportes', slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return { dir, slug };
}

function resolveReportFile(empresaSlug, filename) {
  const file = path.basename(String(filename || ''));
  if (!file || file !== String(filename) || !/\.xlsx$/i.test(file)) return null;
  const { dir, slug } = ensureReportsDir(empresaSlug);
  const full = path.join(dir, file);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(dir) + path.sep) && resolved !== path.resolve(dir)) {
    return null;
  }
  // Compat: archivos viejos en data/reportes/ plano
  if (!fs.existsSync(resolved)) {
    const legacy = path.join(config.dataDir, 'reportes', file);
    if (fs.existsSync(legacy) && file.startsWith(`AngelIA_${slug}_`)) {
      return { full: legacy, file, relative: `reportes/${file}` };
    }
    return null;
  }
  return { full: resolved, file, relative: `reportes/${slug}/${file}` };
}

async function buildExcelReport({ titulo, sheets, empresa }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Angel IA';
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(String(sheet.name || 'Hoja').slice(0, 31));
    if (!sheet.rows || !sheet.rows.length) {
      ws.addRow(['Sin datos']);
      continue;
    }
    const keys = sheet.columns || Object.keys(sheet.rows[0]);
    ws.addRow(keys);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0EA5E9' }
    };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    for (const row of sheet.rows) {
      ws.addRow(keys.map((k) => (row[k] == null ? '' : row[k])));
    }
    keys.forEach((_, i) => {
      ws.getColumn(i + 1).width = 16;
    });
  }

  const { dir, slug } = ensureReportsDir(empresa);
  const safe = String(titulo || 'reporte').replace(/[^\w\-]+/g, '_').slice(0, 40);
  const filename = `${safe}_${Date.now()}.xlsx`;
  const full = path.join(dir, filename);
  await wb.xlsx.writeFile(full);
  return {
    filename,
    fullPath: full,
    relative: `reportes/${slug}/${filename}`,
    empresa: slug
  };
}

module.exports = { buildExcelReport, ensureReportsDir, resolveReportFile };
