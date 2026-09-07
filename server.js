const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const db = require('./db');
const { recalcStatuses, computeDisplayStatus } = require('./statusEngine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: 'doc-control-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 часов
}));

// ---------- Загрузка файлов документов ----------
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// Периодический пересчёт статусов (просрочка) — при старте и раз в час
recalcStatuses();
setInterval(recalcStatuses, 60 * 60 * 1000);

// ---------- Middleware авторизации ----------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Не авторизован' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }
  next();
}

function fio(u) {
  return [u.surname, u.name, u.patronymic].filter(Boolean).join(' ');
}

// ================= AUTH =================
app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
  if (!user || !user.is_active) return res.status(401).json({ error: 'Неверный логин или пароль' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  req.session.user = { id: user.id, login: user.login, role: user.role, fio: fio(user) };
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ user: req.session.user });
});

app.post('/api/auth/register', (req, res) => {
  // Самостоятельная регистрация обычного сотрудника
  const { surname, name, patronymic, tabel_number, department_id, login, password, position } = req.body;
  if (!surname || !name || !tabel_number || !login || !password) {
    return res.status(400).json({ error: 'Заполните обязательные поля: фамилия, имя, табельный номер, логин, пароль' });
  }
  const existsLogin = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
  if (existsLogin) return res.status(400).json({ error: 'Такой логин уже занят' });
  const existsTabel = db.prepare('SELECT id FROM users WHERE tabel_number = ?').get(tabel_number);
  if (existsTabel) return res.status(400).json({ error: 'Такой табельный номер уже зарегистрирован' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (surname, name, patronymic, tabel_number, department_id, login, password_hash, role, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?)`)
    .run(surname, name, patronymic || '', tabel_number, department_id || null, login, hash, position || '');
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ================= DEPARTMENTS =================
app.get('/api/departments', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM departments ORDER BY name').all();
  res.json(rows);
});

app.post('/api/departments', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Укажите название подразделения' });
  try {
    const info = db.prepare('INSERT INTO departments (name) VALUES (?)').run(name.trim());
    res.json({ id: info.lastInsertRowid, name: name.trim() });
  } catch (e) {
    res.status(400).json({ error: 'Подразделение с таким названием уже существует' });
  }
});

app.put('/api/departments/:id', requireAdmin, (req, res) => {
  const { name } = req.body;
  db.prepare('UPDATE departments SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/departments/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ================= USERS =================
app.get('/api/users', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.surname, u.name, u.patronymic, u.tabel_number, u.login, u.role, u.position,
           u.is_active, u.department_id, d.name AS department_name, u.manager_id,
           m.surname AS manager_surname, m.name AS manager_name
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN users m ON m.id = u.manager_id
    ORDER BY u.surname, u.name
  `).all();
  res.json(rows);
});

// Список сотрудников для выбора (руководитель / назначение документа) — минимум данных
app.get('/api/users/lite', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, surname, name, patronymic, department_id FROM users ORDER BY surname, name`).all();
  res.json(rows);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { surname, name, patronymic, tabel_number, department_id, login, password, role, position, manager_id } = req.body;
  if (!surname || !name || !tabel_number || !login || !password) {
    return res.status(400).json({ error: 'Заполните обязательные поля' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare(`INSERT INTO users (surname, name, patronymic, tabel_number, department_id, login, password_hash, role, position, manager_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(surname, name, patronymic || '', tabel_number, department_id || null, login, hash, role || 'user', position || '', manager_id || null);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Логин или табельный номер уже используется' });
  }
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const { surname, name, patronymic, tabel_number, department_id, login, role, position, is_active, manager_id, password } = req.body;
  db.prepare(`UPDATE users SET surname=?, name=?, patronymic=?, tabel_number=?, department_id=?, login=?, role=?, position=?, is_active=?, manager_id=?
              WHERE id=?`)
    .run(surname, name, patronymic || '', tabel_number, department_id || null, login, role, position || '', is_active ? 1 : 0, manager_id || null, req.params.id);
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  }
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.status(400).json({ error: 'Нельзя удалить свою же учётную запись' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ================= DOCUMENTS =================
app.get('/api/documents', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, u.surname AS author_surname, u.name AS author_name,
      (SELECT COUNT(*) FROM assignments a WHERE a.document_id = d.id) AS total_assigned,
      (SELECT COUNT(*) FROM assignments a WHERE a.document_id = d.id AND a.status='read') AS total_read
    FROM documents d
    LEFT JOIN users u ON u.id = d.created_by
    ORDER BY d.publish_date DESC
  `).all();
  res.json(rows);
});

app.get('/api/documents/:id', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  const assignments = db.prepare(`
    SELECT a.*, u.surname, u.name, u.patronymic, u.tabel_number, dep.name AS department_name
    FROM assignments a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN departments dep ON dep.id = u.department_id
    WHERE a.document_id = ?
    ORDER BY u.surname, u.name
  `).all(req.params.id);
  assignments.forEach(a => { a.display_status = computeDisplayStatus(a.status, doc.publish_date, doc.deadline_days); });
  res.json({ doc, assignments });
});

// Загрузка документа + назначение сотрудникам/подразделениям
app.post('/api/documents', requireAdmin, upload.single('file'), (req, res) => {
  const { title, description, deadline_days } = req.body;
  let { user_ids, department_ids } = req.body;
  if (!title) return res.status(400).json({ error: 'Укажите название документа' });

  // приходят как JSON-строки из FormData
  try { user_ids = user_ids ? JSON.parse(user_ids) : []; } catch { user_ids = []; }
  try { department_ids = department_ids ? JSON.parse(department_ids) : []; } catch { department_ids = []; }

  const file_name = req.file ? req.file.filename : null;
  const file_original_name = req.file ? req.file.originalname : null;

  const info = db.prepare(`INSERT INTO documents (title, description, file_name, file_original_name, deadline_days, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(title, description || '', file_name, file_original_name, deadline_days || 7, req.session.user.id);
  const docId = info.lastInsertRowid;

  // Собираем итоговый список пользователей: явные + все из выбранных подразделений
  const targetUserIds = new Set((user_ids || []).map(Number));
  if (department_ids && department_ids.length) {
    const placeholders = department_ids.map(() => '?').join(',');
    const deptUsers = db.prepare(`SELECT id FROM users WHERE department_id IN (${placeholders})`).all(...department_ids);
    deptUsers.forEach(u => targetUserIds.add(u.id));
  }

  const assignStmt = db.prepare('INSERT OR IGNORE INTO assignments (document_id, user_id) VALUES (?, ?)');
  const notifyStmt = db.prepare(`INSERT INTO notifications (user_id, document_id, message, type) VALUES (?, ?, ?, 'info')`);
  for (const uid of targetUserIds) {
    assignStmt.run(docId, uid);
    notifyStmt.run(uid, docId, `Вам назначен для изучения новый документ: «${title}». Срок ознакомления — ${deadline_days || 7} дн.`);
  }

  res.json({ id: docId, assigned: targetUserIds.size });
});

app.put('/api/documents/:id', requireAdmin, upload.single('file'), (req, res) => {
  const { title, description, deadline_days } = req.body;
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });

  let file_name = doc.file_name;
  let file_original_name = doc.file_original_name;
  if (req.file) {
    // удаляем старый файл
    if (doc.file_name) {
      const oldPath = path.join(uploadsDir, doc.file_name);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    file_name = req.file.filename;
    file_original_name = req.file.originalname;
  }

  db.prepare(`UPDATE documents SET title=?, description=?, file_name=?, file_original_name=?, deadline_days=? WHERE id=?`)
    .run(title, description || '', file_name, file_original_name, deadline_days || doc.deadline_days, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/documents/:id', requireAdmin, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (doc && doc.file_name) {
    const p = path.join(uploadsDir, doc.file_name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Дополнительное назначение документа доп. сотрудникам/подразделениям
app.post('/api/documents/:id/assign', requireAdmin, (req, res) => {
  const { user_ids = [], department_ids = [] } = req.body;
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });

  const targetUserIds = new Set((user_ids || []).map(Number));
  if (department_ids && department_ids.length) {
    const placeholders = department_ids.map(() => '?').join(',');
    const deptUsers = db.prepare(`SELECT id FROM users WHERE department_id IN (${placeholders})`).all(...department_ids);
    deptUsers.forEach(u => targetUserIds.add(u.id));
  }
  const assignStmt = db.prepare('INSERT OR IGNORE INTO assignments (document_id, user_id) VALUES (?, ?)');
  const notifyStmt = db.prepare(`INSERT INTO notifications (user_id, document_id, message, type) VALUES (?, ?, ?, 'info')`);
  let added = 0;
  for (const uid of targetUserIds) {
    const r = assignStmt.run(doc.id, uid);
    if (r.changes > 0) {
      added++;
      notifyStmt.run(uid, doc.id, `Вам назначен для изучения документ: «${doc.title}».`);
    }
  }
  res.json({ ok: true, added });
});

// Скачивание файла документа
app.get('/api/documents/:id/file', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc || !doc.file_name) return res.status(404).json({ error: 'Файл не найден' });
  const filePath = path.join(uploadsDir, doc.file_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Файл не найден на диске' });
  res.download(filePath, doc.file_original_name || doc.file_name);
});

// ================= МОИ ДОКУМЕНТЫ (для пользователя) =================
app.get('/api/my/documents', requireAuth, (req, res) => {
  recalcStatuses();
  const rows = db.prepare(`
    SELECT a.id AS assignment_id, a.status, a.read_at, d.id AS document_id, d.title, d.description,
           d.publish_date, d.deadline_days, d.file_name, d.file_original_name
    FROM assignments a
    JOIN documents d ON d.id = a.document_id
    WHERE a.user_id = ?
    ORDER BY d.publish_date DESC
  `).all(req.session.user.id);
  rows.forEach(r => { r.display_status = computeDisplayStatus(r.status, r.publish_date, r.deadline_days); });
  res.json(rows);
});

app.post('/api/my/documents/:assignmentId/acknowledge', requireAuth, (req, res) => {
  const a = db.prepare('SELECT * FROM assignments WHERE id = ? AND user_id = ?').get(req.params.assignmentId, req.session.user.id);
  if (!a) return res.status(404).json({ error: 'Назначение не найдено' });
  db.prepare(`UPDATE assignments SET status = 'read', read_at = datetime('now') WHERE id = ?`).run(a.id);
  res.json({ ok: true });
});

// ================= NOTIFICATIONS =================
app.get('/api/my/notifications', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).all(req.session.user.id);
  res.json(rows);
});

app.post('/api/my/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(req.params.id, req.session.user.id);
  res.json({ ok: true });
});

