const db = require('./db');

// Пересчитывает статусы всех назначений: not_read -> overdue, если прошло больше deadline_days
// и при первом переходе в overdue создаёт уведомления сотруднику, руководителю и (опционально) ответственному подразделению.
function recalcStatuses() {
  const assignments = db.prepare(`
    SELECT a.*, d.publish_date, d.deadline_days, d.title AS doc_title,
           u.manager_id, u.surname, u.name
    FROM assignments a
    JOIN documents d ON d.id = a.document_id
    JOIN users u ON u.id = a.user_id
    WHERE a.status = 'not_read'
  `).all();

  const now = new Date();
  const notifyStmt = db.prepare(`INSERT INTO notifications (user_id, document_id, message, type) VALUES (?, ?, ?, ?)`);
  const updateStmt = db.prepare(`UPDATE assignments SET status = 'overdue' WHERE id = ?`);

  for (const a of assignments) {
    const publish = new Date(a.publish_date.replace(' ', 'T'));
    const deadline = new Date(publish.getTime() + a.deadline_days * 24 * 60 * 60 * 1000);
    if (now > deadline) {
      updateStmt.run(a.id);
      const fio = `${a.surname} ${a.name}`;
      // уведомление сотруднику
      notifyStmt.run(a.user_id, a.document_id,
        `Просрочено ознакомление с документом «${a.doc_title}». Пожалуйста, изучите документ незамедлительно.`,
        'overdue');
      // уведомление руководителю
      if (a.manager_id) {
        notifyStmt.run(a.manager_id, a.document_id,
          `Сотрудник ${fio} не ознакомился с документом «${a.doc_title}» в установленный срок (7 дней).`,
          'manager_overdue');
      }
    }
  }
}

// Определяет фактический статус (для отображения), не изменяя БД лишний раз — используется при чтении списков
function computeDisplayStatus(status, publish_date, deadline_days) {
  if (status === 'read') return 'read';
  const now = new Date();
  const publish = new Date(publish_date.replace(' ', 'T'));
  const deadline = new Date(publish.getTime() + deadline_days * 24 * 60 * 60 * 1000);
  return now > deadline ? 'overdue' : 'not_read';
}

module.exports = { recalcStatuses, computeDisplayStatus };
