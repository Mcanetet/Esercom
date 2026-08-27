/**
 * Auto-await para llamadas .get/.all/.run/.exec sobre prepare()
 * y convierte handlers Express a async.
 * Uso: node scripts/awaitify-db.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'server');
const FILES = [
  'middleware/auth.js',
  'routes/auth.js',
  'routes/catalogos.js',
  'routes/solicitudes.js',
  'routes/modules.js',
  'routes/angel.js',
  'services/angel.js',
  'services/angel-data.js',
  'services/angel-scheduler.js'
];

function awaitify(src) {
  let s = src;

  // router.(get|post|put|delete|use)(path, (req, res) =>  → async
  s = s.replace(
    /(router\.(get|post|put|patch|delete|use)\(\s*[^,]+,\s*)\((req,\s*res)/g,
    '$1async ($2'
  );
  // function authRequired(req, res, next) → async
  s = s.replace(
    /function\s+(authRequired|adminRequired)\s*\(\s*req,\s*res/g,
    'async function $1(req, res'
  );

  // await already present? skip double
  // db.prepare(...).get( → await db.prepare(...).get(
  // req.db.prepare
  // patterns without await before them
  const chains = [
    /(\s|=|\(|,)(?!\s*await\s)((?:req\.)?db\.prepare\([^;]*?\)\.(?:get|all|run)\()/gs,
    /(\s|=|\(|,)(?!\s*await\s)((?:req\.)?db\.exec\()/g,
  ];

  // Simpler line-based approach for prepare().get/all/run
  s = s.replace(/^([ \t]*)(?!.*await)(.*?\b(?:req\.)?db\.prepare\([\s\S]*?\)\.(get|all|run)\()/gm, (match, indent, rest) => {
    if (/\bawait\b/.test(match)) return match;
    // multiline prepare - hard; handle single-line first
    return match;
  });

  // Global replace for common patterns
  s = s.replace(/(?<!await )(?<!await\n)(req\.db\.prepare\()/g, 'await req.db.prepare(');
  s = s.replace(/(?<!await )(?<!await\n)(\bdb\.prepare\()/g, 'await db.prepare(');
  s = s.replace(/(?<!await )(req\.db\.exec\()/g, 'await req.db.exec(');
  s = s.replace(/(?<!await )(\bdb\.exec\()/g, 'await db.exec(');

  // Fix double await
  s = s.replace(/await\s+await\s+/g, 'await ');

  // transaction calls: const tx = ...; const id = tx(); → await tx()
  s = s.replace(/(\bconst\s+\w+\s*=\s*tx\s*\(\s*\))/g, 'await $1'.replace('await const', 'const'));
  s = s.replace(/=\s*tx\(\)/g, '= await tx()');
  s = s.replace(/\breturn\s+tx\(\)/g, 'return await tx()');

  return s;
}

for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.warn('skip', rel);
    continue;
  }
  const before = fs.readFileSync(file, 'utf8');
  const after = awaitify(before);
  fs.writeFileSync(file, after);
  console.log('updated', rel, before === after ? '(no change)' : '');
}
