/**
 * 資產管理系統前端。
 * 網址：QR 貼紙為 /?F<資產編號> 或 /?C<保管品鍵>，載入時轉成內部路由 #/asset/F/<編號>。
 * 權限判斷只用來決定顯示什麼；真正的權限檢查在後端。
 */

const TOKEN_KEY = 'asset.idToken';
const state = { config: null, token: null, tokenExp: 0, me: guest() };

function guest() {
  return { email: '', name: '', role: ROLE_VISITOR, loggedIn: false };
}

// ---------- 工具 ----------

const $ = (sel) => document.querySelector(sel);

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg, bad) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, bad ? 5000 : 2500);
}

function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 私密瀏覽等情況，不保存也能用 */ } }
function storeDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 同上 */ } }

function tokenExpiry(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part)).exp || 0;
  } catch (e) { return 0; }
}

// ---------- 後端呼叫 ----------

class ApiError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; }
}

async function api(action, payload) {
  if (state.token && Date.now() / 1000 > state.tokenExp - 60) signedOut('登入已過期，請重新登入');
  let res;
  try {
    res = await fetch(state.config.apiUrl, {
      method: 'POST', // 不設 Content-Type，維持簡單請求、避免跨網域預檢
      body: JSON.stringify({ action, idToken: state.token || undefined, payload }),
    });
  } catch (e) {
    throw new ApiError('NETWORK', '無法連線，請確認網路後再試');
  }
  const r = await res.json();
  if (r.ok) return r.data;
  const err = r.error || {};
  if (err.code === 'UNAUTHENTICATED' && state.token) signedOut(err.message);
  throw new ApiError(err.code, err.message || ERROR_MESSAGES.INTERNAL, err.detail);
}

// ---------- 登入 ----------

function restoreToken() {
  const t = storeGet(TOKEN_KEY);
  if (t && tokenExpiry(t) > Date.now() / 1000 + 60) {
    state.token = t;
    state.tokenExp = tokenExpiry(t);
  } else if (t) {
    storeDel(TOKEN_KEY);
  }
}

async function onCredential(resp) {
  state.token = resp.credential;
  state.tokenExp = tokenExpiry(resp.credential);
  storeSet(TOKEN_KEY, resp.credential);
  await loadMe();
  render();
}

async function loadMe() {
  if (!state.token) { state.me = guest(); return; }
  try {
    state.me = await api('whoami');
  } catch (e) {
    if (e.code !== 'UNAUTHENTICATED') toast(e.message, true);
  }
  renderWho();
}

function signedOut(message) {
  state.token = null;
  state.tokenExp = 0;
  state.me = guest();
  storeDel(TOKEN_KEY);
  if (message) toast(message, true);
  renderWho();
}

function signOut() {
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  signedOut();
  toast('已登出');
  render();
}

function initGoogle() {
  if (!window.google || !google.accounts) return setTimeout(initGoogle, 150);
  google.accounts.id.initialize({
    client_id: state.config.clientId,
    callback: onCredential,
    auto_select: true,
    cancel_on_tap_outside: true,
  });
  renderWho();
}

function renderWho() {
  const box = $('#who');
  const me = state.me;
  if (me.loggedIn) {
    const roleChip = me.role === ROLE_VISITOR ? '' : '<span class="chip accent">' + esc(me.role) + '</span>';
    box.innerHTML = '<span class="name">' + esc(me.name || me.email) + '</span>' + roleChip +
      '<button type="button" id="signOut">登出</button>';
    $('#signOut').onclick = signOut;
    return;
  }
  box.innerHTML = '<div id="gisButton"></div>';
  if (window.google && google.accounts) {
    google.accounts.id.renderButton($('#gisButton'), {
      theme: 'outline', size: 'medium', text: 'signin', shape: 'pill', locale: 'zh-TW',
    });
  }
}

// ---------- 路由 ----------

