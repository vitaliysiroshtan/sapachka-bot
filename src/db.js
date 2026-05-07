const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const db = new Database(DB_PATH);
// WAL mode survives crashes and OOM kills without corrupting the database
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS seen_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    chat_id    INTEGER NOT NULL,
    text_hash  TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lookup
    ON seen_messages (user_id, chat_id, text_hash, created_at);

  CREATE TABLE IF NOT EXISTS group_settings (
    chat_id      INTEGER PRIMARY KEY,
    window_hours REAL NOT NULL
  );
`);

const DAY_MS = 24 * 60 * 60 * 1000;

// Unix timestamps are UTC, so stripping the sub-day remainder gives UTC midnight
function utcDayStart(ts) {
  return ts - (ts % DAY_MS);
}

function hashText(text) {
  // Store a hash instead of raw text — the original message content is never saved
  return crypto.createHash('sha256')
    .update(text.toLowerCase().trim())
    .digest('hex');
}

function isDuplicate(userId, chatId, contentKey, windowHours) {
  const windowDays = Math.ceil(windowHours / 24);
  // The SQL cutoff is wider than windowHours by 24h so records near the calendar
  // boundary are always found — the actual allow/block decision is made in JS below
  const cutoff = Date.now() - (windowHours + 24) * 60 * 60 * 1000;
  const row = db.prepare(`
    SELECT created_at FROM seen_messages
    WHERE user_id = ? AND chat_id = ? AND text_hash = ? AND created_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, chatId, contentKey, cutoff);
  if (!row) return false;
  // Calendar-day check: allow reposting once N full UTC days have passed since
  // the day of the original post, regardless of the exact hour within that day.
  // e.g. windowDays=2: posted Tuesday → allowed again from Thursday 00:00 UTC
  const daysDiff = (utcDayStart(Date.now()) - utcDayStart(row.created_at)) / DAY_MS;
  return daysDiff < windowDays;
}

function recordMessage(userId, chatId, contentKey) {
  db.prepare(`
    INSERT INTO seen_messages (user_id, chat_id, text_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, chatId, contentKey, Date.now());
}

function getOriginalTimestamp(userId, chatId, contentKey, windowHours) {
  // Same +24h buffer as isDuplicate to ensure consistency
  const cutoff = Date.now() - (windowHours + 24) * 60 * 60 * 1000;
  const row = db.prepare(`
    SELECT created_at FROM seen_messages
    WHERE user_id = ? AND chat_id = ? AND text_hash = ? AND created_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, chatId, contentKey, cutoff);
  return row ? row.created_at : null;
}

function getWindowHours(chatId) {
  const row = db.prepare('SELECT window_hours FROM group_settings WHERE chat_id = ?').get(chatId);
  return row ? row.window_hours : null;
}

function setWindowHours(chatId, hours) {
  db.prepare('INSERT OR REPLACE INTO group_settings (chat_id, window_hours) VALUES (?, ?)').run(chatId, hours);
}

function pruneOld(windowHours) {
  // Match the +24h buffer from isDuplicate so we never prune records that are
  // still needed for the calendar-day boundary check
  const cutoff = Date.now() - (windowHours + 24) * 60 * 60 * 1000;
  return db.prepare(`DELETE FROM seen_messages WHERE created_at < ?`).run(cutoff).changes;
}

module.exports = { DAY_MS, utcDayStart, hashText, isDuplicate, recordMessage, pruneOld, getOriginalTimestamp, getWindowHours, setWindowHours };