app.post('/api/my/notifications/read-all', requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.session.user.id);
  res.json({ ok: true });
});

// ================= REPORTS =================
function buildDepartmentReport() {
  recalcStatuses();
  const departments = db.prepare('SELECT * FROM departments ORDER BY name').all();
  const noDept = { id: null, name: 'Без подразделения' };
  const allDepts = [...departments, noDept];

  const report = [];
  for (const dep of allDepts) {
    const usersInDept = dep.id
      ? db.prepare('SELECT * FROM users WHERE department_id = ?').all(dep.id)
      : db.prepare('SELECT * FROM users WHERE department_id IS NULL').all();
    if (usersInDept.length === 0) continue;

    let totalAssignments = 0, totalRead = 0;
    const notCompleted = [];

    for (const u of usersInDept) {
      const assignments = db.prepare(`
        SELECT a.*, d.title, d.publish_date, d.deadline_days
        FROM assignments a JOIN documents d ON d.id = a.document_id
        WHERE a.user_id = ?`).all(u.id);
      for (const a of assignments) {
        totalAssignments++;
        const st = computeDisplayStatus(a.status, a.publish_date, a.deadline_days);
        if (st === 'read') totalRead++;
        else {
          const publish = new Date(a.publish_date.replace(' ', 'T'));
          const deadline = new Date(publish.getTime() + a.deadline_days * 86400000);
          const overdueDays = st === 'overdue' ? Math.ceil((Date.now() - deadline.getTime()) / 86400000) : 0;
          notCompleted.push({
            fio: fio(u), tabel_number: u.tabel_number, document: a.title,
            status: st, overdue_days: overdueDays
          });
        }
      }
    }
    const percent = totalAssignments > 0 ? Math.round((totalRead / totalAssignments) * 1000) / 10 : 0;
    report.push({ department: dep.name, total_assignments: totalAssignments, total_read: totalRead, percent, not_completed: notCompleted });
  }
  return report;
}

