#!/usr/bin/env node
const { initAll, closeAll } = require('./tenants');

console.log('Inicializando bases de datos ESERCOM multiempresa...\n');
const results = initAll();
for (const r of results) {
  console.log(`✓ ${r.name.padEnd(12)} → ${r.file}`);
  console.log(`  Admin: ${r.admin} / password`);
}
console.log('\nListo. Ejecute: npm start');
closeAll();