/** QR 網址（?F…／?C…）轉成內部路由。 */
function routeFromQr() {
  const m = location.search.match(/^\?([FC])(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + '#/asset/' + m[1] + '/' + encodeURIComponent(decodeURIComponent(m[2])));
}

const routes = [
  { re: /^#?\/?$/, view: viewHome },
  { re: /^#\/asset\/([FC])\/(.+)$/, view: viewAsset },
  { re: /^#\/admins$/, view: viewAdmins, perm: 'admin.manage' },
  { re: /^#\/import$/, view: viewImport, perm: 'asset.import' },
];

function render() {
  const hash = location.hash || '#/';
  const view = $('#view');
  for (const r of routes) {
    const m = hash.match(r.re);
    if (!m) continue;
    if (r.perm && !can(state.me.role, r.perm)) {
      view.innerHTML = '<div class="card center"><h2>需要權限</h2><p class="muted">' +
        (state.me.loggedIn ? '您沒有權限使用這個頁面。' : '請先登入。') + '</p><a class="btn" href="#/">回首頁</a></div>';
      return;
    }
    r.view(view, m.slice(1).map(decodeURIComponent));
    window.scrollTo(0, 0);
    return;
  }
  view.innerHTML = '<div class="card center"><h2>找不到這個網址</h2><p class="muted">請確認網址或 QR 貼紙是否正確。</p>' +
    '<a class="btn primary" href="#/">回首頁</a></div>';
}

// ---------- 頁面 ----------

function tile(href, title, sub, ready) {
  return '<a class="tile' + (ready ? '' : ' disabled') + '" href="' + href + '"><strong>' + esc(title) +
    '</strong><span>' + esc(ready ? sub : '即將推出') + '</span></a>';
}

function viewHome(view) {
  const role = state.me.role;
  let html = '';
  if (can(role, 'asset.view')) {
    html += '<h1>工作選單</h1><div class="grid">' +
      tile('#/scan', '掃描 QR', '盤點、借出、歸還', false) +
      tile('#/assets', '資產清單', '查詢與編輯', false) +
      tile('#/inventory', '盤點', '年度與不定期', false) +
      tile('#/loans', '借用', '申請、借出、歸還', false) +
      tile('#/import', '匯入', '學校清冊 Excel', true) +
      tile('#/cases', '異常案件', '登記與處理', false) +
      '</div>';
    if (can(role, 'admin.manage')) {
      html += '<h1 style="margin-top:20px">系統（一等）</h1><div class="grid">' +
        tile('#/admins', '管理者', '新增、停用', true) +
        tile('#/system', '備份與交接', '每月備份、交接包', false) +
        tile('#/logs', '操作紀錄', '查詢 LOG', false) +
        '</div>';
    }
  } else {
    html += '<h1>可借設備</h1><div class="card"><p class="muted" style="margin:0">設備清單建置中。' +
      '管理者請按右上角登入。</p></div>';
  }
  view.innerHTML = html;
}

function viewAsset(view, params) {
  const type = params[0] === 'F' ? '固定資產' : '保管品';
  const key = params[1];
  let html = '<h1>' + esc(type) + ' ' + esc(key) + '</h1>' +
    '<div class="card"><p class="muted" style="margin:0">資產詳細資料（名稱、照片、可否借用）建置中。</p></div>';
  if (can(state.me.role, 'asset.view')) {
    html += '<div class="card"><h2>管理</h2><div class="row">' +
      '<button disabled>盤點</button><button disabled>借出</button><button disabled>歸還</button>' +
      '<button disabled>補拍建檔照片</button></div></div>';
  }
  view.innerHTML = html + '<a class="btn" href="#/">回首頁</a>';
}

// ----- 管理者 -----

async function viewAdmins(view) {
  view.innerHTML = '<h1>管理者</h1><p class="muted">載入中…</p>';
  let rows;
  try {
    rows = await api('admin.list');
  } catch (e) {
    view.innerHTML = '<h1>管理者</h1><div class="card"><p>' + esc(e.message) + '</p></div>';
    return;
  }
  const items = rows.map((a, i) =>
    '<li class="row spread"><div><div>' + esc(a['姓名'] || '（未填姓名）') + ' ' +
    '<span class="chip accent">' + esc(a['等級']) + '</span> ' +
    '<span class="chip ' + (a['狀態'] === '啟用' ? 'ok' : 'bad') + '">' + esc(a['狀態']) + '</span></div>' +
    '<div class="meta">' + esc(a['Email']) + (a['備註'] ? '｜' + esc(a['備註']) : '') + '</div></div>' +
    '<button type="button" data-edit="' + i + '">編輯</button></li>').join('');

  view.innerHTML = '<h1>管理者</h1>' +
    '<div class="card"><ul class="list">' + items + '</ul></div>' +
    '<div class="card"><h2>新增管理者</h2><form id="addForm">' +
    '<label for="aEmail">Google 帳號 Email</label><input id="aEmail" type="email" required autocomplete="off">' +
    '<label for="aName">姓名</label><input id="aName" required>' +
    '<label for="aLevel">等級</label><select id="aLevel"><option>二等</option><option>一等</option></select>' +
    '<label for="aNote">備註（例如：職員、工讀生）</label><input id="aNote">' +
    '<div class="row" style="margin-top:12px"><button class="primary" type="submit">新增</button></div></form></div>';

  view.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => editAdmin(rows[Number(b.dataset.edit)]);
  });
  $('#addForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter; btn.disabled = true;
    try {
      await api('admin.add', {
        email: $('#aEmail').value, name: $('#aName').value, level: $('#aLevel').value, note: $('#aNote').value,
      });
      toast('已新增');
      viewAdmins(view);
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
    }
  };
}

function editAdmin(a) {
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  const opt = (list, v) => list.map((x) => '<option' + (x === v ? ' selected' : '') + '>' + x + '</option>').join('');
  form.innerHTML = '<h2>編輯管理者</h2><div class="meta muted">' + esc(a['Email']) + '</div>' +
    '<label for="eName">姓名</label><input id="eName" value="' + esc(a['姓名']) + '">' +
    '<label for="eLevel">等級</label><select id="eLevel">' + opt(['二等', '一等'], a['等級']) + '</select>' +
    '<label for="eStatus">狀態</label><select id="eStatus">' + opt(['啟用', '停用'], a['狀態']) + '</select>' +
    '<label for="eNote">備註</label><input id="eNote" value="' + esc(a['備註']) + '">' +
    '<label for="eReason">修改原因（會記入紀錄）</label><input id="eReason">' +
    '<div class="row" style="margin-top:14px;justify-content:flex-end">' +
    '<button value="cancel" formnovalidate>取消</button><button class="primary" id="eSave" value="save">儲存</button></div>';
  $('#eSave').onclick = async (ev) => {
    ev.preventDefault();
    ev.target.disabled = true;
    try {
      await api('admin.update', {
        email: a['Email'], version: a['版本'], reason: $('#eReason').value,
        changes: { 姓名: $('#eName').value, 等級: $('#eLevel').value, 狀態: $('#eStatus').value, 備註: $('#eNote').value },
      });
      dlg.close();
      toast('已儲存');
    } catch (e) {
      ev.target.disabled = false;
      toast(e.message, true);
      if (e.code !== 'VERSION_CONFLICT') return;
      dlg.close();
    }
    if (a['Email'] === state.me.email) await loadMe();
    render();
  };
  dlg.showModal();
}

// ----- 匯入 -----

const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const IMPORT_SHOW_MAX = 300;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.onload = resolve;
    el.onerror = () => reject(new Error('無法載入 Excel 讀取元件，請確認網路後再試'));
    document.head.appendChild(el);
  });
}

