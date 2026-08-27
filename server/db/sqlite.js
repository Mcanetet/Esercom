/**
 * Wrapper estilo better-sqlite3 sobre sql.js (WASM).
 * Sin módulos nativos → compatible con Hostinger / CloudLinux (sin make / GLIBC vieja).
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL = null;
let readyPromise = null;

function wasmPath(file) {
  try {
    return require.resolve(`sql.js/dist/${file}`);
  } catch (_) {
    return path.join(__dirname, '../../node_modules/sql.js/dist', file);
  }
}

function initEngine() {
  if (SQL) return Promise.resolve(SQL);
  if (!readyPromise) {
    readyPromise = initSqlJs({ locateFile: wasmPath }).then((engine) => {
      SQL = engine;
      return SQL;
    });
  }
  return readyPromise;
}

function flattenParams(params) {
  const raw = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return raw.map((v) => (v === undefined ? null : v));
}

class Statement {
  constructor(db, sql) {
    this._db = db;
    this.sql = sql;
  }

  get(...params) {
    const stmt = this._db._raw.prepare(this.sql);
    try {
      const values = flattenParams(params);
      if (values.length) stmt.bind(values);
      if (stmt.step()) return Promise.resolve(stmt.getAsObject());
      return Promise.resolve(undefined);
    } finally {
      stmt.free();
    }
  }

  all(...params) {
    const stmt = this._db._raw.prepare(this.sql);
    const rows = [];
    try {
      const values = flattenParams(params);
      if (values.length) stmt.bind(values);
      while (stmt.step()) rows.push(stmt.getAsObject());
      return Promise.resolve(rows);
    } finally {
      stmt.free();
    }
  }

  run(...params) {
    const values = flattenParams(params);
    this._db._raw.run(this.sql, values.length ? values : []);
    const changes = this._db._raw.getRowsModified();
    const idRow = this._db._raw.exec('SELECT last_insert_rowid() AS id');
    const lastInsertRowid = idRow[0] && idRow[0].values[0] ? idRow[0].values[0][0] : 0;
    this._db._markDirty();
    return Promise.resolve({ changes, lastInsertRowid });
  }
}

class Database {
  constructor(filename) {
    if (!SQL) {
      throw new Error('Motor SQLite no inicializado. Llame a initEngine() antes.');
    }
    this.filename = filename;
    this._txDepth = 0;
    this._dirty = false;

    if (filename && fs.existsSync(filename)) {
      const buf = fs.readFileSync(filename);
      this._raw = new SQL.Database(buf);
    } else {
      this._raw = new SQL.Database();
      this._dirty = true;
    }
    try {
      this._raw.run('PRAGMA foreign_keys = ON');
    } catch (_) { /* ignore */ }
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  exec(sql) {
    this._raw.exec(sql);
    this._markDirty();
    return Promise.resolve(this);
  }

  pragma(source) {
    const s = String(source || '').trim();
    if (/^journal_mode\b/i.test(s)) return [{ journal_mode: 'memory' }];
    try {
      this._raw.run(`PRAGMA ${s}`);
      if (!/^foreign_keys\b/i.test(s)) this._markDirty();
    } catch (_) { /* ignore unsupported */ }
    return [];
  }

  transaction(fn) {
    const self = this;
    return async function runTransaction(...args) {
      self._txDepth += 1;
      if (self._txDepth === 1) self._raw.run('BEGIN');
      try {
        const result = await fn.apply(this, args);
        self._txDepth -= 1;
        if (self._txDepth === 0) {
          self._raw.run('COMMIT');
          self._dirty = true;
          self._persist();
        }
        return result;
      } catch (err) {
        self._txDepth -= 1;
        try {
          self._raw.run('ROLLBACK');
        } catch (_) { /* ignore */ }
        throw err;
      }
    };
  }

  _markDirty() {
    this._dirty = true;
    if (this._txDepth === 0) this._persist();
  }

  _persist() {
    if (!this.filename || !this._dirty) return;
    const data = this._raw.export();
    fs.writeFileSync(this.filename, Buffer.from(data));
    this._dirty = false;
    // Limpia restos WAL de better-sqlite3 si existían
    for (const suffix of ['-wal', '-shm']) {
      const extra = this.filename + suffix;
      if (fs.existsSync(extra)) {
        try { fs.unlinkSync(extra); } catch (_) { /* ignore */ }
      }
    }
  }

  close() {
    this._persist();
    this._raw.close();
  }
}

module.exports = {
  Database,
  initEngine
};
