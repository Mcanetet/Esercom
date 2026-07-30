/**
 * Adapter MySQL (mysql2) con API similar a better-sqlite3/sql.js.
 * Métodos get/all/run/exec son async (Promesas).
 * Sin bindings nativos → apto para Bluehosting / cPanel.
 */
const mysql = require('mysql2/promise');

function flattenParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function rewriteSql(sql) {
  let s = String(sql);
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()');
  s = s.replace(/date\s*\(\s*'now'\s*,\s*'([+-]\d+)\s+days?'\s*\)/gi, (_, n) => {
    const days = Number(n);
    if (days < 0) return `DATE_SUB(CURDATE(), INTERVAL ${Math.abs(days)} DAY)`;
    return `DATE_ADD(CURDATE(), INTERVAL ${days} DAY)`;
  });
  s = s.replace(/date\s*\(\s*'now'\s*\)/gi, 'CURDATE()');
  s = s.replace(/INSERT\s+OR\s+IGNORE/gi, 'INSERT IGNORE');
  s = s.replace(/INSERT\s+OR\s+REPLACE/gi, 'REPLACE');
  // MySQL productivo usa roles.permisos (JSON), ESERCOM usa paginas_permitidas
  s = s.replace(/\br\.paginas_permitidas\b/gi, 'r.permisos AS paginas_permitidas');
  s = s.replace(/\bSELECT\s+([\s\S]*?)\bpaginas_permitidas\b/gi, (m) => {
    if (/AS paginas_permitidas/i.test(m)) return m;
    return m.replace(/\bpaginas_permitidas\b/i, 'permisos AS paginas_permitidas');
  });
  return s;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}

class Statement {
  constructor(db, sql) {
    this._db = db;
    this.sql = rewriteSql(sql);
  }

  async get(...params) {
    const values = flattenParams(params);
    const [rows] = await this._db.pool.execute(this.sql, values);
    return rows[0] ? normalizeRow(rows[0]) : undefined;
  }

  async all(...params) {
    const values = flattenParams(params);
    const [rows] = await this._db.pool.execute(this.sql, values);
    return rows.map(normalizeRow);
  }

  async run(...params) {
    const values = flattenParams(params);
    const [result] = await this._db.pool.execute(this.sql, values);
    return {
      changes: result.affectedRows || 0,
      lastInsertRowid: Number(result.insertId || 0)
    };
  }
}

class MysqlDatabase {
  constructor(pool) {
    this.pool = pool;
    this.driver = 'mysql';
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async exec(sql) {
    const parts = String(sql)
      .split(/;\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      await this.pool.query(rewriteSql(part));
    }
    return this;
  }

  pragma() {
    return [];
  }

  transaction(fn) {
    const self = this;
    return async function runTransaction(...args) {
      const conn = await self.pool.getConnection();
      try {
        await conn.beginTransaction();
        const scoped = {
          prepare(sql) {
            const stmt = new Statement({ pool: {
              execute: (q, v) => conn.execute(q, v),
              query: (q, v) => conn.query(q, v)
            } }, sql);
            return stmt;
          },
          async exec(sql) {
            await conn.query(rewriteSql(sql));
          }
        };
        // Permite fn que use self.prepare vía closure del caller con req.db —
        // redirigimos prepare/run del db temporalmente
        const origPrepare = self.prepare.bind(self);
        const origExec = self.exec.bind(self);
        self.prepare = scoped.prepare;
        self.exec = scoped.exec;
        try {
          const result = await fn.apply(this, args);
          await conn.commit();
          return result;
        } catch (err) {
          await conn.rollback();
          throw err;
        } finally {
          self.prepare = origPrepare;
          self.exec = origExec;
        }
      } finally {
        conn.release();
      }
    };
  }

  async close() {
    await this.pool.end();
  }
}

async function createMysqlPool(cfg) {
  const pool = await mysql.createPool({
    host: cfg.host,
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 5,
    namedPlaceholders: false,
    dateStrings: true,
    charset: 'utf8mb4'
  });

  // || como concatenación (compatible con queries SQLite del código)
  pool.on('connection', (connection) => {
    connection.query("SET SESSION sql_mode = CONCAT(@@sql_mode, ',PIPES_AS_CONCAT')", () => {});
  });

  // smoke test
  await pool.query('SELECT 1 AS ok');
  return new MysqlDatabase(pool);
}

module.exports = {
  MysqlDatabase,
  createMysqlPool,
  rewriteSql
};
