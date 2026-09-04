/**
 * twilio-voice/db.js
 *
 * SQLite database helper using sql.js (pure JavaScript / WebAssembly).
 * sql.js requires NO native compilation — works on all platforms out of the box.
 *
 * Database is persisted to disk as ./quotes.db using Node.js fs.
 * sql.js loads the file into memory on startup and writes it back on each write
 * (fine for low-volume webhook traffic; swap for WAL-backed libraries at scale).
 *
 * Table: supplier_quotes
 *   id              INTEGER PRIMARY KEY AUTOINCREMENT
 *   supplier_name   TEXT    NOT NULL
 *   phone_number    TEXT    DEFAULT ''
 *   item_name       TEXT    NOT NULL
 *   raw_transcript  TEXT    DEFAULT ''
 *   extracted_price REAL            — NULL if extraction failed
 *   call_sid        TEXT    NOT NULL — Twilio Call SID
 *   created_at      TEXT    NOT NULL — ISO 8601 UTC timestamp
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'quotes.db');

// ── Module-level state ────────────────────────────────────────────────────────
// sqlJs and db are initialised synchronously on first use via the
// _ensureReady() helper, so callers don't need to await anything.
let _SQL = null;   // sql.js factory result
let _db  = null;   // sql.js Database instance

/**
 * Lazily initialise sql.js and open (or create) the on-disk database.
 * Called automatically before every DB operation.
 */
function _ensureReady() {
  if (_db) return; // already initialised

  // Require sql.js — this loads the WASM binary synchronously via the
  // bundled JS file.  The factory returns a Promise, but sql.js also ships
  // a synchronous variant we can use here.
  const initSqlJs = require('sql.js');

  // initSqlJs() is async, but since we call this on the first DB operation
  // (which happens after the event loop is running), we use a synchronous
  // trick: call .then() and use a flag to block.  For simplicity at this
  // scale we use synchronous file I/O + the sql.js sync API pattern.

  // sql.js does not have a native sync init, so we store the result via a
  // shared variable and throw if not ready.  We init eagerly at module load
  // time using a top-level async IIFE.
  throw new Error('[DB] Database not yet initialised — call initDB() first');
}

/**
 * initDB()
 * Must be awaited once at server startup (called from server.js).
 */
async function initDB() {
  if (_db) return; // idempotent

  const initSqlJs = require('sql.js');
  _SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    // Load existing database from disk
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new _SQL.Database(fileBuffer);
    console.log(`[DB] Loaded existing database from ${DB_PATH}`);
  } else {
    // Create a fresh in-memory database
    _db = new _SQL.Database();
    console.log(`[DB] Created new database at ${DB_PATH}`);
  }

  // Create the table if it doesn't exist
  _db.run(`
    CREATE TABLE IF NOT EXISTS supplier_quotes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name   TEXT    NOT NULL,
      phone_number    TEXT    DEFAULT '',
      item_name       TEXT    NOT NULL,
      raw_transcript  TEXT    DEFAULT '',
      extracted_price REAL,
      call_sid        TEXT    NOT NULL,
      created_at      TEXT    NOT NULL
    );
  `);

  _persist(); // write initial state to disk
  console.log('[DB] Table supplier_quotes ready.');
}

/**
 * Write the in-memory database back to the .db file on disk.
 * Called after every write operation.
 */
function _persist() {
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─────────────────────────────────────────────────────────────────────────────
// saveQuote(data)
//
// Inserts a new row into supplier_quotes and persists the DB file.
//
// @param {object} data
//   supplier_name   {string}        required
//   phone_number    {string}        optional
//   item_name       {string}        required
//   raw_transcript  {string}        optional
//   extracted_price {number|null}   optional (null → SQL NULL)
//   call_sid        {string}        required
// ─────────────────────────────────────────────────────────────────────────────
function saveQuote(data) {
  if (!_db) throw new Error('[DB] Database not initialised — did you call initDB()?');

  const row = {
    ':supplier_name':   data.supplier_name   || 'unknown',
    ':phone_number':    data.phone_number    || '',
    ':item_name':       data.item_name       || 'unknown',
    ':raw_transcript':  data.raw_transcript  || '',
    ':extracted_price': data.extracted_price ?? null,
    ':call_sid':        data.call_sid        || 'unknown',
    ':created_at':      new Date().toISOString(),
  };

  _db.run(
    `INSERT INTO supplier_quotes
       (supplier_name, phone_number, item_name, raw_transcript, extracted_price, call_sid, created_at)
     VALUES
       (:supplier_name, :phone_number, :item_name, :raw_transcript, :extracted_price, :call_sid, :created_at)`,
    row
  );

  _persist(); // flush to disk immediately after every write

  // Return the last inserted row id
  const result = _db.exec('SELECT last_insert_rowid() AS id');
  return result[0]?.values[0][0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// getAllQuotes()
//
// Returns all rows from supplier_quotes as plain JS objects, newest first.
// @returns {Array<object>}
// ─────────────────────────────────────────────────────────────────────────────
function getAllQuotes() {
  if (!_db) throw new Error('[DB] Database not initialised — did you call initDB()?');

  const result = _db.exec(
    'SELECT id, supplier_name, phone_number, item_name, raw_transcript, extracted_price, call_sid, created_at FROM supplier_quotes ORDER BY created_at DESC'
  );

  if (!result.length) return [];

  const { columns, values } = result[0];
  // Convert [column[], values[][]] into [{col: val, ...}] objects
  return values.map(row =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]]))
  );
}

module.exports = { initDB, saveQuote, getAllQuotes };
