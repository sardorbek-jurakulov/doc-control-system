const STATUS_LABEL = { read: 'Изучено', not_read: 'Не изучено', overdue: 'Просрочено' };

function toast(msg, type=''){
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toastRoot').appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }
function openModal(innerHtml){
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal">${innerHtml}</div></div>`;
}
function esc(s){ return (s??'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(s){ if(!s) return '—'; return s.replace('T',' ').slice(0,16); }

async function api(url, opts={}){
  const res = await fetch(url, opts);
  if(res.status === 401){ location.href='index.html'; return; }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if(!res.ok) throw new Error((data && data.error) || 'Ошибка запроса');
  return data;
}

async function guard(){
  try{
    const d = await api('/api/auth/me');
    if(!d) return;
    if(d.user.role === 'admin'){ location.href='admin.html'; return; }
    document.getElementById('whoami').textContent = d.user.fio;
    loadDocs();
    loadNotifications();
  }catch(e){ location.href='index.html'; }
}
function logout(){ api('/api/auth/logout',{method:'POST'}).then(()=>location.href='index.html'); }

async function loadDocs(){
  const rows = await api('/api/my/documents');
  const total = rows.length;
  const read = rows.filter(r=>r.display_status==='read').length;
  const overdue = rows.filter(r=>r.display_status==='overdue').length;
  document.getElementById('statRow').innerHTML = `
    <div class="stat-box"><div class="num">${total}</div><div class="label">Всего назначено</div></div>
    <div class="stat-box"><div class="num">${read}</div><div class="label">Изучено</div></div>
    <div class="stat-box"><div class="num" style="color:${overdue>0?'#c0392b':'inherit'}">${overdue}</div><div class="label">Просрочено</div></div>
  `;
  document.getElementById('docsList').innerHTML = rows.length===0 ? '<div class="empty">Вам пока не назначено ни одного документа</div>' : `
    <table>
      <thead><tr><th>Документ</th><th>Опубликован</th><th>Срок</th><th>Статус</th><th></th></tr></thead>
      <tbody>
      ${rows.map(r=>{
        const deadline = new Date(new Date(r.publish_date.replace(' ','T')).getTime() + r.deadline_days*86400000);
        return `<tr>
          <td><a href="#" onclick="openDoc(${r.assignment_id}, ${r.document_id});return false;"><strong>${esc(r.title)}</strong></a></td>
          <td>${fmtDate(r.publish_date)}</td>
          <td class="muted">до ${fmtDate(deadline.toISOString())}</td>
          <td><span class="badge ${r.display_status}">${STATUS_LABEL[r.display_status]}</span></td>
          <td>${r.display_status!=='read' ? `<button class="btn small" onclick="ackAndOpen(${r.assignment_id}, ${r.document_id})">Ознакомлен(а)</button>` : `<span class="muted">${fmtDate(r.read_at)}</span>`}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
  `;
}

async function openDoc(assignmentId, docId){
  const { doc } = await api('/api/documents/'+docId);
  openModal(`
    <h3>${esc(doc.title)}</h3>
    <div class="muted" style="margin-bottom:12px">Опубликован: ${fmtDate(doc.publish_date)} · Срок ознакомления: ${doc.deadline_days} дн.</div>
    ${doc.description ? `<div class="doc-desc" style="margin-bottom:14px">${esc(doc.description)}</div>` : ''}
    ${doc.file_name ? `<p><a class="btn secondary" href="/api/documents/${doc.id}/file">Скачать файл документа</a></p>` : '<p class="muted">Файл не прикреплён</p>'}
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Закрыть</button>
      <button class="btn" onclick="acknowledge(${assignmentId})">Подтвердить ознакомление</button>
    </div>
  `);
}
async function ackAndOpen(assignmentId, docId){ openDoc(assignmentId, docId); }

async function acknowledge(assignmentId){
  try{
    await api(`/api/my/documents/${assignmentId}/acknowledge`, {method:'POST'});
    toast('Ознакомление зафиксировано','success');
    closeModal();
    loadDocs();
  }catch(e){ toast(e.message,'error'); }
}

/* ===== Уведомления ===== */
let notifOpen = false;
async function loadNotifications(){
  const rows = await api('/api/my/notifications');
  const unread = rows.filter(r=>!r.is_read).length;
  document.getElementById('notifDot').innerHTML = unread>0 ? '<span class="notif-dot"></span>' : '';
  window.__notifRows = rows;
  if(notifOpen) renderNotifPanel();
}
function renderNotifPanel(){
  const rows = window.__notifRows || [];
  document.getElementById('notifPanel').innerHTML = `
    <div class="card-header"><h3>Уведомления</h3><button class="btn small ghost" onclick="markAllRead()">Отметить все прочитанными</button></div>
    <div class="notif-list">
    ${rows.length===0 ? '<div class="empty">Уведомлений нет</div>' : rows.map(n=>`
      <div class="notif-item" style="${n.is_read?'':'font-weight:600'}">
        ${esc(n.message)}
        <div class="time">${fmtDate(n.created_at)}</div>
      </div>
    `).join('')}
    </div>
  `;
}
function toggleNotifications(){
  notifOpen = !notifOpen;
  const panel = document.getElementById('notifPanel');
  panel.style.display = notifOpen ? 'block' : 'none';
  if(notifOpen) renderNotifPanel();
}
async function markAllRead(){
  await api('/api/my/notifications/read-all', {method:'POST'});
  await loadNotifications();
  renderNotifPanel();
}

guard();
setInterval(loadNotifications, 30000);
