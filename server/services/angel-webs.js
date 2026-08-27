/**
 * Webs oficiales del grupo — configurable en BD + extracción al cerebro de Angel.
 */
const TABLE = 'angel_ia_conocimiento_docs';
const WEBS_TABLE = 'angel_ia_webs_empresas';

const DEFAULT_COMPANY_WEBS = [
  {
    id: 'sercom',
    nombre: 'SERCOM',
    urls: ['https://www.serviciossercom.cl'],
    emails: [],
    orden: 10
  },
  {
    id: 'tactica',
    nombre: 'TÁCTICA',
    urls: ['https://www.tacticaooh.com'],
    emails: [],
    orden: 20
  },
  {
    id: 'global',
    nombre: 'GLOBAL',
    urls: ['https://www.globalviapublica.cl', 'https://www.globalviapublica.com'],
    emails: ['corporativo@globalviapublica.cl', 'corporativo@globalviapublica.com'],
    orden: 30
  },
  {
    id: 'intercanje',
    nombre: 'INTERCANJE',
    urls: ['https://www.intercanje.cl', 'https://www.intercanje.com'],
    emails: [],
    orden: 40
  },
  {
    id: 'nexus',
    nombre: 'NEXUS',
    urls: ['https://www.nexusmedialatam.com'],
    emails: [],
    orden: 50
  }
];

/** @deprecated usar listCompanyWebs(db) — se mantiene por compatibilidad de imports */
const COMPANY_WEBS = DEFAULT_COMPANY_WEBS;

const CONTACT_PATHS = [
  '/contacto',
  '/contacto/',
  '/contact',
  '/contact/',
  '/contactanos',
  '/contáctanos',
  '/contacto-sercom',
  '/contacto-sercom/',
  '/escribenos',
  '/contact-us'
];

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const BAD_EMAIL_RE = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ico|map)(\?|$)/i;

function slugifyId(nombre, fallback = 'empresa') {
  const s = String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback;
}

function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  try {
    const u = new URL(s);
    if (!/^https?:$/i.test(u.protocol)) return '';
    u.hash = '';
    // quita trailing slash excepto raíz
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString().replace(/\/$/, '') === `${u.protocol}//${u.host}` 
      ? `${u.protocol}//${u.host}`
      : u.toString();
  } catch (_) {
    return '';
  }
}

function normalizeUrls(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : String(list || '').split(/[\n,;]+/)) {
    const u = normalizeUrl(item);
    if (!u) continue;
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

function parseUrlsJson(raw) {
  if (Array.isArray(raw)) return normalizeUrls(raw);
  if (raw == null || raw === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeUrls(parsed);
  } catch (_) {
    return normalizeUrls(String(raw));
  }
}

function normalizeEmail(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^mailto:/i, '').split('?')[0].trim();
  if (!EMAIL_RE.test(s)) return '';
  EMAIL_RE.lastIndex = 0;
  if (BAD_EMAIL_RE.test(s)) return '';
  if (/^(example|test|user|nombre|email|correo)@/i.test(s)) return '';
  if (/@\d+x\d+/i.test(s)) return ''; // assets tipo logo@3x
  return s;
}