app.get('/api/reports/departments', requireAdmin, (req, res) => {
  res.json(buildDepartmentReport());
});

// История ознакомления с фильтрами: сотрудник, документ, период
app.get('/api/reports/history', requireAdmin, (req, res) => {
  recalcStatuses();
  const { user_id, document_id, date_from, date_to } = req.query;
  let query = `
    SELECT a.id, a.status, a.read_at, a.assigned_at,
           d.id AS document_id, d.title AS document_title, d.publish_date, d.deadline_days,
           u.id AS user_id, u.surname, u.name, u.patronymic, u.tabel_number,
           dep.name AS department_name
    FROM assignments a
    JOIN documents d ON d.id = a.document_id
    JOIN users u ON u.id = a.user_id
    LEFT JOIN departments dep ON dep.id = u.department_id
    WHERE 1=1
  `;
  const params = [];
  if (user_id) { query += ' AND u.id = ?'; params.push(user_id); }
  if (document_id) { query += ' AND d.id = ?'; params.push(document_id); }
  if (date_from) { query += " AND date(a.assigned_at) >= date(?)"; params.push(date_from); }
  if (date_to) { query += " AND date(a.assigned_at) <= date(?)"; params.push(date_to); }
  query += ' ORDER BY a.assigned_at DESC';
  const rows = db.prepare(query).all(...params);
  rows.forEach(r => { r.display_status = computeDisplayStatus(r.status, r.publish_date, r.deadline_days); r.fio = fio(r); });
  res.json(rows);
});