/** 讀 Excel 第一個分頁為「標題 → 文字」的列；日期轉成 yyyy/mm/dd 文字。 */
async function readExcel(file) {
  if (!window.XLSX) await loadScript(SHEETJS_URL);
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, dateNF: 'yyyy/mm/dd' });
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { rows, base64: btoa(bin), sheetName: wb.SheetNames[0] };
}

async function viewImport(view) {
  const type = storeGet('asset.importType') === 'CUSTODY' ? 'CUSTODY' : 'FIXED';
  view.innerHTML = '<h1>匯入學校清冊</h1>' +
    '<div class="card"><div class="row">' +
    ['FIXED', 'CUSTODY'].map((t) => '<label class="radio"><input type="radio" name="iType" value="' + t + '"' +
      (t === type ? ' checked' : '') + '> ' + IMPORT_TEMPLATES[t].label + '</label>').join('') +
    '</div><label for="iFile">Excel 檔（格式見匯入範本；PDF 請先用轉檔程式轉成 Excel）</label>' +
    '<input id="iFile" type="file" accept=".xlsx,.xls">' +
    '<p class="muted small">只會比對、更新檔案裡有的欄位；系統上的狀態、經管人、備註、照片不會被改。' +
    '檔案沒有的資料只標成「待確認」，不會刪除。</p></div>' +
    '<div id="iPreview"></div><div id="iBatches"></div>';
  view.querySelectorAll('[name=iType]').forEach((r) => {
    r.onchange = () => { storeSet('asset.importType', r.value); viewImport(view); };
  });
  $('#iFile').onchange = () => { if ($('#iFile').files[0]) previewImport(type, $('#iFile').files[0]); };
  try {
    const cur = await api('import.current', { type });
    renderBatches(cur.batches);
  } catch (e) {
    $('#iBatches').innerHTML = '<div class="card"><p>' + esc(e.message) + '</p></div>';
  }
}

