/**
 * 資產管理系統前端。
 * 網址：QR 貼紙為 /?F<資產編號> 或 /?C<保管品鍵>，載入時轉成內部路由 #/asset/F/<編號>。
 * 權限判斷只用來決定顯示什麼；真正的權限檢查在後端。
 */

const TOKEN_KEY = 'asset.idToken';
const state = { config: null, token: null, tokenExp: 0, me: guest() };

function guest() {
  return { email: '', name: '', role: ROLE_GUEST, loggedIn: false, codes: [] };
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
    const roleChip = me.role === ROLE_GUEST ? '' : '<span class="chip accent" title="' + esc(ROLE_LABELS[me.role]) + '">' + esc(me.role) + '</span>';
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
  const m = location.search.match(/^\?([FCI])(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + '#/asset/' + m[1] + '/' + encodeURIComponent(decodeURIComponent(m[2])));
}

const routes = [
  { re: /^#?\/?$/, view: viewHome },
  { re: /^#\/asset\/([FCI])\/(.+)$/, view: viewAsset },
  { re: /^#\/admins$/, view: viewAdmins, perm: 'user.manage' },
  { re: /^#\/mine$/, view: viewMine, perm: 'self.view' },
  { re: /^#\/import$/, view: viewImport, perm: 'asset.import' },
  { re: /^#\/assets$/, view: viewAssets, perm: 'asset.view' },
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
  const me = state.me;
  const role = me.role;
  const hasCodes = (me.codes || []).length > 0;
  let html = '';
  if (can(role, 'asset.view')) {
    html += '<h1>工作選單</h1><div class="grid">' +
      tile('#/scan', '掃描 QR', '盤點、借出、歸還', false) +
      tile('#/assets', '資產清單', '查詢、編輯、經管人', true) +
      tile('#/inventory', '盤點', '年度與不定期', false) +
      tile('#/loans', '借用', '申請、借出、歸還', false) +
      tile('#/import', '匯入', '學校清冊 Excel', true) +
      tile('#/cases', '異常案件', '登記與處理', false) +
      (hasCodes ? tile('#/mine', '我名下的財產', '保管人代號 ' + me.codes.join('、'), true) : '') +
      (role === ROLE_ADMIN ? tile('#/admins', 'User 帳號', '綁定保管人代號', true) : '') +
      '</div>';
    if (can(role, 'admin.manage')) {
      html += '<h1 style="margin-top:20px">系統（Super）</h1><div class="grid">' +
        tile('#/admins', '帳號', 'Super、Admin、User', true) +
        tile('#/system', '備份與交接', '每月備份、交接包', false) +
        tile('#/logs', '操作紀錄', '查詢 LOG', false) +
        '</div>';
    }
  } else if (role === ROLE_USER) {
    html += '<h1>我的財產</h1><div class="grid">' +
      tile('#/mine', '我名下的財產', hasCodes ? '保管人代號 ' + me.codes.join('、') : '尚未綁定保管人代號', true) +
      tile('#/mine', '自行盤點', '盤點期間開放', false) +
      '</div>';
  } else {
    html += '<h1>可借設備</h1><div class="card"><p class="muted" style="margin:0">設備清單建置中。' +
      '管理者與保管人請按右上角登入。' + (me.loggedIn ? '<br>您的帳號尚未開通，請聯絡系辦。' : '') + '</p></div>';
  }
  view.innerHTML = html;
}

// ----- 我名下的財產 -----

async function viewMine(view) {
  view.innerHTML = '<h1>我名下的財產</h1><p class="muted">載入中…</p>';
  let data;
  try {
    data = await api('my.assets');
  } catch (e) {
    view.innerHTML = '<h1>我名下的財產</h1><div class="card"><p>' + esc(e.message) + '</p></div>';
    return;
  }
  if (!data.codes.length) {
    view.innerHTML = '<h1>我名下的財產</h1><div class="card"><p>您的帳號還沒有綁定保管人代號，請聯絡系辦設定。</p></div>';
    return;
  }
  const type = storeGet('asset.mineType') === 'CUSTODY' ? 'CUSTODY' : 'FIXED';
  view.innerHTML = '<h1>我名下的財產</h1><p class="meta muted">保管人代號 ' + esc(data.codes.join('、')) +
    '，資料來自學校清冊（含所有部門）。若和實際不符，請聯絡系辦。</p><div class="tabs">' +
    ['FIXED', 'CUSTODY'].map((t) => '<button type="button" data-type="' + t + '" class="' + (t === type ? 'on' : '') + '">' +
      IMPORT_TEMPLATES[t].label + ' ' + data[t].length + '</button>').join('') + '</div>' +
    '<div class="card"><input id="mQ" type="search" placeholder="搜尋名稱、編號、位置…"></div><div id="mList"></div>';
  view.querySelectorAll('[data-type]').forEach((b) => {
    b.onclick = () => { storeSet('asset.mineType', b.dataset.type); viewMine(view); };
  });
  const draw = () => {
    const list = filterAssets(type, data[type], { q: $('#mQ').value });
    $('#mList').innerHTML = '<div class="card"><ul class="list">' + (list.map((r) => {
      const serial = displaySerial(r);
      const lines = type === 'FIXED'
        ? [assetKey(type, r), r['廠牌規格'], serial.text && (serial.isPurchaseNo ? '請購案號 ' : '序號 ') + serial.text]
        : [r['材料編號'], '帳面 ' + r['帳面數量'] + ' ' + (r['單位'] || '')];
      const lastCheck = r['最近盤點日'] ? '最近盤點 ' + fmtDate(r['最近盤點日']) +
        (type === 'FIXED' ? ' ' + (r['最近盤點結果'] || '') : (r['最近盤點數量'] ? ' 實點 ' + r['最近盤點數量'] : '')) : '尚未盤點';
      return '<li><strong>' + esc(assetName(type, r)) + '</strong><div class="meta">' + lines.filter(Boolean).map(esc).join('｜') +
        '</div><div class="meta">位置：' + esc(currentLocation(r) || '未填') + '｜部門 ' + esc(r['部門代號']) + '｜' + esc(lastCheck) +
        (r['經管人'] ? '｜經管 ' + esc(r['經管人']) : '') + '</div><div class="row chips">' + statusChips(r) + '</div></li>';
    }).join('') || '<li class="muted">沒有資料</li>') + '</ul></div>';
  };
  $('#mQ').oninput = draw;
  draw();
}

async function viewAsset(view, params) {
  const type = typeFromQr(params[0]);
  const key = params[1];
  const label = ASSET_TYPES[type].label;
  if (!can(state.me.role, 'asset.view')) {
    view.innerHTML = '<h1>' + esc(label) + ' ' + esc(key) + '</h1>' +
      '<div class="card"><p class="muted" style="margin:0">公開資訊（名稱、照片、可否借用）建置中。</p></div>' +
      '<a class="btn" href="#/">回首頁</a>';
    return;
  }
  view.innerHTML = '<h1>' + esc(label) + ' ' + esc(key) + '</h1><p class="muted">載入中…</p>';
  let data;
  try {
    data = await api('asset.get', { type, key });
  } catch (e) {
    view.innerHTML = '<h1>' + esc(label) + ' ' + esc(key) + '</h1><div class="card"><p>' + esc(e.message) + '</p></div>' +
      '<a class="btn" href="#/assets">回資產清單</a>';
    return;
  }
  renderAssetDetail(view, type, data.rows, data.managers, data.items);
}

function fmtDate(v) {
  return /^\d{8}$/.test(v || '') ? v.slice(0, 4) + '/' + v.slice(4, 6) + '/' + v.slice(6) : (v || '');
}

function managerLabel(email, managers) {
  if (!email) return '';
  const m = (managers || []).find((x) => x.email === String(email).toLowerCase());
  return m && m.name ? m.name : email;
}

function statusChips(r) {
  const st = assetStatus(r);
  const stClass = st === '在庫' ? '' : st === '借出' ? 'accent' : 'bad';
  return '<span class="chip ' + stClass + '">' + esc(st) + '</span> ' +
    (isLendable(r) ? '<span class="chip ok">可借</span> '
      : r['開放借用'] === '是' ? '<span class="chip">開放借用</span> ' : '') +
    (isMoved(r) ? '<span class="chip warn">已移位</span> ' : '') +
    (r['來源狀態'] === '待確認' ? '<span class="chip warn">清冊沒有・待確認</span> ' : '');
}

/** 清單上的位置文字：已移位時同時列出清冊位置。 */
function locationText(r) {
  return isMoved(r) ? '目前 ' + r['目前位置'] + '（清冊 ' + (r['存放位置'] || '未填') + '）' : (r['存放位置'] || '');
}

function renderAssetDetail(view, type, rows, managers, pieces) {
  const main = rows[0];
  const serial = displaySerial(main);
  const kv = (k, v) => v && String(v).trim() ? '<tr><th>' + esc(k) + '</th><td>' + v + '</td></tr>' : '';
  const custodian = esc(main['保管人代號']) + ' ' + esc(main['保管人姓名']);
  let table;
  if (type === 'FIXED') {
    const linked = (pieces || [])[0];
    table = kv('資產編號', esc(main['資產編號'])) +
      (linked ? kv('系所編號', '<a class="code" href="#/asset/I/' + encodeURIComponent(linked['物品ID']) + '">' +
        esc(linked['系所編號'] || linked['物品ID']) + '</a>（系所借用）') : '') +
      kv('廠牌規格', esc(main['廠牌規格'])) +
      kv(serial.isPurchaseNo ? '請購案號（無產品序號）' : '產品序號', esc(serial.text)) +
      (serial.isPurchaseNo ? '' : kv('請購案號', esc(main['請購案號']))) +
      kv('部門', esc(main['部門代號'])) + locationRows(main, kv) + kv('保管人', custodian) +
      kv('經管人', esc(managerLabel(main['經管人'], managers))) +
      kv('驗收取得日', fmtDate(main['驗收取得日'])) + kv('耐用年數', esc(main['耐用年數'])) +
      kv('保固期限', fmtDate(main['保固期限'])) + kv('取得價值', esc(main['取得價值'])) +
      kv('研究計劃編號', esc(main['研究計劃編號'])) + kv('開放借用', esc(main['開放借用'] || '否')) +
      kv('最近盤點', esc(fmtDate(main['最近盤點日']) + ' ' + (main['最近盤點結果'] || ''))) +
      kv('備註', esc(main['備註']));
  } else if (type === 'ITEM') {
    const link = main['保管品鍵']
      ? '保管品 <a href="#/asset/C/' + encodeURIComponent(main['保管品鍵']) + '">' + esc(main['材料編號'] || main['保管品鍵']) + '</a> ' + esc(main['保管品名稱'] || '')
      : main['資產編號']
        ? '固定資產 <a href="#/asset/F/' + encodeURIComponent(main['資產編號']) + '">' + esc(main['資產編號']) + '</a> ' + esc(main['資產名稱'] || '')
        : '無帳物品（不在學校清冊）';
    table = kv('系所編號', '<strong>' + esc(main['系所編號'] || '（未編號）') + '</strong>') + kv('物品ID', esc(main['物品ID'])) +
      kv('規格', esc(main['規格'])) + kv('對應', link) + kv('部門', esc(main['部門代號'])) +
      (main['保管人代號'] ? kv('保管人', custodian) : '') + kv('經管人', esc(managerLabel(main['經管人'], managers))) +
      kv('目前位置', esc(main['目前位置'])) + kv('開放借用', esc(main['開放借用'] || '否')) +
      kv('最近盤點', esc(fmtDate(main['最近盤點日']) + ' ' + (main['最近盤點結果'] || ''))) + kv('備註', esc(main['備註']));
  } else {
    table = kv('保管品鍵', esc(main['保管品鍵'])) + kv('材料編號', esc(main['材料編號'])) +
      kv('帳面數量', esc(main['帳面數量'] + ' ' + (main['單位'] || ''))) + kv('部門', esc(main['部門代號'])) +
      kv('保管人', custodian) + kv('經管人', esc(managerLabel(main['經管人'], managers))) +
      locationRows(main, kv) + kv('開放借用', esc(main['開放借用'] || '否')) + kv('來源最後異動日', fmtDate(main['來源最後異動日'])) +
      kv('最近點數', esc(fmtDate(main['最近盤點日']) + (main['最近盤點數量'] ? ' 實點 ' + main['最近盤點數量'] : ''))) +
      kv('備註', esc(main['備註']));
  }
  const additions = rows.slice(1).map((r) => '<li><strong>增值 ' + esc(r['增值次數']) + '</strong> ' + esc(r['資產名稱']) +
    '<div class="meta">' + esc(r['廠牌規格']) + '｜' + fmtDate(r['驗收取得日']) + '</div></li>').join('');

  view.innerHTML = '<h1>' + esc(assetName(type, main)) + '</h1><div class="row" style="margin:-4px 0 10px">' + statusChips(main) + '</div>' +
    '<div class="card"><table class="kv">' + table + '</table>' +
    '<div class="meta" style="margin-top:8px">版本 ' + esc(main['版本']) + '｜最後修改 ' +
    esc(main['修改時間'] || main['建立時間']) + ' ' + esc(main['修改者'] || main['建立者']) +
    (main['最後匯入批次'] ? '｜匯入批次 ' + esc(main['最後匯入批次']) : '') + '</div></div>' +
    (additions ? '<div class="card"><h2>增值紀錄</h2><ul class="list">' + additions + '</ul></div>' : '') +
    (type === 'CUSTODY' ? piecesCardHtml(main, pieces || []) : '') +
    '<div class="card"><h2>建檔照片</h2><div id="photoBox"><p class="muted">載入中…</p></div>' +
    (can(state.me.role, 'photo.upload') ? photoButtonsHtml() : '') + '<ul class="list" id="upList"></ul></div>' +
    '<div class="card"><h2>管理</h2><div class="row">' +
    (can(state.me.role, 'asset.edit') ? '<button class="primary" id="aEdit">編輯</button>' : '') +
    '<button disabled>盤點</button><button disabled>借出</button><button disabled>歸還</button></div></div>' +
    '<a class="btn" href="#/assets">回資產清單</a>';
  if (type === 'CUSTODY' && $('#pcNew')) $('#pcNew').onclick = () => createPiecesDialog(main, pieces || []);
  const photoKey = photoAssetKey(type, main);
  loadPhotos(type, photoKey);
  if (can(state.me.role, 'photo.upload')) bindPhotoButtons(type, photoKey);
  const editBtn = $('#aEdit');
  if (editBtn) editBtn.onclick = () => editAsset(type, main, managers, (updated) => {
    rows[0] = updated;
    const cache = state.assets && state.assets[type];
    if (cache) {
      const i = cache.rows.findIndex((r) => importRowKey(type, r) === importRowKey(type, updated));
      if (i >= 0) cache.rows[i] = updated;
    }
    renderAssetDetail(view, type, rows, managers, pieces);
  });
}

/** 清冊的存放位置與實際的目前位置；兩者不同時都列出。 */
function locationRows(row, kv) {
  const now = String(row['目前位置'] || '').trim();
  if (!now || now === row['存放位置']) return kv('存放位置', esc(row['存放位置']));
  return kv('目前位置', '<strong>' + esc(now) + '</strong>') + kv('存放位置（清冊）', esc(row['存放位置']));
}

function managerOptions(managers, selected, extra) {
  return (extra || '') + managers.map((m) => '<option value="' + esc(m.email) + '"' +
    (m.email === String(selected || '').toLowerCase() ? ' selected' : '') + '>' + esc(m.name || m.email) + '</option>').join('');
}

function editAsset(type, row, managers, done) {
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  const isItem = type === 'ITEM';
  form.innerHTML = '<h2>編輯 ' + esc(isItem ? (row['系所編號'] || row['物品ID']) : assetKey(type, row)) + '</h2>' +
    (isItem
      ? '<label for="eCode">系所編號（例 COIC-001；留空＝未編號）</label><input id="eCode" value="' + esc(row['系所編號']) + '">' +
        '<label for="eName">名稱</label><input id="eName" value="' + esc(row['名稱']) + '">' +
        '<label for="eSpec">規格</label><input id="eSpec" value="' + esc(row['規格']) + '">' +
        '<label for="eLoc">目前位置</label><input id="eLoc" value="' + esc(row['目前位置']) + '">'
      : '<p class="meta muted">名稱、規格、保管人、存放位置以學校清冊為準，請用匯入更新。</p>' +
        '<label for="eLoc">目前位置（實際放的地方；清冊：' + esc(row['存放位置'] || '未填') + '）</label>' +
        '<input id="eLoc" value="' + esc(row['目前位置']) + '" placeholder="和清冊相同就留空">') +
    '<label for="eOpen">開放借用</label><select id="eOpen">' + ASSET_OPEN_VALUES.map((v) =>
      '<option' + (v === (row['開放借用'] || '否') ? ' selected' : '') + '>' + v + '</option>').join('') + '</select>' +
    '<label for="eMgr">經管人（實際負責保管、借用的管理者）</label><select id="eMgr">' +
    managerOptions(managers, row['經管人'], '<option value="">（未指定）</option>') + '</select>' +
    '<label for="eNote">備註</label><textarea id="eNote" rows="2">' + esc(row['備註']) + '</textarea>' +
    '<label for="eReason">修改原因（必填，會記入紀錄）</label><input id="eReason" required>' +
    '<div class="row" style="margin-top:14px;justify-content:flex-end">' +
    '<button value="cancel" formnovalidate>取消</button><button class="primary" id="eSave" value="save">儲存</button></div>';
  $('#eSave').onclick = async (ev) => {
    ev.preventDefault();
    if (!$('#eReason').value.trim()) { toast('請填寫修改原因', true); return; }
    ev.target.disabled = true;
    try {
      const updated = await api('asset.update', {
        type, rowKey: importRowKey(type, row), version: row['版本'], reason: $('#eReason').value,
        changes: Object.assign(
          { 目前位置: $('#eLoc').value, 開放借用: $('#eOpen').value, 經管人: $('#eMgr').value, 備註: $('#eNote').value },
          isItem ? { 系所編號: $('#eCode').value, 名稱: $('#eName').value, 規格: $('#eSpec').value } : {}),
      });
      dlg.close();
      toast('已儲存');
      done(updated);
    } catch (e) {
      ev.target.disabled = false;
      toast(e.message, true);
      if (e.code === 'VERSION_CONFLICT') { dlg.close(); render(); }
    }
  };
  dlg.showModal();
}

// ----- 照片 -----

/** 讀 JPEG 內建的拍攝時間（EXIF DateTimeOriginal，沒有就退回 DateTime）。 */
async function readExifDate(file) {
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return '';
    let off = 2;
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10) || '';
      if ((marker & 0xFF00) !== 0xFF00) return '';
      off += 2 + len;
    }
  } catch (e) { /* 讀不到就只記上傳時間 */ }
  return '';
}

function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const ifd = (o) => {
    const tags = {};
    const n = u16(o);
    for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; tags[u16(e)] = { count: u32(e + 4), at: e + 8 }; }
    return tags;
  };
  const ascii = (t) => {
    const o = t.count > 4 ? u32(t.at) : t.at;
    let s = '';
    for (let i = 0; i < t.count - 1; i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };
  const ifd0 = ifd(u32(4));
  if (ifd0[0x8769]) { const ex = ifd(u32(ifd0[0x8769].at)); if (ex[0x9003]) return ascii(ex[0x9003]); }
  return ifd0[0x0132] ? ascii(ifd0[0x0132]) : '';
}

/** 壓縮成長邊 1600 像素的 JPEG（依照片方向轉正）。 */
async function compressImage(file, maxEdge = 1600, quality = 0.8) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    throw new Error('無法讀取這個檔案（請用一般 JPEG 照片；iPhone 請在設定改為「最相容」）');
  }
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new Error('照片壓縮失敗');
  return blob;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(new Error('讀取照片失敗'));
    fr.readAsDataURL(blob);
  });
}

