#!/usr/bin/env node
/**
 * Crea/clona estructura MySQL por empresa desde SERCOM.
 *
 *   DB_DRIVER=mysql DB_PER_COMPANY=1 node scripts/create-company-dbs.js
 *   node scripts/create-company-dbs.js --only=global,nexus
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { cloneCompanyDatabases } = require('../server/services/clone-company-dbs');

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg
  ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  : null;

cloneCompanyDatabases({ only }).then((r) => {
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