function normalizeEmails(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : String(list || '').split(/[\n,;]+/)) {
    const e = normalizeEmail(item);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function parseEmailsJson(raw) {
  if (Array.isArray(raw)) return normalizeEmails(raw);
  if (raw == null || raw === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeEmails(parsed);
  } catch (_) {
    return normalizeEmails(String(raw));
  }
}

function extractEmailsFromHtml(html) {
  const s = String(html || '');
  const found = [];
  for (const m of s.matchAll(/mailto:([^"'?\s>#]+)/gi)) {
    found.push(decodeURIComponent(m[1]));
  }
  for (const m of s.matchAll(EMAIL_RE)) {
    found.push(m[0]);
  }
  // obfuscado: correo [at] dominio.cl
  for (const m of s.matchAll(/([a-z0-9._%+\-]+)\s*(?:\[at\]|\(at\)|\s+at\s+)\s*([a-z0-9.\-]+\.[a-z]{2,})/gi)) {
    found.push(`${m[1]}@${m[2]}`);
  }
  return normalizeEmails(found);
}

function hostCore(hostname) {
  return String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.(cl|com|net|org|lat|io|co)$/i, '');
}

function discoverContactUrls(baseUrls, html) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const n = normalizeUrl(u);
    if (!n) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  };

  for (const base of baseUrls || []) {
    try {
      const origin = new URL(base).origin;
      for (const path of CONTACT_PATHS) push(`${origin}${path}`);
    } catch (_) { /* skip */ }
  }

  const baseOrigin = (() => {
    try { return new URL((baseUrls || [])[0]).origin; } catch (_) { return ''; }
  })();

  for (const m of String(html || '').matchAll(/href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (!/contact|correo|escribenos|contactanos|contáctanos/i.test(href)) continue;
    if (/wp-json|oembed|#/.test(href)) continue;
    try {
      const abs = baseOrigin ? new URL(href, baseOrigin).toString() : href;
      push(abs);
    } catch (_) { /* skip */ }
  }
  return out;
}

async function ensureWebsSchema(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${WEBS_TABLE} (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        nombre VARCHAR(120) NOT NULL,
        urls_json TEXT NOT NULL,
        emails_json TEXT NULL,
        orden INT NOT NULL DEFAULT 0,
        activo TINYINT NOT NULL DEFAULT 1,
        actualizado_en TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    try {
      await db.exec(`ALTER TABLE ${WEBS_TABLE} ADD COLUMN emails_json TEXT NULL`);
    } catch (_) { /* ya existe */ }
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${WEBS_TABLE} (
        id TEXT NOT NULL PRIMARY KEY,
        nombre TEXT NOT NULL,
        urls_json TEXT NOT NULL,
        emails_json TEXT,
        orden INTEGER NOT NULL DEFAULT 0,
        activo INTEGER NOT NULL DEFAULT 1,
        actualizado_en TEXT
      )
    `);
    try {
      await db.exec(`ALTER TABLE ${WEBS_TABLE} ADD COLUMN emails_json TEXT`);
    } catch (_) { /* ya existe */ }
  }
}

async function seedDefaultWebs(db) {
  const countRow = await db.prepare(`SELECT COUNT(*) AS c FROM ${WEBS_TABLE}`).get();
  if (Number(countRow?.c || 0) > 0) return false;
  for (const c of DEFAULT_COMPANY_WEBS) {
    await db.prepare(`
      INSERT INTO ${WEBS_TABLE} (id, nombre, urls_json, emails_json, orden, activo)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(
      c.id,
      c.nombre,
      JSON.stringify(c.urls),
      JSON.stringify(c.emails || []),
      c.orden || 0
    );
  }
  return true;
}

async function listCompanyWebs(db) {
  await ensureWebsSchema(db);
  await seedDefaultWebs(db);
  const rows = await db.prepare(`
    SELECT id, nombre, urls_json, emails_json, orden, activo
    FROM ${WEBS_TABLE}
    WHERE activo = 1 OR activo IS NULL
    ORDER BY orden ASC, nombre ASC
  `).all();
  return (rows || []).map((r) => ({
    id: r.id,
    nombre: r.nombre,
    urls: parseUrlsJson(r.urls_json),
    emails: parseEmailsJson(r.emails_json),
    orden: Number(r.orden) || 0,
    activo: r.activo == null ? 1 : Number(r.activo)
  })).filter((r) => r.urls.length > 0 || r.nombre);
}

async function allowedHostsFromDb(db) {
  const list = await listCompanyWebs(db);
  const hosts = new Set();
  for (const c of list) {
    for (const url of c.urls) {
      try {
        hosts.add(new URL(url).hostname.replace(/^www\./, '').toLowerCase());
      } catch (_) { /* skip */ }
    }
  }
  return hosts;
}

function buildDirectoryText(empresas) {
  const list = Array.isArray(empresas) ? empresas : DEFAULT_COMPANY_WEBS;
  const lines = [
    '=== WEBS OFICIALES DEL GRUPO VERTIA ===',
    'Usa estas URLs como fuente pública de cada empresa. Si hay contenido indexado de la web, priorízalo.',
    'El administrador puede cambiar estas webs en el cerebro (Editar webs).',
    '',
    ...list.map((c) => {
      const urls = (c.urls || []).map((u) => String(u).replace(/^https?:\/\//, '')).join(' · ');
      const mails = (c.emails || []).length
        ? ` | Correos de contacto oficiales: ${(c.emails || []).join(', ')}`
        : '';
      return `${c.nombre}: ${urls}${mails}`;
    }),
    '',
    '=== CORREOS / CANAL OFICIAL DE CONTACTO ===',
    'Si piden un correo de la empresa (contacto comercial, corporativo, etc.):',
    '1) Da los correos de contacto publicados en el sitio web / configurados aquí (canal oficial).',
    '2) Si no hay correo visible, indica la página de contacto del sitio oficial.',
    '3) NO inventes correos personales de gerentes ni uses emails de usuarios de ESERCOM salvo que estén en el cerebro.',
    ...list.flatMap((c) => {
      if ((c.emails || []).length) {
        return [`· ${c.nombre}: ${(c.emails || []).join(' · ')}`];
      }
      const site = (c.urls || [])[0] || '';
      return site ? [`· ${c.nombre}: sin correo indexado — canal oficial: ${site} (formulario / contacto del sitio)`] : [];
    }),
    '=== FIN WEBS OFICIALES ==='
  ];
  return lines.join('\n');
}

function isAllowedUrl(url, allowedHosts) {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const core = hostCore(host);
    if (allowedHosts instanceof Set) {
      if (allowedHosts.has(host)) return true;
      for (const h of allowedHosts) {
        if (hostCore(h) === core) return true;
      }
      return false;
    }
    return DEFAULT_COMPANY_WEBS.some((c) => c.urls.some((x) => {
      try {
        const hx = new URL(x).hostname.replace(/^www\./, '').toLowerCase();
        return hx === host || hostCore(hx) === core;
      } catch (_) { return false; }
    }));
  } catch (_) {
    return false;
  }
}

function htmlToText(html) {
  let s = String(html || '');
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br|hr)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return s;
}

async function fetchUrlText(url, { timeoutMs = 12000, maxChars = 28000, allowedHosts = null } = {}) {
  if (!isAllowedUrl(url, allowedHosts)) {
    const err = new Error(`URL no permitida: ${url}`);
    err.status = 400;
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'ESERCOM-AngelBot/1.0 (+https://esercom.cl; conocimiento empresarial)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.5'
      }
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} al leer ${url}`);
      err.status = 502;
      throw err;
    }
    const ctype = String(res.headers.get('content-type') || '');
    const buf = Buffer.from(await res.arrayBuffer());
    const rawHtml = buf.toString('utf8');
    const emails = extractEmailsFromHtml(rawHtml);
    const contactUrls = discoverContactUrls([url], rawHtml);
    let text = '';
    if (/html|xml|text\//i.test(ctype) || !ctype) {
      text = htmlToText(rawHtml);
    } else {
      text = rawHtml.slice(0, maxChars);
    }
    if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…[recortado]`;
    return {
      url: String(res.url || url),
      ok: true,
      chars: text.length,
      texto: text || '(Sin texto legible en la página)',
      emails,
      contactUrls
    };
  } finally {
    clearTimeout(timer);
  }
}

function findCompanyInList(list, query) {
  const q = String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!q || !list?.length) return null;

  // match por URL/host
  for (const c of list) {
    for (const url of c.urls || []) {
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (q.includes(host.replace(/^www\./, '')) || q.includes(url.toLowerCase())) return c;
      } catch (_) { /* skip */ }
    }
  }

  // match por nombre / id
  for (const c of list) {
    const id = String(c.id || '').toLowerCase();
    const nombre = String(c.nombre || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (id && (q === id || q.includes(id))) return c;
    if (nombre && (q === nombre || q.includes(nombre) || nombre.includes(q))) return c;
  }

  // aliases conocidos
  if (/sercom|serviciossercom/.test(q)) return list.find((c) => /sercom/i.test(c.id + c.nombre)) || null;
  if (/tactic|tacticaooh/.test(q)) return list.find((c) => /tactic/i.test(c.id + c.nombre)) || null;
  if (/global|viapublica|via publica/.test(q)) return list.find((c) => /global/i.test(c.id + c.nombre)) || null;
  if (/intercanje/.test(q)) return list.find((c) => /intercanje/i.test(c.id + c.nombre)) || null;
  if (/nexus|nexusmedialatam/.test(q)) return list.find((c) => /nexus/i.test(c.id + c.nombre)) || null;
  return null;
}