// Экспорт отчёта по подразделениям в Excel
app.get('/api/reports/departments/export/excel', requireAdmin, async (req, res) => {
  const report = buildDepartmentReport();
  const wb = new ExcelJS.Workbook();

  const summary = wb.addWorksheet('Сводка по подразделениям');
  summary.columns = [
    { header: 'Подразделение', key: 'department', width: 30 },
    { header: 'Всего назначений', key: 'total_assignments', width: 18 },
    { header: 'Изучено', key: 'total_read', width: 12 },
    { header: '% изучения', key: 'percent', width: 14 },
    { header: 'Не изучено (кол-во)', key: 'not_completed_count', width: 20 },
  ];
  summary.getRow(1).font = { bold: true };
  report.forEach(r => summary.addRow({
    department: r.department, total_assignments: r.total_assignments,
    total_read: r.total_read, percent: r.percent + '%', not_completed_count: r.not_completed.length
  }));

  const details = wb.addWorksheet('Не прошедшие ознакомление');
  details.columns = [
    { header: 'Подразделение', key: 'department', width: 25 },
    { header: 'Ф.И.О.', key: 'fio', width: 30 },
    { header: 'Табельный номер', key: 'tabel_number', width: 16 },
    { header: 'Документ', key: 'document', width: 35 },
    { header: 'Статус', key: 'status', width: 14 },
    { header: 'Дней просрочки', key: 'overdue_days', width: 16 },
  ];
  details.getRow(1).font = { bold: true };
  report.forEach(r => {
    r.not_completed.forEach(nc => details.addRow({
      department: r.department, fio: nc.fio, tabel_number: nc.tabel_number,
      document: nc.document, status: nc.status === 'overdue' ? 'Просрочено' : 'Не изучено',
      overdue_days: nc.overdue_days
    }));
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="report_departments.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

// Экспорт отчёта по подразделениям в PDF
app.get('/api/reports/departments/export/pdf', requireAdmin, (req, res) => {
  const report = buildDepartmentReport();
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="report_departments.pdf"');
  doc.pipe(res);

  doc.fontSize(16).text('Отчёт по изучению документов по подразделениям', { align: 'center' });
  doc.moveDown();
  doc.fontSize(9).fillColor('gray').text(`Сформирован: ${new Date().toLocaleString('ru-RU')}`, { align: 'center' });
  doc.moveDown(1.5);
  doc.fillColor('black');

  report.forEach(r => {
    doc.fontSize(13).text(`${r.department}`, { underline: true });
    doc.fontSize(10).text(`Всего назначений: ${r.total_assignments}   Изучено: ${r.total_read}   Процент изучения: ${r.percent}%`);
    if (r.not_completed.length) {
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica-Bold').text('Не прошли ознакомление:');
      doc.font('Helvetica');
      r.not_completed.forEach(nc => {
        const statusText = nc.status === 'overdue' ? `просрочено на ${nc.overdue_days} дн.` : 'не изучено';
        doc.fontSize(9).text(`• ${nc.fio} (${nc.tabel_number}) — «${nc.document}» — ${statusText}`);
      });
    } else {
      doc.fontSize(9).fillColor('green').text('Все сотрудники ознакомлены.');
      doc.fillColor('black');
    }
    doc.moveDown(1);
  });

  doc.end();
});

// Экспорт истории ознакомления в Excel
app.get('/api/reports/history/export/excel', requireAdmin, async (req, res) => {
  const { user_id, document_id, date_from, date_to } = req.query;
  let query = `
    SELECT a.status, a.read_at, a.assigned_at,
           d.title AS document_title, d.publish_date, d.deadline_days,
           u.surname, u.name, u.patronymic, u.tabel_number, dep.name AS department_name
    FROM assignments a
    JOIN documents d ON d.id = a.document_id
    JOIN users u ON u.id = a.user_id
    LEFT JOIN departments dep ON dep.id = u.department_id
    WHERE 1=1`;
  const params = [];
  if (user_id) { query += ' AND u.id = ?'; params.push(user_id); }
  if (document_id) { query += ' AND d.id = ?'; params.push(document_id); }
  if (date_from) { query += " AND date(a.assigned_at) >= date(?)"; params.push(date_from); }
  if (date_to) { query += " AND date(a.assigned_at) <= date(?)"; params.push(date_to); }
  const rows = db.prepare(query).all(...params);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('История ознакомления');
  ws.columns = [
    { header: 'Ф.И.О.', key: 'fio', width: 30 },
    { header: 'Табельный номер', key: 'tabel_number', width: 16 },
    { header: 'Подразделение', key: 'department', width: 25 },
    { header: 'Документ', key: 'document', width: 35 },
    { header: 'Дата назначения', key: 'assigned_at', width: 20 },
    { header: 'Статус', key: 'status', width: 14 },
    { header: 'Дата ознакомления', key: 'read_at', width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  rows.forEach(r => {
    const st = computeDisplayStatus(r.status, r.publish_date, r.deadline_days);
    ws.addRow({
      fio: [r.surname, r.name, r.patronymic].filter(Boolean).join(' '),
      tabel_number: r.tabel_number, department: r.department_name || '—',
      document: r.document_title, assigned_at: r.assigned_at,
      status: st === 'read' ? 'Изучено' : st === 'overdue' ? 'Просрочено' : 'Не изучено',
      read_at: r.read_at || '—'
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="history.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

// ================= СТАТИКА =================
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`\n=== Система контроля ознакомления с документами ===`);
  console.log(`Сервер запущен: http://localhost:${PORT}`);
  console.log(`Логин администратора по умолчанию: admin / admin123 (смените после входа)\n`);
});
