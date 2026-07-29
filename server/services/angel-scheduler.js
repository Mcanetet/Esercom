const cron = require('node-cron');
const config = require('../config');
const { getDb } = require('../db/tenants');
const { getConfig, syncAlerts, generateCecoExcel } = require('./angel');

let started = false;

function startAngelScheduler() {
  if (started) return;
  started = true;

  // Cada hora: sincroniza alertas de pendientes
  cron.schedule('15 * * * *', () => {
    for (const company of config.companies) {
      try {
        const db = getDb(company.slug);
        const r = syncAlerts(db);
        if (r.created > 0) {
          console.log(`[Angel IA] ${company.name}: ${r.created} alertas nuevas`);
        }
      } catch (err) {
        console.error(`[Angel IA] alertas ${company.slug}`, err.message);
      }
    }
  });

  // Diario 08:00 — si el día coincide con dia_reporte, genera Excel semanal
  cron.schedule('0 8 * * *', async () => {
    const today = new Date().getDay(); // 0 domingo … 1 lunes
    for (const company of config.companies) {
      try {
        const db = getDb(company.slug);
        const cfg = getConfig(db);
        if (!cfg?.reporte_semanal) continue;
        const dia = Number(cfg.dia_reporte ?? 1);
        if (dia !== today) continue;

        const result = await generateCecoExcel(db, company, null);
        console.log(`[Angel IA] Reporte semanal ${company.name}: ${result.filename}`);
        console.log(`[Angel IA] Destinatarios JP: ${(result.destinatarios || []).join(', ') || 'ninguno'}`);
      } catch (err) {
        console.error(`[Angel IA] reporte ${company.slug}`, err.message);
      }
    }
  });

  console.log('Angel IA scheduler activo (alertas horarias + reporte semanal)');
}

module.exports = { startAngelScheduler };