function photoButtonsHtml() {
  // 新版 Android 相片選擇器沒有相機選項，拍照要另一個加 capture 的按鈕
  return '<div class="row" style="margin-top:10px"><button type="button" class="primary" id="pCamBtn">📷 拍照</button>' +
    '<button type="button" id="pLibBtn">🖼 從相簿選</button></div>' +
    '<input id="pCam" type="file" accept="image/*" capture="environment" hidden>' +
    '<input id="pLib" type="file" accept="image/*" multiple hidden>';
}

function bindPhotoButtons(type, key) {
  $('#pCamBtn').onclick = () => $('#pCam').click();
  $('#pLibBtn').onclick = () => $('#pLib').click();
  const onPick = async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = '';
    for (const f of files) await uploadOne(type, key, f);
    loadPhotos(type, key);
  };
  $('#pCam').onchange = onPick;
  $('#pLib').onchange = onPick;
}

/** 上傳一張：成功才算數；失敗顯示原因與重試按鈕，不會留下紀錄。 */
async function uploadOne(type, key, file) {
  const li = document.createElement('li');
  li.className = 'meta';
  $('#upList').appendChild(li);
  const show = (text, retry) => {
    li.innerHTML = esc(file.name) + '：' + text + (retry ? ' <button type="button">重試</button>' : '');
    if (retry) li.querySelector('button').onclick = async () => { li.remove(); await uploadOne(type, key, file); loadPhotos(type, key); };
  };
  try {
    show('處理中…');
    const takenAt = await readExifDate(file);
    const blob = await compressImage(file);
    show('上傳中…（' + Math.round(blob.size / 1024) + ' KB）');
    const rec = await api('photo.upload', {
      type, key, purpose: '建檔', base64: await blobToBase64(blob), takenAt, originalName: file.name,
    });
    show('✔ 已存為 ' + esc(rec['檔名']) + (rec['拍攝時間'] ? '，拍攝 ' + esc(rec['拍攝時間']) : '，讀不到拍攝時間'));
    const cache = state.assets && state.assets[type];
    if (cache) {
      const k = type + ':' + key;
      cache.photoCounts = cache.photoCounts || {};
      cache.photoCounts[k] = cache.photoCounts[k] || {};
      cache.photoCounts[k]['建檔'] = (cache.photoCounts[k]['建檔'] || 0) + 1;
    }
  } catch (e) {
    show('<span style="color:var(--bad)">✖ ' + esc(e.message) + '（沒有存檔）</span>', e.code !== 'DUPLICATE');
  }
}

