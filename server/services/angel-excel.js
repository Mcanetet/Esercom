const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const config = require('../config');

function ensureReportsDir() {
  const dir = path.join(config.dataDir, 'reportes');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildExcelReport({ titulo, sheets }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Angel IA';
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
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

  const dir = ensureReportsDir();
  const safe = String(titulo || 'reporte').replace(/[^\w\-]+/g, '_').slice(0, 40);
  const filename = `${safe}_${Date.now()}.xlsx`;
  const full = path.join(dir, filename);
  await wb.xlsx.writeFile(full);
  return { filename, fullPath: full, relative: `reportes/${filename}` };
}

module.exports = { buildExcelReport, ensureReportsDir };