async function findCompany(dbOrQuery, maybeQuery) {
  // Compat: findCompany(query) sin db usa defaults
  if (typeof dbOrQuery === 'string' || maybeQuery === undefined && !dbOrQuery?.prepare) {
    return findCompanyInList(DEFAULT_COMPANY_WEBS, dbOrQuery);
  }
  const list = await listCompanyWebs(dbOrQuery);
  return findCompanyInList(list, maybeQuery);
}

/**
 * Reemplaza el catálogo completo de webs (UI guardar).
 * @param {Array<{id?, nombre, urls: string[]|string, emails?: string[]|string, orden?}>} empresas
 */
async function saveCompanyWebs(db, empresas) {
  await ensureWebsSchema(db);
  const incoming = Array.isArray(empresas) ? empresas : [];
  const normalized = [];
  const usedIds = new Set();

  for (let i = 0; i < incoming.length; i++) {
    const raw = incoming[i] || {};
    const nombre = String(raw.nombre || '').trim();
    const urls = normalizeUrls(raw.urls);
    const emails = normalizeEmails(raw.emails);
    if (!nombre && !urls.length) continue;
    if (!nombre) {
      const err = new Error('Cada empresa necesita un nombre');
      err.status = 400;
      throw err;
    }
    if (!urls.length) {
      const err = new Error(`«${nombre}» necesita al menos una URL`);
      err.status = 400;
      throw err;
    }
    let id = slugifyId(raw.id || nombre);
    if (!id) id = `empresa-${i + 1}`;
    let base = id;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${base}-${n++}`;
    }
    usedIds.add(id);
    normalized.push({
      id,
      nombre,
      urls,
      emails,
      orden: Number(raw.orden) || (i + 1) * 10
    });
  }

  // Vaciar y reinsertar (catálogo editable simple)
  await db.prepare(`DELETE FROM ${WEBS_TABLE}`).run();
  for (const c of normalized) {
    await db.prepare(`
      INSERT INTO ${WEBS_TABLE} (id, nombre, urls_json, emails_json, orden, activo)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(c.id, c.nombre, JSON.stringify(c.urls), JSON.stringify(c.emails || []), c.orden);
  }

  // Actualiza directorio en cerebro (sin re-fetch)
  await syncCompanyWebsToBrain(db, { fetchContent: false });

  return {
    total: normalized.length,
    empresas: normalized
  };
}