const photoCache = {};

async function photoSrc(id) {
  if (!photoCache[id]) photoCache[id] = api('photo.get', { id }).then((r) => 'data:image/jpeg;base64,' + r.base64);
  return photoCache[id];
}

async function loadPhotos(type, key) {
  const box = $('#photoBox');
  if (!box) return;
  let list;
  try {
    list = (await api('photo.list', { type, key })).filter((p) => p['用途'] === '建檔');
  } catch (e) {
    box.innerHTML = '<p>' + esc(e.message) + '</p>';
    return;
  }
  if (!list.length) { box.innerHTML = '<p class="muted">還沒有建檔照片。</p>'; return; }
  box.innerHTML = '<div class="thumbs">' + list.map((p, i) => '<button type="button" class="thumb" data-i="' + i + '">' +
    '<img alt="' + esc(p['檔名']) + '"><span>' + esc((p['拍攝時間'] || p['上傳時間']).slice(0, 10)) + '</span></button>').join('') + '</div>';
  box.querySelectorAll('.thumb').forEach((b) => {
    const p = list[Number(b.dataset.i)];
    photoSrc(p['照片編號']).then((src) => { b.querySelector('img').src = src; }).catch(() => { b.querySelector('span').textContent = '讀取失敗'; });
    b.onclick = () => showPhoto(type, key, p);
  });
}