function renderBatches(batches) {
  if (!batches.length) { $('#iBatches').innerHTML = ''; return; }
  $('#iBatches').innerHTML = '<div class="card"><h2>最近的匯入</h2><ul class="list">' + batches.map((b) =>
    '<li><div>' + esc(b['批次編號']) + ' <span class="chip">' + esc(b['狀態']) + '</span></div><div class="meta">' +
    esc(b['匯入時間']) + '｜' + esc(b['匯入者']) + '｜' + esc(b['來源檔名']) + '｜新增 ' + esc(b['新增數']) +
    '、變更 ' + esc(b['變更數']) + '、待確認 ' + esc(b['消失數']) + '</div></li>').join('') + '</ul></div>';
}

async function previewImport(type, file) {
  const box = $('#iPreview');
  box.innerHTML = '<div class="card"><p class="muted">讀取與比對中…</p></div>';
  let excel, cur;
  try {
    [excel, cur] = await Promise.all([readExcel(file), api('import.current', { type })]);
  } catch (e) {
    box.innerHTML = '<div class="card"><p>' + esc(e.message) + '</p></div>';
    return;
  }
  const parsed = parseImportRows(type, excel.rows, { defaultDept: cur.defaultDept });
  const errors = parsed.issues.filter((i) => i.level === 'error');
  const warnings = parsed.issues.filter((i) => i.level === 'warning');
  const issueList = (list) => '<ul class="list">' + list.slice(0, IMPORT_SHOW_MAX).map((i) =>
    '<li class="meta">第 ' + i.row + ' 列｜' + esc(i.field) + '｜' + esc(i.message) + '</li>').join('') +
    more(list.length) + '</ul>';

  let html = '<div class="card"><h2>' + esc(file.name) + '</h2><div class="meta">分頁「' + esc(excel.sheetName) + '」，' +
    excel.rows.length + ' 列；可匯入 ' + parsed.records.length + ' 筆</div>';
  if (parsed.unknownColumns.length) {
    html += '<p class="meta">略過的欄位：' + esc(parsed.unknownColumns.join('、')) + '</p>';
  }
  if (errors.length) {
    html += '<details open><summary><span class="chip bad">錯誤 ' + errors.length + '</span> 這些列不會匯入，請修正檔案後重新選擇</summary>' +
      issueList(errors) + '</details>';
  }
  if (warnings.length) {
    html += '<details><summary><span class="chip warn">提醒 ' + warnings.length + '</span> 可以匯入，但請先看過</summary>' +
      issueList(warnings) + '</details>';
  }
  html += '</div>';
  if (!parsed.records.length) { box.innerHTML = html; return; }

  const diff = diffImport(type, parsed.records, parsed.fields, cur.rows);
  const signature = diffSignature(diff);
  const nameField = type === 'FIXED' ? '資產名稱' : '品名規格';
  const showKey = (k) => esc(k.replace(/#0$/, '').replace('#', '（增值 ') + (/#[1-9]/.test(k) ? '）' : ''));
  const section = (title, chipClass, list, line) => '<details' + (list.length && list.length <= 20 ? ' open' : '') +
    '><summary><span class="chip ' + chipClass + '">' + title + ' ' + list.length + '</span></summary><ul class="list">' +
    list.slice(0, IMPORT_SHOW_MAX).map(line).join('') + more(list.length) + '</ul></details>';

  html += '<div class="card"><h2>與系統比對</h2><div class="meta">比對範圍：部門 ' + esc(diff.scope.join('、') || '（無）') +
    '；其他部門的資料不受影響。未變 ' + diff.unchanged + ' 筆。</div>' +
    section('新增', 'ok', diff.added, (r) => '<li><strong>' + showKey(importRowKey(type, r)) + '</strong> ' +
      esc(r[nameField]) + '<div class="meta">' + esc(r['保管人姓名'] || r['保管人代號']) + '｜' + esc(r['存放位置'] || r['部門代號']) + '</div></li>') +
    section('變更', 'accent', diff.changed, (c) => '<li><strong>' + showKey(c.key) + '</strong><div class="meta">' +
      Object.keys(c.after).map((f) => esc(f) + '：' + esc(c.before[f] || '（空白）') + ' → ' + esc(c.after[f] || '（空白）')).join('<br>') +
      '</div></li>') +
    section('檔案沒有 → 標為待確認', 'bad', diff.missing, (m) => '<li><strong>' + showKey(m.key) + '</strong> ' + esc(m.name) + '</li>');

  const total = diff.added.length + diff.changed.length + diff.missing.length;
  if (!total) {
    html += '<p>系統資料和檔案一致，不需要匯入。</p></div>';
    box.innerHTML = html;
    return;
  }
  html += '<label for="iReason">說明（選填，會記入紀錄；例：115 年 3 月財產目錄）</label><input id="iReason">' +
    '<div class="row" style="margin-top:12px"><button class="primary" id="iGo">確認匯入（新增 ' + diff.added.length +
    '、變更 ' + diff.changed.length + '、待確認 ' + diff.missing.length + '）</button></div></div>';
  box.innerHTML = html;

  $('#iGo').onclick = async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = '寫入中，請勿關閉頁面…';
    try {
      const r = await api('import.commit', {
        type, fileName: file.name, fileBase64: excel.base64, rows: excel.rows, signature, reason: $('#iReason').value,
      });
      box.innerHTML = '<div class="card"><h2>匯入完成</h2><p>批次 ' + esc(r.batchId) + '：新增 ' + r.added + '、變更 ' +
        r.changed + '、待確認 ' + r.missing + '、未變 ' + r.unchanged + '。</p><p class="meta">原始檔已存到雲端「匯入檔」資料夾，' +
        '每筆變更都已寫入操作紀錄。</p></div>';
      $('#iFile').value = '';
      toast('匯入完成');
      renderBatches((await api('import.current', { type })).batches);
    } catch (e) {
      toast(e.message, true);
      ev.target.disabled = false;
      ev.target.textContent = '重新預覽';
      ev.target.onclick = () => previewImport(type, file);
    }
  };
}

function more(n) {
  return n > IMPORT_SHOW_MAX ? '<li class="meta">…另有 ' + (n - IMPORT_SHOW_MAX) + ' 筆未列出</li>' : '';
}

// ---------- 啟動 ----------

(async function start() {
  try {
    state.config = await (await fetch('config.json', { cache: 'no-store' })).json();
  } catch (e) {
    $('#view').innerHTML = '<div class="card center"><p>無法載入設定，請重新整理。</p></div>';
    return;
  }
  routeFromQr();
  restoreToken();
  renderWho();
  initGoogle();
  window.addEventListener('hashchange', render);
  if (state.token) await loadMe();
  render();
})();
