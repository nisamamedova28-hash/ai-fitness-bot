// Простое файловое хранилище для MVP.
// Когда пользователей станет много — заменить на SQLite/Postgres,
// структура данных (объект user) может остаться той же.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'users.json');

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({}), 'utf8');
}

function readAll() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getUser(chatId) {
  const all = readAll();
  return all[chatId] || null;
}

function saveUser(chatId, userData) {
  const all = readAll();
  all[chatId] = { ...(all[chatId] || {}), ...userData };
  writeAll(all);
  return all[chatId];
}

function getAllUsers() {
  return readAll();
}

module.exports = { getUser, saveUser, getAllUsers };
