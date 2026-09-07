const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'app.db');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surname TEXT NOT NULL,
  name TEXT NOT NULL,
  patronymic TEXT,
  tabel_number TEXT NOT NULL UNIQUE,
  department_id INTEGER,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
  position TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT,
  file_original_name TEXT,
  publish_date TEXT NOT NULL DEFAULT (datetime('now')),
  deadline_days INTEGER NOT NULL DEFAULT 7,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_read', -- 'not_read' | 'read' | 'overdue'
  read_at TEXT,
  assigned_at TEXT DEFAULT (datetime('now')),
  UNIQUE(document_id, user_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  document_id INTEGER,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info', -- 'info' | 'overdue' | 'manager_overdue'
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
`);

// Add manager_id column to users if not exists (for "непосредственный руководитель")
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('manager_id')) {
  db.exec(`ALTER TABLE users ADD COLUMN manager_id INTEGER REFERENCES users(id)`);
}

// Seed default admin if no users exist
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (surname, name, patronymic, tabel_number, department_id, login, password_hash, role, position)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('Администратор', 'Системы', '', '000001', null, 'admin', hash, 'admin', 'Администратор');
  console.log('Создан администратор по умолчанию: логин "admin", пароль "admin123". Обязательно смените пароль после входа.');
}

module.exports = db;