function showPhoto(type, key, p) {
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  const canVoid = can(state.me.role, 'photo.upload');
  form.innerHTML = '<img class="photo-full" alt="' + esc(p['檔名']) + '">' +
    '<div class="meta">' + esc(p['檔名']) + '｜拍攝 ' + esc(p['拍攝時間'] || '不明') + '｜上傳 ' + esc(p['上傳時間']) + ' ' +
    esc(p['上傳者']) + (p['原始檔名'] ? '｜原檔 ' + esc(p['原始檔名']) : '') + '</div>' +
    (canVoid ? '<label for="vReason">作廢原因（拍錯、模糊等；檔案仍保留在雲端與 NAS）</label><input id="vReason">' : '') +
    '<div class="row" style="margin-top:12px;justify-content:flex-end">' +
    (canVoid ? '<button type="button" id="vGo">作廢這張</button>' : '') + '<button value="cancel">關閉</button></div>';
  photoSrc(p['照片編號']).then((src) => { form.querySelector('img').src = src; });
  if (canVoid) {
    $('#vGo').onclick = async (ev) => {
      if (!$('#vReason').value.trim()) { toast('請填寫作廢原因', true); return; }
      ev.target.disabled = true;
      try {
        await api('photo.void', { id: p['照片編號'], reason: $('#vReason').value });
        dlg.close();
        toast('已作廢');
        const cache = state.assets && state.assets[type];
        const c = cache && cache.photoCounts && cache.photoCounts[type + ':' + key];
        if (c && c['建檔']) c['建檔']--;
        loadPhotos(type, key);
      } catch (e) {
        ev.target.disabled = false;
        toast(e.message, true);
      }
    };
  }
  dlg.showModal();
}

