let CURRENT_USER = null;
let DEPARTMENTS = [];
let USERS_LITE = [];

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
    if(!d || d.user.role !== 'admin'){ location.href='index.html'; return; }
    CURRENT_USER = d.user;
    document.getElementById('whoami').textContent = d.user.fio;
    DEPARTMENTS = await api('/api/departments');
    USERS_LITE = await api('/api/users/lite');
    switchTab('documents');
  }catch(e){ location.href='index.html'; }
}
function logout(){ api('/api/auth/logout',{method:'POST'}).then(()=>location.href='index.html'); }

function switchTab(tab){
  document.querySelectorAll('.sidebar button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  const c = document.getElementById('content');
  c.innerHTML = '<div class="empty">Загрузка…</div>';
  if(tab==='documents') renderDocuments();
  else if(tab==='users') renderUsers();
  else if(tab==='departments') renderDepartments();
  else if(tab==='reports') renderReports();
  else if(tab==='history') renderHistory();
}

/* ========================= ДОКУМЕНТЫ ========================= */
async function renderDocuments(){
  const docs = await api('/api/documents');
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="card-header">
      <h2>Документы</h2>
      <button class="btn" onclick="openDocForm()">+ Добавить документ</button>
    </div>
    <div class="card">
      ${docs.length===0 ? '<div class="empty">Документов пока нет</div>' : `
      <table>
        <thead><tr><th>Название</th><th>Опубликован</th><th>Срок, дн.</th><th>Ознакомление</th><th>Файл</th><th></th></tr></thead>
        <tbody>
          ${docs.map(d=>{
            const pct = d.total_assigned ? Math.round(d.total_read/d.total_assigned*100) : 0;
            return `<tr>
              <td><a href="#" onclick="openDocDetail(${d.id});return false;"><strong>${esc(d.title)}</strong></a></td>
              <td>${fmtDate(d.publish_date)}</td>
              <td>${d.deadline_days}</td>
              <td style="min-width:160px">
                <div class="muted">${d.total_read}/${d.total_assigned} (${pct}%)</div>
                <div class="progress"><div style="width:${pct}%"></div></div>
              </td>
              <td>${d.file_name ? `<a href="/api/documents/${d.id}/file">скачать</a>` : '<span class="muted">нет</span>'}</td>
              <td style="white-space:nowrap">
                <button class="btn small secondary" onclick="openDocForm(${d.id})">Изм.</button>
                <button class="btn small danger" onclick="deleteDoc(${d.id}, '${esc(d.title).replace(/'/g,"\\'")}')">Удал.</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`}
    </div>
  `;
}

function userChecklistHtml(idPrefix){
  return USERS_LITE.map(u=>{
    const dep = DEPARTMENTS.find(d=>d.id===u.department_id);
    return `<label><input type="checkbox" name="${idPrefix}_user" value="${u.id}"> ${esc(u.surname)} ${esc(u.name)} ${u.patronymic?esc(u.patronymic):''} ${dep?`<span class="muted">(${esc(dep.name)})</span>`:''}</label>`;
  }).join('');
}
function deptChecklistHtml(idPrefix){
  return DEPARTMENTS.map(d=>`<label><input type="checkbox" name="${idPrefix}_dept" value="${d.id}"> ${esc(d.name)}</label>`).join('') || '<div class="muted">Подразделений пока нет</div>';
}

async function openDocForm(id){
  let doc = null;
  if(id){ const r = await api('/api/documents/'+id); doc = r.doc; }
  openModal(`
    <h3>${id ? 'Редактировать документ' : 'Новый документ'}</h3>
    <form id="docForm">
      <div class="field"><label>Название документа *</label><input id="docTitle" required value="${doc?esc(doc.title):''}"></div>
      <div class="field"><label>Описание</label><textarea id="docDesc" rows="3">${doc?esc(doc.description||''):''}</textarea></div>
      <div class="grid2">
        <div class="field"><label>Срок ознакомления, дней</label><input id="docDeadline" type="number" min="1" value="${doc?doc.deadline_days:7}"></div>
        <div class="field"><label>Файл документа ${doc && doc.file_original_name ? `(текущий: ${esc(doc.file_original_name)})`:''}</label><input id="docFile" type="file"></div>
      </div>
      ${!id ? `
      <div class="field"><label>Назначить подразделениям</label><div class="checklist">${deptChecklistHtml('new')}</div></div>
      <div class="field"><label>Назначить отдельным сотрудникам</label><div class="checklist">${userChecklistHtml('new')}</div></div>
      ` : `<div class="hint">Чтобы назначить документ дополнительным сотрудникам или подразделениям, откройте карточку документа после сохранения.</div>`}
      <div class="modal-actions">
        <button type="button" class="btn ghost" onclick="closeModal()">Отмена</button>
        <button type="submit" class="btn">${id?'Сохранить':'Создать и назначить'}</button>
      </div>
    </form>
  `);
  document.getElementById('docForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData();
    fd.append('title', document.getElementById('docTitle').value.trim());
    fd.append('description', document.getElementById('docDesc').value.trim());
    fd.append('deadline_days', document.getElementById('docDeadline').value || 7);
    const file = document.getElementById('docFile').files[0];
    if(file) fd.append('file', file);
    if(!id){
      const uIds = [...document.querySelectorAll('input[name=new_user]:checked')].map(i=>i.value);
      const dIds = [...document.querySelectorAll('input[name=new_dept]:checked')].map(i=>i.value);
      fd.append('user_ids', JSON.stringify(uIds));
      fd.append('department_ids', JSON.stringify(dIds));
    }
    try{
      await api(id ? '/api/documents/'+id : '/api/documents', { method: id?'PUT':'POST', body: fd });
      closeModal(); toast(id?'Документ обновлён':'Документ создан и назначен', 'success');
      renderDocuments();
    }catch(err){ toast(err.message, 'error'); }
  });
}

async function openDocDetail(id){
  const { doc, assignments } = await api('/api/documents/'+id);
  openModal(`
    <h3>${esc(doc.title)}</h3>
    <div class="muted" style="margin-bottom:10px">Опубликован: ${fmtDate(doc.publish_date)} · Срок: ${doc.deadline_days} дн.</div>
    ${doc.description ? `<div class="doc-desc" style="margin-bottom:14px">${esc(doc.description)}</div>` : ''}
    <div style="max-height:260px;overflow-y:auto;margin-bottom:14px">
      <table>
        <thead><tr><th>Сотрудник</th><th>Подразделение</th><th>Статус</th><th>Дата ознакомления</th></tr></thead>
        <tbody>
        ${assignments.map(a=>`<tr>
          <td>${esc(a.surname)} ${esc(a.name)} ${a.patronymic?esc(a.patronymic):''}</td>
          <td>${a.department_name?esc(a.department_name):'—'}</td>
          <td><span class="badge ${a.display_status}">${STATUS_LABEL[a.display_status]}</span></td>
          <td>${fmtDate(a.read_at)}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty">Документ никому не назначен</td></tr>'}
        </tbody>
      </table>
    </div>
    <details>
      <summary style="cursor:pointer;font-weight:600;font-size:13.5px;margin-bottom:8px">+ Назначить дополнительно</summary>
      <div class="field"><label>Подразделения</label><div class="checklist">${deptChecklistHtml('add')}</div></div>
      <div class="field"><label>Сотрудники</label><div class="checklist">${userChecklistHtml('add')}</div></div>
      <button class="btn small" onclick="assignMore(${id})">Назначить</button>
    </details>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Закрыть</button>
    </div>
  `);
}
async function assignMore(docId){
  const uIds = [...document.querySelectorAll('input[name=add_user]:checked')].map(i=>Number(i.value));
  const dIds = [...document.querySelectorAll('input[name=add_dept]:checked')].map(i=>Number(i.value));
  try{
    const r = await api(`/api/documents/${docId}/assign`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({user_ids:uIds, department_ids:dIds})});
    toast(`Назначено дополнительно: ${r.added}`, 'success');
    closeModal(); openDocDetail(docId);
  }catch(e){ toast(e.message,'error'); }
}
async function deleteDoc(id, title){
  if(!confirm(`Удалить документ «${title}»? Это действие необратимо.`)) return;
  try{ await api('/api/documents/'+id, {method:'DELETE'}); toast('Документ удалён','success'); renderDocuments(); }
  catch(e){ toast(e.message,'error'); }
}

/* ========================= СОТРУДНИКИ ========================= */
async function renderUsers(){
  const users = await api('/api/users');
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="card-header"><h2>Сотрудники</h2><button class="btn" onclick="openUserForm()">+ Добавить сотрудника</button></div>
    <div class="card">
      <table>
        <thead><tr><th>Ф.И.О.</th><th>Табельный №</th><th>Подразделение</th><th>Логин</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
        <tbody>
        ${users.map(u=>`<tr>
          <td>${esc(u.surname)} ${esc(u.name)} ${u.patronymic?esc(u.patronymic):''}</td>
          <td>${esc(u.tabel_number)}</td>
          <td>${u.department_name?esc(u.department_name):'<span class="muted">—</span>'}</td>
          <td>${esc(u.login)}</td>
          <td><span class="badge ${u.role}">${u.role==='admin'?'Администратор':'Сотрудник'}</span></td>
          <td>${u.is_active? '<span class="badge read">Активен</span>' : '<span class="badge inactive">Отключен</span>'}</td>
          <td style="white-space:nowrap">
            <button class="btn small secondary" onclick='openUserForm(${u.id})'>Изм.</button>
            <button class="btn small danger" onclick="deleteUser(${u.id}, '${esc(u.surname+' '+u.name).replace(/'/g,"\\'")}')">Удал.</button>
          </td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function openUserForm(id){
  let u = null;
  if(id){ u = (await api('/api/users')).find(x=>x.id===id); }
  const deptOptions = `<option value="">— не выбрано —</option>` + DEPARTMENTS.map(d=>`<option value="${d.id}" ${u&&u.department_id===d.id?'selected':''}>${esc(d.name)}</option>`).join('');
  const managerOptions = `<option value="">— не выбрано —</option>` + USERS_LITE.filter(x=>x.id!==id).map(x=>`<option value="${x.id}" ${u&&u.manager_id===x.id?'selected':''}>${esc(x.surname)} ${esc(x.name)}</option>`).join('');
  openModal(`
    <h3>${id?'Редактировать сотрудника':'Новый сотрудник'}</h3>
    <form id="userForm">
      <div class="grid2">
        <div class="field"><label>Фамилия *</label><input id="uSurname" required value="${u?esc(u.surname):''}"></div>
        <div class="field"><label>Имя *</label><input id="uName" required value="${u?esc(u.name):''}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Отчество</label><input id="uPatronymic" value="${u?esc(u.patronymic||''):''}"></div>
        <div class="field"><label>Табельный номер *</label><input id="uTabel" required value="${u?esc(u.tabel_number):''}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Подразделение</label><select id="uDept">${deptOptions}</select></div>
        <div class="field"><label>Должность</label><input id="uPosition" value="${u?esc(u.position||''):''}"></div>
      </div>
      <div class="field"><label>Непосредственный руководитель</label><select id="uManager">${managerOptions}</select></div>
      <div class="grid2">
        <div class="field"><label>Логин *</label><input id="uLogin" required value="${u?esc(u.login):''}"></div>
        <div class="field"><label>Роль</label><select id="uRole"><option value="user" ${u&&u.role==='user'?'selected':''}>Сотрудник</option><option value="admin" ${u&&u.role==='admin'?'selected':''}>Администратор</option></select></div>
      </div>
      <div class="field"><label>${id?'Новый пароль (оставьте пустым, если не менять)':'Пароль *'}</label><input id="uPassword" type="password" ${id?'':'required'}></div>
      ${id?`<div class="field"><label><input type="checkbox" id="uActive" style="width:auto" ${u&&u.is_active?'checked':''}> Учётная запись активна</label></div>`:''}
      <div class="modal-actions">
        <button type="button" class="btn ghost" onclick="closeModal()">Отмена</button>
        <button type="submit" class="btn">${id?'Сохранить':'Создать'}</button>
      </div>
    </form>
  `);
  document.getElementById('userForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const payload = {
      surname: document.getElementById('uSurname').value.trim(),
      name: document.getElementById('uName').value.trim(),
      patronymic: document.getElementById('uPatronymic').value.trim(),
      tabel_number: document.getElementById('uTabel').value.trim(),
      department_id: document.getElementById('uDept').value || null,
      position: document.getElementById('uPosition').value.trim(),
      manager_id: document.getElementById('uManager').value || null,
      login: document.getElementById('uLogin').value.trim(),
      role: document.getElementById('uRole').value,
      password: document.getElementById('uPassword').value,
    };
    if(id) payload.is_active = document.getElementById('uActive').checked;
    try{
      await api(id?'/api/users/'+id:'/api/users', {method:id?'PUT':'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
      closeModal(); toast(id?'Сотрудник обновлён':'Сотрудник добавлен','success');
      USERS_LITE = await api('/api/users/lite');
      renderUsers();
    }catch(err){ toast(err.message,'error'); }
  });
}
async function deleteUser(id, name){
  if(!confirm(`Удалить сотрудника «${name}»? Будет удалена вся история его назначений.`)) return;
  try{ await api('/api/users/'+id,{method:'DELETE'}); toast('Сотрудник удалён','success'); USERS_LITE = await api('/api/users/lite'); renderUsers(); }
  catch(e){ toast(e.message,'error'); }
}

/* ========================= ПОДРАЗДЕЛЕНИЯ ========================= */
async function renderDepartments(){
  DEPARTMENTS = await api('/api/departments');
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="card-header"><h2>Подразделения</h2><button class="btn" onclick="openDeptForm()">+ Добавить подразделение</button></div>
    <div class="card">
      ${DEPARTMENTS.length===0?'<div class="empty">Подразделений пока нет</div>':`
      <table><thead><tr><th>Название</th><th></th></tr></thead><tbody>
      ${DEPARTMENTS.map(d=>`<tr><td>${esc(d.name)}</td><td style="white-space:nowrap">
        <button class="btn small secondary" onclick="openDeptForm(${d.id},'${esc(d.name).replace(/'/g,"\\'")}')">Изм.</button>
        <button class="btn small danger" onclick="deleteDept(${d.id},'${esc(d.name).replace(/'/g,"\\'")}')">Удал.</button>
      </td></tr>`).join('')}
      </tbody></table>`}
    </div>
  `;
}
function openDeptForm(id, name){
  openModal(`
    <h3>${id?'Редактировать подразделение':'Новое подразделение'}</h3>
    <form id="deptForm">
      <div class="field"><label>Название *</label><input id="deptName" required value="${name?esc(name):''}"></div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" onclick="closeModal()">Отмена</button>
        <button type="submit" class="btn">${id?'Сохранить':'Создать'}</button>
      </div>
    </form>
  `);
  document.getElementById('deptForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const nm = document.getElementById('deptName').value.trim();
    try{
      await api(id?'/api/departments/'+id:'/api/departments', {method:id?'PUT':'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:nm})});
      closeModal(); toast('Сохранено','success'); renderDepartments();
    }catch(err){ toast(err.message,'error'); }
  });
}
async function deleteDept(id, name){
  if(!confirm(`Удалить подразделение «${name}»?`)) return;
  try{ await api('/api/departments/'+id,{method:'DELETE'}); toast('Удалено','success'); renderDepartments(); }
  catch(e){ toast(e.message,'error'); }
}

/* ========================= ОТЧЁТЫ ========================= */
async function renderReports(){
  const report = await api('/api/reports/departments');
  const totalAssigned = report.reduce((s,r)=>s+r.total_assignments,0);
  const totalRead = report.reduce((s,r)=>s+r.total_read,0);
  const totalNotCompleted = report.reduce((s,r)=>s+r.not_completed.length,0);
  const overallPct = totalAssigned? Math.round(totalRead/totalAssigned*1000)/10 : 0;

  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="card-header"><h2>Отчёты по подразделениям</h2>
      <div>
        <a class="btn secondary" href="/api/reports/departments/export/excel">Excel</a>
        <a class="btn secondary" href="/api/reports/departments/export/pdf">PDF</a>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat-box"><div class="num">${overallPct}%</div><div class="label">Общий процент изучения</div></div>
      <div class="stat-box"><div class="num">${totalRead}/${totalAssigned}</div><div class="label">Изучено назначений</div></div>
      <div class="stat-box"><div class="num">${totalNotCompleted}</div><div class="label">Не прошли ознакомление</div></div>
    </div>
    ${report.map(r=>`
      <div class="card">
        <div class="card-header"><h3>${esc(r.department)}</h3><span class="muted">${r.total_read}/${r.total_assignments} · ${r.percent}%</span></div>
        <div class="progress"><div style="width:${r.percent}%"></div></div>
        ${r.not_completed.length ? `
        <table style="margin-top:14px">
          <thead><tr><th>Сотрудник</th><th>Документ</th><th>Статус</th><th>Просрочка</th></tr></thead>
          <tbody>
          ${r.not_completed.map(nc=>`<tr>
            <td>${esc(nc.fio)} <span class="muted">(${esc(nc.tabel_number)})</span></td>
            <td>${esc(nc.document)}</td>
            <td><span class="badge ${nc.status}">${STATUS_LABEL[nc.status]}</span></td>
            <td>${nc.overdue_days>0?nc.overdue_days+' дн.':'—'}</td>
          </tr>`).join('')}
          </tbody>
        </table>` : `<div class="muted" style="margin-top:10px">Все сотрудники ознакомлены ✓</div>`}
      </div>
    `).join('') || '<div class="empty">Нет данных для отчёта</div>'}
  `;
}

/* ========================= ИСТОРИЯ ========================= */
async function renderHistory(){
  const c = document.getElementById('content');
  const docs = await api('/api/documents');
  c.innerHTML = `
    <div class="card-header"><h2>История ознакомления</h2></div>
    <div class="card">
      <div class="grid3">
        <div class="field"><label>Сотрудник</label><select id="hUser"><option value="">Все</option>${USERS_LITE.map(u=>`<option value="${u.id}">${esc(u.surname)} ${esc(u.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Документ</label><select id="hDoc"><option value="">Все</option>${docs.map(d=>`<option value="${d.id}">${esc(d.title)}</option>`).join('')}</select></div>
        <div class="field"><label>Период</label>
          <div style="display:flex;gap:6px">
            <input id="hFrom" type="date"><input id="hTo" type="date">
          </div>
        </div>
      </div>
      <button class="btn" onclick="loadHistory()">Применить фильтр</button>
      <a class="btn secondary" id="exportHistBtn" href="#" style="margin-left:8px">Выгрузить в Excel</a>
    </div>
    <div class="card" id="historyResult"><div class="empty">Задайте фильтр и нажмите «Применить»</div></div>
  `;
  loadHistory();
}
async function loadHistory(){
  const params = new URLSearchParams();
  const u = document.getElementById('hUser').value, d = document.getElementById('hDoc').value;
  const from = document.getElementById('hFrom').value, to = document.getElementById('hTo').value;
  if(u) params.set('user_id', u);
  if(d) params.set('document_id', d);
  if(from) params.set('date_from', from);
  if(to) params.set('date_to', to);
  document.getElementById('exportHistBtn').href = '/api/reports/history/export/excel?' + params.toString();

  const rows = await api('/api/reports/history?' + params.toString());
  document.getElementById('historyResult').innerHTML = rows.length===0 ? '<div class="empty">Записей не найдено</div>' : `
    <table>
      <thead><tr><th>Сотрудник</th><th>Подразделение</th><th>Документ</th><th>Назначено</th><th>Статус</th><th>Ознакомлен</th></tr></thead>
      <tbody>
      ${rows.map(r=>`<tr>
        <td>${esc(r.fio)} <span class="muted">(${esc(r.tabel_number)})</span></td>
        <td>${r.department_name?esc(r.department_name):'—'}</td>
        <td>${esc(r.document_title)}</td>
        <td>${fmtDate(r.assigned_at)}</td>
        <td><span class="badge ${r.display_status}">${STATUS_LABEL[r.display_status]}</span></td>
        <td>${fmtDate(r.read_at)}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  `;
}

guard();
