'use strict';

/**
 * 统一配置库 —— 所有工具共用的键值存储。
 *
 * 用 Node 内置的 `node:sqlite`（Node 22.5+ 起随运行时提供），所以：
 *   - 零依赖，不用 better-sqlite3，不用 electron-rebuild 编译原生模块
 *   - 同步 API，主进程里用起来直接
 *
 * 表结构刻意做到最简：一张 kv 表 + 一个 schema 版本号。值统一按 JSON 存，
 * 工具想存对象/数组/字符串都行。
 *
 *   键的约定：用点分命名空间，跨工具共享的用通用前缀（如 `ai.models`），
 *   只有自己用的加工具前缀（如 `gzh-studio.xxx`）。
 *
 * 这个文件**不认识任何具体工具**，只是把库暴露成一组成熟的方法。
 */

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { DB_FILE, DATA_DIR } = require('./paths');

const SCHEMA_VERSION = 1;

let db = null;

/* ---------- 打开 / 建表 ---------- */

function open() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);

  /* WAL 让并发读更顺，也更不容易因为异常退出损坏 */
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  const current = db.prepare('PRAGMA user_version').get().user_version || 0;
  if (current < SCHEMA_VERSION) {
    /* 将来加表/改列时按版本号递进，这里对老库做升级 */
    db.exec('PRAGMA user_version = ' + SCHEMA_VERSION);
  }

  return db;
}

function close() {
  if (!db) return;
  try { db.close(); } catch (error) { /* 退出阶段忽略 */ }
  db = null;
}

/* ---------- 读写 ---------- */

function get(key) {
  const row = open().prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch (error) {
    return null;               /* 存进去时是 JSON，解不开就当没有 */
  }
}

function set(key, value) {
  open()
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
             'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(String(key), JSON.stringify(value === undefined ? null : value), new Date().toISOString());
  return true;
}

function remove(key) {
  open().prepare('DELETE FROM settings WHERE key = ?').run(String(key));
  return true;
}

function all() {
  const rows = open().prepare('SELECT key, value FROM settings ORDER BY key').all();
  const out = {};
  rows.forEach((row) => {
    try { out[row.key] = JSON.parse(row.value); } catch (error) { /* 跳过坏行 */ }
  });
  return out;
}

function info() {
  return {
    file: DB_FILE,
    sizeBytes: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0,
    keys: open().prepare('SELECT COUNT(*) AS n FROM settings').get().n
  };
}

module.exports = { open, close, get, set, remove, all, info, DB_FILE, DATA_DIR };