// ----- 資產清單 -----

const LIST_PAGE = 100;

async function loadAssets(type, force) {
  state.assets = state.assets || {};
  if (!force && state.assets[type]) return state.assets[type];
  const data = await api('asset.list', { type });
  state.assets[type] = data;
  return data;
}

async function viewAssets(view) {
  const saved = storeGet('asset.listType');
  const type = ASSET_TYPES[saved] ? saved : 'FIXED';
  state.assetUi = state.assetUi || {};
  const ui = state.assetUi[type] || (state.assetUi[type] = { f: {}, shown: LIST_PAGE, selected: new Set() });
  view.innerHTML = '<h1>資產清單</h1><div class="tabs">' + Object.keys(ASSET_TYPES).map((t) =>
    '<button type="button" data-type="' + t + '" class="' + (t === type ? 'on' : '') + '">' + ASSET_TYPES[t].label + '</button>').join('') +
    '<button type="button" id="lReload" title="重新載入">重新整理</button></div><div id="lBody"><p class="muted">載入中…</p></div>';
  view.querySelectorAll('[data-type]').forEach((b) => {
    b.onclick = () => { storeSet('asset.listType', b.dataset.type); viewAssets(view); };
  });
  $('#lReload').onclick = async () => { await loadAssets(type, true).catch((e) => toast(e.message, true)); viewAssets(view); };
  let data;
  try {
    data = await loadAssets(type);
  } catch (e) {
    $('#lBody').innerHTML = '<div class="card"><p>' + esc(e.message) + '</p></div>';
    return;
  }
  renderAssetList(type, data, ui);
}

function renderAssetList(type, data, ui) {
  const f = ui.f;
  const sel = (id, field, opts, first) => '<select id="' + id + '" data-f="' + field + '">' + first +
    opts.map((o) => '<option value="' + esc(o.value) + '"' + (f[field] === o.value ? ' selected' : '') + '>' +
      esc(o.label) + '</option>').join('') + '</select>';
  const rows = data.rows;
  const mgrOpts = [{ value: 'me', label: '我經管的' }, { value: 'none', label: '未指定經管人' }]
    .concat(data.managers.map((m) => ({ value: m.email, label: '經管人：' + (m.name || m.email) })));
  const newItem = type === 'ITEM' && can(state.me.role, 'asset.edit')
    ? '<div class="row" style="margin-bottom:10px"><button type="button" class="primary" id="iNew">＋ 新增系所物品</button>' +
      '<span class="meta muted">保管品的單件請到該保管品頁面「建立單件」</span></div>' : '';
  $('#lBody').innerHTML = newItem + '<div class="card filters">' +
    '<input id="fQ" type="search" placeholder="搜尋編號、名稱、規格、序號、位置、保管人…" value="' + esc(f.q || '') + '">' +
    '<div class="fgrid">' +
    sel('fMgr', '經管人', mgrOpts, '<option value="">經管人：不限</option>') +
    sel('fStatus', '狀態', distinctValues(rows, '狀態'), '<option value="">狀態：不限</option>') +
    sel('fDept', '部門代號', distinctValues(rows, '部門代號'), '<option value="">部門：不限</option>') +
    sel('fCust', '保管人代號', distinctValues(rows, '保管人代號'), '<option value="">保管人：不限</option>') +
    sel('fLoc', '位置', distinctValues(rows, '位置'), '<option value="">位置（實際）：不限</option>') +
    sel('fPhoto', '建檔照片', [{ value: '有', label: '建檔照片：已拍' }, { value: '缺', label: '建檔照片：未拍' }],
      '<option value="">建檔照片：不限</option>') +
    sel('fOpen', '開放借用', [{ value: '可借', label: '現在可借' }, { value: '是', label: '開放借用：是' }, { value: '否', label: '開放借用：否' }],
      '<option value="">開放借用：不限</option>') +
    '<label class="radio"><input type="checkbox" data-c="已移位"' + (f['已移位'] ? ' checked' : '') + '> 只看實際位置和清冊不同</label>' +
    '<label class="radio"><input type="checkbox" data-c="待確認"' + (f['待確認'] ? ' checked' : '') + '> 只看清冊沒有（待確認）</label>' +
    '</div></div><div id="lResult"></div>';

  if ($('#iNew')) $('#iNew').onclick = () => createItemDialog(data.managers);
  const update = () => { ui.shown = LIST_PAGE; drawAssetResults(type, data, ui); };
  let timer;
  $('#fQ').oninput = () => { f.q = $('#fQ').value; clearTimeout(timer); timer = setTimeout(update, 200); };
  document.querySelectorAll('#lBody select[data-f]').forEach((el) => {
    el.onchange = () => { f[el.dataset.f] = el.value; update(); };
  });
  document.querySelectorAll('#lBody input[data-c]').forEach((el) => {
    el.onchange = () => { f[el.dataset.c] = el.checked; update(); };
  });
  drawAssetResults(type, data, ui);
}

