const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const db = new Database(DB_PATH);
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

function hashText(text) {
  return crypto.createHash('sha256')
    .update(text.toLowerCase().trim())
    .digest('hex');
}

function isDuplicate(userId, chatId, contentKey, windowHours) {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const row = db.prepare(`
    SELECT 1 FROM seen_messages
    WHERE user_id = ? AND chat_id = ? AND text_hash = ? AND created_at > ?
    LIMIT 1
  `).get(userId, chatId, contentKey, cutoff);
  return row !== undefined;
}

function recordMessage(userId, chatId, contentKey) {
  db.prepare(`
    INSERT INTO seen_messages (user_id, chat_id, text_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, chatId, contentKey, Date.now());
}

function getOriginalTimestamp(userId, chatId, contentKey, windowHours) {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
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
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  return db.prepare(`DELETE FROM seen_messages WHERE created_at < ?`).run(cutoff).changes;
}

module.exports = { hashText, isDuplicate, recordMessage, pruneOld, getOriginalTimestamp, getWindowHours, setWindowHours };