async function upsertBrainNote(db, { nombre, texto, categoria, userId }) {
  const { updateAngelDoc, addAngelTextNote } = require('./angel-docs');
  const existing = await db.prepare(`
    SELECT id FROM ${TABLE} WHERE nombre = ? ORDER BY id DESC LIMIT 1
  `).get(nombre);
  if (existing?.id) {
    return updateAngelDoc(db, existing.id, {
      nombre,
      texto,
      categoria
    });
  }
  return addAngelTextNote(db, {
    titulo: nombre,
    texto,
    categoria,
    userId: userId || null
  });
}

/**
 * Guarda directorio + contenido público de cada web en el cerebro.
 */
async function syncCompanyWebsToBrain(db, { userId = null, fetchContent = true } = {}) {
  const empresas = await listCompanyWebs(db);
  const hosts = await allowedHostsFromDb(db);
  const results = [];
  const dirNombre = 'Webs oficiales del grupo Vertia';
  const enrichedEmpresas = [];

  // Limpia docs Web * de empresas que ya no existen
  try {
    const webDocs = await db.prepare(`
      SELECT id, nombre FROM ${TABLE}
      WHERE nombre LIKE 'Web %' AND nombre != ?
    `).all(dirNombre);
    const keep = new Set(empresas.map((c) => `Web ${c.nombre}`));
    for (const d of webDocs || []) {
      if (!keep.has(d.nombre) && /^Web /.test(d.nombre)) {
        const { deleteAngelDoc } = require('./angel-docs');
        try { await deleteAngelDoc(db, d.id); } catch (_) { /* ignore */ }
      }
    }
  } catch (_) { /* ignore cleanup */ }

  for (const company of empresas) {
    const configuredEmails = normalizeEmails(company.emails || []);
    const scrapedEmails = [];
    const contactPages = [];
    const parts = [
      `=== WEB ${company.nombre} (grupo Vertia) ===`,
      `Empresa: ${company.nombre}`,
      `Sitios oficiales: ${company.urls.join(' · ')}`,
      'Fuente: sitios públicos indexados para Angel. No inventes datos que no estén aquí.',
      ''
    ];
    let okFetch = 0;
    if (fetchContent) {
      const toFetch = [...company.urls];
      const seenFetch = new Set(toFetch.map((u) => u.toLowerCase()));
      // 1ª pasada: homes
      const homePages = [];
      for (const url of company.urls) {
        try {
          const page = await fetchUrlText(url, { allowedHosts: hosts });
          homePages.push(page);
          scrapedEmails.push(...(page.emails || []));
          for (const cu of page.contactUrls || []) {
            if (!seenFetch.has(cu.toLowerCase()) && isAllowedUrl(cu, hosts)) {
              seenFetch.add(cu.toLowerCase());
              toFetch.push(cu);
            }
          }
        } catch (err) {
          homePages.push({ url, ok: false, error: err.message, texto: '', emails: [] });
        }
      }
      // 2ª: páginas de contacto descubiertas / candidatas
      for (const url of toFetch.slice(company.urls.length)) {
        try {
          const page = await fetchUrlText(url, { allowedHosts: hosts, maxChars: 18000 });
          contactPages.push(page);
          scrapedEmails.push(...(page.emails || []));
        } catch (_) { /* contact page opcional */ }
      }

      for (const page of [...homePages, ...contactPages]) {
        if (!page.ok) {
          parts.push(`--- ${page.url} ---`);
          parts.push(`[No se pudo leer ahora: ${page.error || 'error'}]`);
          parts.push('');
          results.push({ nombre: company.nombre, url: page.url, ok: false, error: page.error });
          continue;
        }
        okFetch += 1;
        parts.push(`--- Contenido de ${page.url} ---`);
        if (page.emails?.length) {
          parts.push(`Correos detectados en esta página: ${page.emails.join(', ')}`);
        }
        parts.push(page.texto);
        parts.push('');
        results.push({
          nombre: company.nombre,
          url: page.url,
          ok: true,
          chars: page.chars,
          emails: page.emails || []
        });
      }
    } else {
      parts.push('(Solo directorio de URLs; usa «Sincronizar webs» para indexar el contenido.)');
    }

    const emails = normalizeEmails([...configuredEmails, ...scrapedEmails]);
    // Persistir correos scrapados + configurados para próximas consultas
    if (fetchContent && emails.length) {
      try {
        await db.prepare(`UPDATE ${WEBS_TABLE} SET emails_json = ? WHERE id = ?`)
          .run(JSON.stringify(emails), company.id);
      } catch (_) { /* ignore */ }
    }

    parts.splice(4, 0,
      emails.length
        ? `CORREOS DE CONTACTO OFICIALES (canal público del sitio): ${emails.join(' · ')}`
        : 'CORREOS DE CONTACTO OFICIALES: no publicados en el HTML del sitio — indica la web/formulario de contacto como canal oficial.'
    );

    parts.push(`=== FIN WEB ${company.nombre} ===`);

    await upsertBrainNote(db, {
      nombre: `Web ${company.nombre}`,
      texto: parts.join('\n'),
      categoria: 'empresas',
      userId
    });
    enrichedEmpresas.push({ ...company, emails });
    if (!fetchContent) {
      results.push({ nombre: company.nombre, ok: true, tipo: 'stub', emails });
    } else if (okFetch === 0) {
      results.push({ nombre: company.nombre, ok: false, error: 'Sin páginas leídas' });
    }
  }

  await upsertBrainNote(db, {
    nombre: dirNombre,
    texto: buildDirectoryText(enrichedEmpresas.length ? enrichedEmpresas : empresas),
    categoria: 'empresas',
    userId
  });
  results.unshift({ nombre: dirNombre, ok: true, tipo: 'directorio' });

  return {
    total_empresas: empresas.length,
    resultados: results,
    results,
    directorio: buildDirectoryText(enrichedEmpresas.length ? enrichedEmpresas : empresas),
    empresas: enrichedEmpresas.length ? enrichedEmpresas : empresas
  };
}