function drawAssetResults(type, data, ui) {
  const list = filterAssets(type, data.rows, ui.f, state.me.email, data.photoCounts);
  if (type === 'ITEM') list.sort((a, b) => compareItemCodes(a['系所編號'], b['系所編號']) || (a['物品ID'] < b['物品ID'] ? -1 : 1));
  const canEdit = can(state.me.role, 'asset.edit');
  const prefix = ASSET_TYPES[type].qr;
  const items = list.slice(0, ui.shown).map((r) => {
    const k = importRowKey(type, r);
    const serial = displaySerial(r);
    const stats = type === 'CUSTODY' && (data.itemStats || {})[r['保管品鍵']];
    const meta = type === 'FIXED'
      ? [assetKey(type, r), locationText(r), r['保管人姓名'] || r['保管人代號'], serial.text && (serial.isPurchaseNo ? '請購 ' : 'S/N ') + serial.text]
      : type === 'ITEM'
        ? [r['規格'], r['材料編號'] || r['資產編號'] || '無帳', r['目前位置'], r['保管人姓名']]
        : [assetKey(type, r), r['帳面數量'] + ' ' + (r['單位'] || '') + (stats ? '（單件 ' + stats['件數'] + '，借出 ' + stats['借出'] + '）' : ''),
          r['保管人姓名'] || r['保管人代號'], locationText(r) || r['部門代號']];
    const title = type === 'ITEM'
      ? '<span class="code">' + esc(r['系所編號'] || '未編號') + '</span> ' + esc(r['名稱'])
      : (type === 'FIXED' && r['系所編號'] ? '<span class="code">' + esc(r['系所編號']) + '</span> ' : '') + esc(assetName(type, r));
    const mgr = managerLabel(r['經管人'], data.managers);
    const nPhoto = ((data.photoCounts || {})[type + ':' + assetKey(type, r)] || {})['建檔'] || 0;
    return '<li class="asset-item">' +
      (canEdit ? '<input type="checkbox" data-k="' + esc(k) + '" data-v="' + esc(r['版本']) + '"' + (ui.selected.has(k) ? ' checked' : '') + ' aria-label="勾選">' : '') +
      '<a href="#/asset/' + prefix + '/' + encodeURIComponent(assetKey(type, r)) + '"><div><strong>' + title + '</strong></div>' +
      '<div class="meta">' + meta.filter(Boolean).map(esc).join('｜') + '</div>' +
      '<div class="row chips">' + statusChips(r) + (mgr ? '<span class="chip">經管：' + esc(mgr) + '</span>' : '') +
      (nPhoto ? '<span class="chip">建檔照片 ' + nPhoto + '</span>' : '') + '</div></a></li>';
  }).join('');

  $('#lResult').innerHTML = '<div class="row spread meta" style="margin:4px 2px 8px"><span>共 ' + list.length + ' 筆' +
    (canEdit ? '，已勾選 <strong id="selCount">' + ui.selected.size + '</strong> 筆' : '') + '</span>' +
    '<span class="row">' + (canEdit ? '<button type="button" id="selAll">全選篩選結果</button><button type="button" id="selNone">清除勾選</button>' : '') +
    '<button type="button" id="lLabels" title="勾選的；沒勾選就是目前篩選結果">匯出貼紙 CSV</button></span>' +
    '</div><div class="card"><ul class="list">' + (items || '<li class="muted">沒有符合的資料</li>') + '</ul>' +
    (list.length > ui.shown ? '<div class="center" style="margin-top:8px"><button type="button" id="lMore">再顯示 ' +
      Math.min(LIST_PAGE, list.length - ui.shown) + ' 筆（還有 ' + (list.length - ui.shown) + '）</button></div>' : '') + '</div>' +
    (canEdit ? '<div class="batchbar" id="batchBar"' + (ui.selected.size ? '' : ' hidden') + '>' +
      '<select id="bField" aria-label="要改的欄位">' + (type === 'ITEM' ? ['系所編號'] : type === 'FIXED' ? ['建立系所物品'] : []).concat(ASSET_BATCH_FIELDS)
        .map((x) => '<option' + (x === ui.batchField ? ' selected' : '') + '>' + x + '</option>').join('') +
      '</select><span id="bValueBox" class="grow"></span><button class="primary" type="button" id="bGo">套用</button></div>' : '');

  if ($('#lMore')) $('#lMore').onclick = () => { ui.shown += LIST_PAGE; drawAssetResults(type, data, ui); };
  $('#lLabels').onclick = () => exportLabels(type, data, ui.selected.size
    ? list.concat(data.rows).filter((r, i, a) => ui.selected.has(importRowKey(type, r)) && a.indexOf(r) === i)
    : list);
  if (!canEdit) return;
  const versions = {};
  data.rows.forEach((r) => { versions[importRowKey(type, r)] = r['版本']; });
  const refreshBar = () => {
    $('#selCount').textContent = ui.selected.size;
    $('#batchBar').hidden = !ui.selected.size;
  };
  document.querySelectorAll('#lResult input[data-k]').forEach((cb) => {
    cb.onchange = () => { if (cb.checked) ui.selected.add(cb.dataset.k); else ui.selected.delete(cb.dataset.k); refreshBar(); };
  });
  $('#selAll').onclick = () => { list.forEach((r) => ui.selected.add(importRowKey(type, r))); drawAssetResults(type, data, ui); };
  $('#selNone').onclick = () => { ui.selected.clear(); drawAssetResults(type, data, ui); };
  const fillValues = () => {
    ui.batchField = $('#bField').value;
    if (ui.batchField === '系所編號' || ui.batchField === '建立系所物品') {
      $('#bValueBox').innerHTML = '<input id="bValue" placeholder="前綴，例 COIC、CB（依勾選順序接續編號' +
        (ui.batchField === '建立系所物品' ? '；留空之後再編' : '') + '）" autocomplete="off">';
      return;
    }
    if (ui.batchField === '目前位置') {
      // 從已用過的位置名稱挑，名稱才會一致；空白＝回到清冊位置
      $('#bValueBox').innerHTML = '<input id="bValue" list="bLocs" placeholder="選或輸入位置；空白＝回到清冊位置" autocomplete="off">' +
        '<datalist id="bLocs">' + distinctValues(data.rows, '位置').map((o) => '<option value="' + esc(o.value) + '">').join('') + '</datalist>';
      return;
    }
    $('#bValueBox').innerHTML = '<select id="bValue" aria-label="改成">' + (ui.batchField === '開放借用'
      ? '<option value="是">是（開放借用）</option><option value="否">否（不外借）</option>'
      : managerOptions(data.managers, '', '<option value="">取消經管人</option>')) + '</select>';
  };
  $('#bField').onchange = fillValues;
  fillValues();
  $('#bGo').onclick = async (ev) => {
    const field = $('#bField').value;
    const value = $('#bValue').value;
    const shown = field === '經管人' ? (value ? managerLabel(value, data.managers) : '（取消）')
      : field === '目前位置' && !value.trim() ? '（回到清冊位置）' : value;
    ev.target.disabled = true;
    if (field === '建立系所物品') {
      // 固定資產給學生借（例：Chromebook）：一對一建立系所物品，借還時會同步這件固定資產
      try {
        const rows = await api('item.fromFixed', { prefix: value, codes: [...ui.selected] });
        toast('已建立 ' + rows.length + ' 件系所物品' + (rows[0]['系所編號'] ? '（' + rows[0]['系所編號'] + ' 起）' : ''));
        ui.selected.clear();
        if (state.assets) delete state.assets.ITEM;
        await loadAssets(type, true);
      } catch (e) {
        toast(e.message, true);
      }
      renderAssetList(type, state.assets[type], ui);
      return;
    }
    if (field === '系所編號') {
      const keys = [...ui.selected];
      const already = keys.filter((k) => (data.rows.find((r) => r['物品ID'] === k) || {})['系所編號']).length;
      try {
        if (already && !confirm(already + ' 件已經有編號，會改成新的號碼（舊貼紙要重印）。確定？')) throw new Error('已取消');
        const r = await api('item.number', { prefix: value, items: keys.map((k) => ({ rowKey: k, version: versions[k] })) });
        toast('已編號 ' + r.codes[0] + (r.codes.length > 1 ? ' ～ ' + r.codes[r.codes.length - 1] : ''));
        ui.selected.clear();
        await loadAssets(type, true);
      } catch (e) {
        toast(e.message, true);
        if (e.code === 'VERSION_CONFLICT') await loadAssets(type, true).catch(() => {});
      }
      renderAssetList(type, state.assets[type], ui);
      return;
    }
    try {
      const r = await api('asset.assign', {
        type, field, value, items: [...ui.selected].map((k) => ({ rowKey: k, version: versions[k] })),
        reason: '批次修改' + field + '：' + shown,
      });
      toast('已更新 ' + r.updated + ' 筆');
      ui.selected.clear();
      await loadAssets(type, true);
    } catch (e) {
      toast(e.message, true);
      if (e.code === 'VERSION_CONFLICT') await loadAssets(type, true).catch(() => {});
    }
    renderAssetList(type, state.assets[type], ui);
  };
}