async function ensureCompanyWebDirectory(db) {
  try {
    await ensureWebsSchema(db);
    await seedDefaultWebs(db);
    const row = await db.prepare(`
      SELECT id FROM ${TABLE} WHERE nombre = ? LIMIT 1
    `).get('Webs oficiales del grupo Vertia');
    if (row?.id) return { ok: true, existed: true };
    await syncCompanyWebsToBrain(db, { fetchContent: false });
    return { ok: true, existed: false };
  } catch (err) {
    console.warn('[angel-webs] ensure directory:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Herramienta Angel: lee en vivo la(s) web(s) de una empresa del grupo.
 */
async function consultarWebEmpresa(dbOrEmpresa, maybeEmpresa) {
  let db = null;
  let raw = '';
  if (typeof dbOrEmpresa === 'string' || maybeEmpresa === undefined && !dbOrEmpresa?.prepare) {
    raw = String(dbOrEmpresa || '').trim();
  } else {
    db = dbOrEmpresa;
    raw = String(maybeEmpresa || '').trim();
  }

  const list = db ? await listCompanyWebs(db) : DEFAULT_COMPANY_WEBS.slice();
  const hosts = new Set();
  for (const c of list) {
    for (const url of c.urls) {
      try { hosts.add(new URL(url).hostname.replace(/^www\./, '').toLowerCase()); }
      catch (_) { /* skip */ }
    }
  }

  if (!raw) {
    return {
      ok: false,
      message: 'Indica la empresa o una URL del catálogo editable del cerebro',
      empresas: list.map((c) => ({ nombre: c.nombre, urls: c.urls }))
    };
  }

  let company = findCompanyInList(list, raw);
  let urls = company ? company.urls.slice() : [];
  if (/^https?:\/\//i.test(raw) || /^[\w.-]+\.[a-z]{2,}/i.test(raw)) {
    const normalized = normalizeUrl(raw);
    if (normalized && isAllowedUrl(normalized, hosts)) {
      urls = [normalized];
      company = findCompanyInList(list, normalized) || { nombre: company?.nombre || normalized, id: 'custom', urls };
    }
  }
  if (!urls.length) {
    return {
      ok: false,
      message: `No reconozco «${raw}». Empresas configuradas: ${list.map((c) => c.nombre).join(', ') || '(ninguna)'}`,
      empresas: list.map((c) => ({ nombre: c.nombre, urls: c.urls }))
    };
  }

  const pages = [];
  const scrapedEmails = [];
  const contactUrls = new Set();
  const toFetch = urls.slice();
  const seen = new Set(toFetch.map((u) => u.toLowerCase()));

  for (const url of urls) {
    try {
      const page = await fetchUrlText(url, { maxChars: 16000, allowedHosts: hosts });
      pages.push(page);
      scrapedEmails.push(...(page.emails || []));
      for (const cu of page.contactUrls || []) {
        if (!seen.has(cu.toLowerCase()) && isAllowedUrl(cu, hosts)) {
          seen.add(cu.toLowerCase());
          toFetch.push(cu);
        }
      }
    } catch (err) {
      pages.push({ url, ok: false, error: err.message, texto: '', emails: [] });
    }
  }
  for (const url of toFetch.slice(urls.length).slice(0, 3)) {
    try {
      const page = await fetchUrlText(url, { maxChars: 12000, allowedHosts: hosts });
      pages.push(page);
      scrapedEmails.push(...(page.emails || []));
      contactUrls.add(page.url || url);
    } catch (_) { /* opcional */ }
  }

  const emails = normalizeEmails([...(company?.emails || []), ...scrapedEmails]);
  const okPages = pages.filter((p) => p.ok);
  return {
    ok: okPages.length > 0 || emails.length > 0,
    empresa: company?.nombre || raw,
    urls,
    contactos_oficiales: {
      emails,
      paginas_contacto: [...contactUrls],
      instruccion: emails.length
        ? 'Estos son los correos de contacto publicados en el sitio (canal oficial). Dilas como canal oficial; no inventes otros.'
        : 'No hay correo público en el HTML. Indica el sitio / formulario de contacto como canal oficial.'
    },
    pages: pages.map((p) => ({
      url: p.url,
      ok: !!p.ok,
      chars: p.chars || 0,
      error: p.error || null,
      emails: p.emails || [],
      extracto: String(p.texto || '').slice(0, 12000)
    })),
    message: okPages.length
      ? `Contenido leído de ${company?.nombre || 'la web'}. Si hay contactos_oficiales.emails, úsalos como canal oficial.`
      : (emails.length
        ? `Correos oficiales disponibles para ${company?.nombre || 'la empresa'}.`
        : 'No se pudo leer ninguna página ahora.')
  };
}

module.exports = {
  COMPANY_WEBS,
  DEFAULT_COMPANY_WEBS,
  ensureWebsSchema,
  listCompanyWebs,
  saveCompanyWebs,
  buildDirectoryText,
  syncCompanyWebsToBrain,
  ensureCompanyWebDirectory,
  consultarWebEmpresa,
  findCompany,
  findCompanyInList,
  isAllowedUrl,
  fetchUrlText,
  normalizeUrl,
  normalizeUrls,
  normalizeEmails,
  extractEmailsFromHtml
};