// ----- 貼紙 -----

/** 匯出 BarTender 用的貼紙 CSV（QR 由 BarTender 產生）。 */
function exportLabels(type, data, rows) {
  if (!rows.length) { toast('沒有要匯出的資料', true); return; }
  const qrBase = state.config.qrBase || (location.origin + '/');
  const nameOf = (email) => managerLabel(email, data.managers);
  const body = [LABEL_COLUMNS].concat(rows.map((r) => labelRow(qrBase, type, r, nameOf, state.config.labelNameWidths)));
  const blob = new Blob([toCsv(body)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  a.href = URL.createObjectURL(blob);
  a.download = '貼紙_' + ASSET_TYPES[type].label + '_' + ymd + '_' + rows.length + '筆.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  const noCode = type === 'ITEM' ? rows.filter((r) => !r['系所編號']).length : 0;
  toast('已匯出 ' + rows.length + ' 筆' + (noCode ? '（其中 ' + noCode + ' 筆還沒有系所編號）' : ''), noCode > 0);
}

// ----- 系所物品 -----

/** 保管品詳細頁：已建立的單件與統計。 */
function piecesCardHtml(custody, pieces) {
  const active = pieces.filter((p) => assetStatus(p) !== '報廢');
  const lent = active.filter((p) => assetStatus(p) === '借出').length;
  const book = Number(custody['帳面數量']) || 0;
  const sorted = active.slice().sort((a, b) => compareItemCodes(a['系所編號'], b['系所編號']));
  return '<div class="card"><h2>系所物品（可借用單件）</h2><p class="meta">帳面 ' + esc(custody['帳面數量']) + '｜已建單件 ' +
    active.length + '｜借出 ' + lent + '｜在庫 ' + (active.length - lent) + (book > active.length ? '｜尚未建立 ' + (book - active.length) : '') + '</p>' +
    (sorted.length ? '<div class="codes">' + sorted.map((p) => '<a class="chip' + (assetStatus(p) === '借出' ? ' accent' : '') + '" href="#/asset/I/' +
      encodeURIComponent(p['物品ID']) + '">' + esc(p['系所編號'] || p['物品ID']) + '</a>').join(' ') + '</div>' : '') +
    (can(state.me.role, 'asset.edit') && book > active.length ? '<div class="row" style="margin-top:10px"><button type="button" id="pcNew">建立單件</button></div>' : '') +
    '</div>';
}

function createPiecesDialog(custody, pieces) {
  const remain = (Number(custody['帳面數量']) || 0) - pieces.filter((p) => assetStatus(p) !== '報廢').length;
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  form.innerHTML = '<h2>從保管品建立單件</h2><div class="meta muted">' + esc(custody['品名規格']) + '</div>' +
    '<label for="pcCount">件數（最多 ' + remain + '）</label><input id="pcCount" type="number" min="1" max="' + remain + '" value="' + remain + '">' +
    '<label for="pcPrefix">系所編號前綴（選填，例 COIC；有填就接續編號，留空之後再編）</label><input id="pcPrefix" autocomplete="off">' +
    '<p class="meta muted">名稱、部門、保管人、經管人、目前位置會帶入保管品的資料，建立後可再改。</p>' +
    '<div class="row" style="margin-top:14px;justify-content:flex-end"><button value="cancel" formnovalidate>取消</button>' +
    '<button class="primary" id="pcGo" value="save">建立</button></div>';
  $('#pcGo').onclick = async (ev) => {
    ev.preventDefault();
    ev.target.disabled = true;
    try {
      const rows = await api('item.fromCustody', { key: custody['保管品鍵'], count: $('#pcCount').value, prefix: $('#pcPrefix').value });
      dlg.close();
      toast('已建立 ' + rows.length + ' 件' + (rows[0]['系所編號'] ? '（' + rows[0]['系所編號'] + ' 起）' : ''));
      if (state.assets) { delete state.assets.ITEM; delete state.assets.CUSTODY; }
      render();
    } catch (e) {
      ev.target.disabled = false;
      toast(e.message, true);
    }
  };
  dlg.showModal();
}

/** 逐筆新增（既有紙本編號、無帳物品）。 */
function createItemDialog(managers) {
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  form.innerHTML = '<h2>新增系所物品</h2>' +
    '<label for="nCode">系所編號（選填；紙本的「NX2 #8」輸入後會存成 NX2-008）</label><input id="nCode" autocomplete="off">' +
    '<label for="nName">名稱</label><input id="nName" required placeholder="例：HDMI 線">' +
    '<label for="nSpec">規格</label><input id="nSpec" placeholder="例：3 公尺">' +
    '<label for="nLoc">目前位置</label><input id="nLoc">' +
    '<label for="nMgr">經管人</label><select id="nMgr">' + managerOptions(managers, state.me.email, '<option value="">（未指定）</option>') + '</select>' +
    '<label for="nCount">件數（同樣的東西一次建多件；有填系所編號時只能 1 件）</label><input id="nCount" type="number" min="1" max="200" value="1">' +
    '<label for="nNote">備註</label><input id="nNote">' +
    '<div class="row" style="margin-top:14px;justify-content:flex-end"><button value="cancel" formnovalidate>取消</button>' +
    '<button class="primary" id="nGo" value="save">建立</button></div>';
  $('#nGo').onclick = async (ev) => {
    ev.preventDefault();
    const count = Math.max(1, Math.min(200, parseInt($('#nCount').value, 10) || 1));
    if ($('#nCode').value.trim() && count > 1) { toast('有填系所編號時只能建 1 件；多件請建好後用批次編號', true); return; }
    if (!$('#nName').value.trim()) { toast('請填名稱', true); return; }
    ev.target.disabled = true;
    const def = {
      系所編號: $('#nCode').value, 名稱: $('#nName').value, 規格: $('#nSpec').value, 目前位置: $('#nLoc').value,
      經管人: $('#nMgr').value, 備註: $('#nNote').value,
    };
    try {
      const rows = await api('item.create', { items: Array.from({ length: count }, () => def) });
      dlg.close();
      toast('已建立 ' + rows.length + ' 件');
      if (state.assets) delete state.assets.ITEM;
      render();
    } catch (e) {
      ev.target.disabled = false;
      toast(e.message, true);
    }
  };
  dlg.showModal();
}

// ----- 帳號 -----

function levelOptions(selected) {
  const levels = state.me.role === ROLE_SUPER ? ACCOUNT_LEVELS : [ROLE_USER];
  return levels.map((l) => '<option value="' + l + '"' + (l === selected ? ' selected' : '') + '>' + esc(ROLE_LABELS[l]) + '</option>').join('');
}

async function viewAdmins(view) {
  const isSuper = state.me.role === ROLE_SUPER;
  const title = isSuper ? '帳號' : 'User 帳號';
  view.innerHTML = '<h1>' + title + '</h1><p class="muted">載入中…</p>';
  let rows;
  try {
    rows = await api('admin.list');
  } catch (e) {
    view.innerHTML = '<h1>' + title + '</h1><div class="card"><p>' + esc(e.message) + '</p></div>';
    return;
  }
  const order = { Super: 0, Admin: 1, User: 2 };
  rows.sort((a, b) => (order[a['等級']] ?? 3) - (order[b['等級']] ?? 3) || String(a['姓名']).localeCompare(String(b['姓名'])));
  const items = rows.map((a, i) =>
    '<li class="row spread"><div><div>' + esc(a['姓名'] || '（未填姓名）') + ' ' +
    '<span class="chip accent">' + esc(ROLE_LABELS[a['等級']] || a['等級']) + '</span> ' +
    '<span class="chip ' + (a['狀態'] === '啟用' ? 'ok' : 'bad') + '">' + esc(a['狀態']) + '</span></div>' +
    '<div class="meta">' + esc(a['Email']) + (a['保管人代號'] ? '｜保管人代號 ' + esc(a['保管人代號']) : '') +
    (a['備註'] ? '｜' + esc(a['備註']) : '') + '</div></div>' +
    '<button type="button" data-edit="' + i + '">編輯</button></li>').join('');

  view.innerHTML = '<h1>' + title + '</h1>' +
    '<div class="card"><p class="meta muted" style="margin-top:0">Super：系統管理（帳號、備份、紀錄）。Admin：管理者（入檔、盤點、借還）。' +
    'User：保管人，只看得到綁定的保管人代號名下的財產，盤點期間可自行盤點。' + (isSuper ? '' : '您可以新增與修改 User 帳號。') + '</p>' +
    '<ul class="list">' + (items || '<li class="muted">目前沒有帳號</li>') + '</ul></div>' +
    '<div class="card"><h2>新增帳號</h2><form id="addForm">' +
    '<label for="aEmail">Google 帳號 Email</label><input id="aEmail" type="email" required autocomplete="off">' +
    '<label for="aName">姓名</label><input id="aName" required>' +
    '<label for="aLevel">等級</label><select id="aLevel">' + levelOptions(ROLE_USER) + '</select>' +
    '<label for="aCodes">保管人代號（User 必填；多個用逗號分隔，例 D000000256）</label><input id="aCodes" autocomplete="off">' +
    '<label for="aNote">備註（例如：職員、工讀生、教師）</label><input id="aNote">' +
    '<div class="row" style="margin-top:12px"><button class="primary" type="submit">新增</button></div></form></div>';

  view.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => editAdmin(rows[Number(b.dataset.edit)]);
  });
  $('#addForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter; btn.disabled = true;
    try {
      await api('admin.add', {
        email: $('#aEmail').value, name: $('#aName').value, level: $('#aLevel').value,
        custodianCodes: $('#aCodes').value, note: $('#aNote').value,
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
  form.innerHTML = '<h2>編輯帳號</h2><div class="meta muted">' + esc(a['Email']) + '</div>' +
    '<label for="eName">姓名</label><input id="eName" value="' + esc(a['姓名']) + '">' +
    '<label for="eLevel">等級</label><select id="eLevel">' + levelOptions(a['等級']) + '</select>' +
    '<label for="eCodes">保管人代號（多個用逗號分隔）</label><input id="eCodes" value="' + esc(a['保管人代號']) + '">' +
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
        changes: {
          姓名: $('#eName').value, 等級: $('#eLevel').value, 狀態: $('#eStatus').value, 備註: $('#eNote').value,
          保管人代號: $('#eCodes').value,
        },
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
