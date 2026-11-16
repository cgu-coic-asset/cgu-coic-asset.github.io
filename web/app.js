/**
 * 資產管理系統前端。
 * 網址：QR 貼紙為 /?F<資產編號>、/?C<保管品 6 位數 QR碼>、/?I<物品ID>，載入時轉成內部路由 #/asset/F/<編號>。
 * 訪客看公開資訊（public.get）；Admin、Super 看管理頁（asset.get）。站內掃描頁 #/scan 用相機辨識後導到同一路由。
 * 公開頁 #/public（訪客首頁）：開放借用的系所物品清單（public.list），只有公開欄位與代表照片縮圖。
 * 盤點：#/inventory 批次清單與建立、#/inventory/<批次> 進度與未盤清單；資產頁「盤點」對話框；User 在「我名下的財產」自行盤點。
 * 異常案件：#/cases（處理中／已結案，Super 結案）；資產頁與批次頁「登記異常」。
 * 借用 A：公開清單選件數 → #/apply 申請 → 借用單（可列印）；#/loan 以單號＋手機查詢重印。
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
  { re: /^#\/scan$/, view: viewScan },
  { re: /^#\/public$/, view: viewPublicList },
  { re: /^#\/apply$/, view: viewApply },
  { re: /^#\/loan$/, view: viewLoanLookup },
  { re: /^#\/inventory$/, view: viewInventory, perm: 'inventory.record' },
  { re: /^#\/inventory\/([^/]+)$/, view: viewBatch, perm: 'inventory.record' },
  { re: /^#\/cases$/, view: viewCases, perm: 'case.open' },
  { re: /^#\/admins$/, view: viewAdmins, perm: 'user.manage' },
  { re: /^#\/mine$/, view: viewMine, perm: 'self.view' },
  { re: /^#\/import$/, view: viewImport, perm: 'asset.import' },
  { re: /^#\/assets$/, view: viewAssets, perm: 'asset.view' },
];

function render() {
  stopScanner();
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
      tile('#/scan', '掃描 QR', '查看、盤點、借出', true) +
      tile('#/assets', '資產清單', '查詢、編輯、經管人', true) +
      tile('#/inventory', '盤點', '批次、進度、未盤清單', true) +
      tile('#/loans', '借用', '申請、借出、歸還', false) +
      tile('#/import', '匯入', '學校清冊 Excel', true) +
      tile('#/public', '可借設備', '公開頁（訪客看到的）', true) +
      tile('#/cases', '異常案件', '登記、Super 結案', true) +
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
      tile('#/mine', '自行盤點', '盤點期間在「我名下的財產」操作', true) +
      tile('#/scan', '掃描 QR', '查看設備資訊', true) +
      tile('#/public', '可借設備', '公開頁', true) +
      '</div>';
  } else {
    view.innerHTML = '';
    viewPublicList(view, [], me.loggedIn ? '您的帳號尚未開通，請聯絡系辦。' : '管理者與保管人請按右上角登入。');
    return;
  }
  view.innerHTML = html;
}

// ----- 可借設備清單（公開頁）-----

/** 免登入的可借設備清單：只有開放借用的系所物品，欄位由 shared/publicView.js 決定。 */
async function viewPublicList(view, params, note) {
  view.innerHTML = '<h1>可借設備</h1><p class="muted">載入中…</p>';
  let data;
  try {
    data = await api('public.list');
  } catch (e) {
    view.innerHTML = '<h1>可借設備</h1><div class="card"><p>' + esc(e.message) + '</p></div>';
    return;
  }
  const groups = groupPublicItems(data.items);
  view.innerHTML = '<h1>' + esc(data.unit ? data.unit + ' ' : '') + '可借設備</h1>' +
    '<p class="meta muted">' + esc(note || '') + (note ? ' ' : '') + '在想借的設備填件數，按下方「申請借用」填表，送出後印出借用單到系辦借出。' +
    '已申請過的請到 <a href="#/loan">查詢借用單</a>。</p>' +
    '<div class="row" style="margin-bottom:12px"><input id="pubQ" class="grow1" type="search" placeholder="搜尋名稱、規格、編號…">' +
    '<a class="btn" href="#/scan">掃描 QR</a></div><div id="pubList"></div>';
  const draw = () => {
    const words = $('#pubQ').value.toLowerCase().split(/\s+/).filter(Boolean);
    const list = groups.filter((g) => {
      const text = (g.name + ' ' + g.spec + ' ' + g.items.map((i) => i.code).join(' ')).toLowerCase();
      return words.every((w) => text.indexOf(w) !== -1);
    });
    $('#pubList').innerHTML = list.map((g, i) => {
      const chip = g.lendable ? '<span class="chip ok">可借 ' + g.lendable + '／共 ' + g.total + '</span>'
        : '<span class="chip">目前沒有可借（共 ' + g.total + '）</span>';
      return '<div class="card pub-item">' + (g.photoId ? '<img class="pub-thumb" data-photo="' + esc(g.photoId) + '" alt="">' : '<div class="pub-thumb"></div>') +
        '<div class="pub-body"><strong>' + esc(g.name) + '</strong>' + (g.spec ? '<div class="meta">' + esc(g.spec) + '</div>' : '') +
        '<div class="row chips" style="margin-top:4px">' + chip + (g.out ? '<span class="chip accent">借出中 ' + g.out + '</span>' : '') + '</div>' +
        (g.lendable ? '<div class="row" style="margin-top:6px"><label class="radio" style="margin:0">借 <input type="number" class="qty" min="0" max="' + g.lendable +
          '" value="' + (cart[groupKey(g)] || 0) + '" data-g="' + esc(groupKey(g)) + '" inputmode="numeric"> 件</label></div>' : '') +
        '<details><summary class="small">編號與狀態</summary><div class="codes">' + g.items.map((it) =>
          '<a class="chip' + (it.loan === '可借用' ? ' ok' : it.loan === '借出中' ? ' accent' : '') + '" href="#/asset/' + esc(it.qr[0]) + '/' +
          encodeURIComponent(it.key) + '">' + esc(it.code || '（未編號）') + ' ' + esc(it.loan) + '</a>').join('') + '</div></details></div></div>';
    }).join('') || '<div class="card"><p class="muted" style="margin:0">' + (groups.length ? '沒有符合的設備。' : '目前沒有開放借用的設備。') + '</p></div>';
    loadThumbs($('#pubList'));
    $('#pubList').querySelectorAll('input.qty').forEach((el) => {
      el.oninput = () => {
        const max = Number(el.max);
        let n = Math.max(0, Math.min(max, parseInt(el.value, 10) || 0));
        if (String(n) !== el.value && el.value !== '') el.value = n;
        if (n) cart[el.dataset.g] = n; else delete cart[el.dataset.g];
        drawCart();
      };
    });
  };
  const cart = state.cart || (state.cart = {});
  const drawCart = () => {
    const n = Object.values(cart).reduce((a, b) => a + b, 0);
    $('#cartBar').hidden = !n;
    $('#cartN').textContent = n;
  };
  view.insertAdjacentHTML('beforeend', '<div class="batchbar" id="cartBar" hidden><span class="grow" style="align-items:center">已選 <strong id="cartN" style="margin:0 4px">0</strong> 件</span>' +
    '<button type="button" class="primary" id="cartGo">申請借用</button></div>');
  $('#cartGo').onclick = () => {
    // 每組取編號最前面的 N 件可借的
    state.applyItems = [];
    groups.forEach((g) => {
      const n = cart[groupKey(g)] || 0;
      g.items.filter((it) => it.loan === '可借用').slice(0, n).forEach((it) => state.applyItems.push({ id: it.key, code: it.code, name: g.name, spec: g.spec }));
    });
    if (!state.applyItems.length) { toast('請先選要借的件數', true); return; }
    location.hash = '#/apply';
  };
  // 清單重新載入後，已不能借的件數要縮回
  groups.forEach((g) => { const k = groupKey(g); if (cart[k] > g.lendable) { if (g.lendable) cart[k] = g.lendable; else delete cart[k]; } });
  Object.keys(cart).forEach((k) => { if (!groups.some((g) => groupKey(g) === k)) delete cart[k]; });
  $('#pubQ').oninput = draw;
  draw();
  drawCart();
}

function groupKey(g) {
  return g.name + '\n' + g.spec;
}

// ----- 借用申請（公開）-----

async function viewApply(view) {
  const items = state.applyItems || [];
  if (!items.length) {
    view.innerHTML = '<h1>申請借用</h1><div class="card"><p>還沒有選物品。</p></div><a class="btn primary" href="#/public">到可借設備選物品</a>';
    return;
  }
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const field = (f) => {
    const id = 'ap_' + f.name;
    const type = f.name.indexOf('日') !== -1 ? 'date' : f.name === 'Email' ? 'email' : f.name === '手機' ? 'tel' : 'text';
    const extra = type === 'date' ? ' min="' + today + '"' : '';
    const input = f.name === '用途' || f.name === '備註'
      ? '<textarea id="' + esc(id) + '" rows="2" maxlength="' + f.max + '"></textarea>'
      : '<input id="' + esc(id) + '" type="' + type + '" maxlength="' + f.max + '"' + extra + (f.name === 'Email' ? ' autocomplete="email"' : f.name === '借用人姓名' ? ' autocomplete="name"' : '') + '>';
    return '<label for="' + esc(id) + '">' + esc(f.name) + (f.required ? '' : '（選填）') + '</label>' + input;
  };
  view.innerHTML = '<h1>申請借用</h1><div class="card"><h2>借用物品（' + items.length + ' 件）</h2><ul class="list">' +
    items.map((it) => '<li><span class="code">' + esc(it.code || '未編號') + '</span> ' + esc(it.name) + (it.spec ? '<div class="meta">' + esc(it.spec) + '</div>' : '') + '</li>').join('') +
    '</ul><a class="small" href="#/public">修改選擇</a></div>' +
    '<form class="card" id="apForm">' + LOAN_APPLICANT_FIELDS.map(field).join('') +
    // 防機器人：人看不到、不會填的欄位
    '<div class="hp" aria-hidden="true"><label for="apWebsite">網站</label><input id="apWebsite" name="website" tabindex="-1" autocomplete="off"></div>' +
    '<p class="meta muted">送出後會產生借用單號，請印出（或存 PDF）帶到系辦，借出時簽名。資料只用於本次借用管理。</p>' +
    '<div id="apErr" class="meta" style="color:var(--bad)"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="primary" type="submit" id="apGo">送出申請</button></div></form>';
  $('#ap_預計借出日').value = today;
  const openedAt = Date.now();
  $('#apForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const payload = { items: items.map((it) => it.id), _meta: { hp: $('#apWebsite').value, elapsed: Math.round((Date.now() - openedAt) / 1000) } };
    LOAN_APPLICANT_FIELDS.forEach((f) => { payload[f.name] = $('#ap_' + f.name).value; });
    const check = validateLoanRequest(payload, today);
    if (!check.ok) { $('#apErr').innerHTML = check.errors.map(esc).join('<br>'); return; }
    $('#apErr').textContent = '';
    $('#apGo').disabled = true;
    try {
      const data = await api('loan.apply', payload);
      state.applyItems = [];
      state.cart = {};
      renderLoanSlip(view, data, true);
    } catch (e) {
      $('#apGo').disabled = false;
      $('#apErr').innerHTML = esc(e.message);
    }
  };
}

function viewLoanLookup(view) {
  view.innerHTML = '<h1>查詢借用單</h1><form class="card" id="lkForm"><label for="lkId">借用單號（例 L20261116-01）</label><input id="lkId" autocapitalize="characters">' +
    '<label for="lkPhone">申請時填的手機</label><input id="lkPhone" type="tel">' +
    '<div class="row" style="margin-top:12px;justify-content:flex-end"><button class="primary" type="submit">查詢</button></div></form>' +
    '<a class="btn" href="#/public">回可借設備</a>';
  $('#lkForm').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      renderLoanSlip(view, await api('loan.lookup', { id: $('#lkId').value, phone: $('#lkPhone').value }), false);
    } catch (e) {
      toast(e.message, true);
    }
  };
}

/** 借用單（可列印）：表頭、借用人、物品、借出與歸還簽名欄。 */
function renderLoanSlip(view, data, fresh) {
  const l = data.loan;
  const kv = (k) => '<tr><th>' + esc(k) + '</th><td>' + esc(l[k] || '') + '</td></tr>';
  view.innerHTML = (fresh ? '<div class="card no-print"><strong>已送出申請。</strong><div class="meta">借用單號 <strong>' + esc(l['借用單號']) +
      '</strong>。請按「列印借用單」印出或存成 PDF，帶到系辦借出並簽名。之後可用單號與手機在「查詢借用單」再印一次。</div></div>' : '') +
    '<div class="slip"><h1 class="center">' + esc(data.unit || '') + ' 設備借用單</h1>' +
    '<div class="row spread meta"><span>借用單號：<strong>' + esc(l['借用單號']) + '</strong></span><span>狀態：' + esc(l['狀態']) + '</span><span>申請時間：' + esc(l['申請時間']) + '</span></div>' +
    '<table class="kv slip-table">' + ['借用人姓名', '學號或職號', '系所單位', '手機', 'Email', '指導教授', '用途', '使用地點'].map(kv).join('') +
    '<tr><th>預計借用期間</th><td>' + esc(l['預計借出日']) + ' ～ ' + esc(l['預計歸還日']) + '</td></tr>' + (l['備註'] ? kv('備註') : '') + '</table>' +
    '<table class="grid-table"><thead><tr><th>#</th><th>系所編號</th><th>名稱／規格</th><th>借出核對</th><th>歸還日期</th><th>歸還經手</th></tr></thead><tbody>' +
    l.details.map((d, i) => '<tr><td>' + (i + 1) + '</td><td><strong>' + esc(d['系所編號'] || '') + '</strong></td><td>' + esc(d['名稱']) +
      (d['規格'] ? '<div class="meta">' + esc(d['規格']) + '</div>' : '') + '</td><td></td><td>' + esc((d['歸還時間'] || '').slice(0, 10)) + '</td><td></td></tr>').join('') +
    '</tbody></table>' +
    '<p class="meta">借用人同意妥善使用並於預計歸還日前歸還；遺失或損壞依規定賠償。</p>' +
    '<div class="signs"><div>借用人簽名<span></span></div><div>借出經手人<span></span></div><div>借出日期<span></span></div><div>全部歸還確認<span></span></div></div></div>' +
    '<div class="row no-print" style="margin-top:12px"><button type="button" class="primary" id="slipPrint">列印借用單</button><a class="btn" href="#/public">回可借設備</a></div>';
  $('#slipPrint').onclick = () => window.print();
}

/** 依序載入縮圖（一次一張，避免同時打太多請求）。 */
async function loadThumbs(root) {
  const imgs = Array.from(root.querySelectorAll('img[data-photo]'));
  for (const img of imgs) {
    if (!img.isConnected) return;
    try { img.src = await photoSrc(img.dataset.photo, 'public.photo', true); } catch (e) { img.remove(); }
  }
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
  const inv = (data.inventory || {})[type];
  const scope = inv ? scopeKeys(type, data[type], inv.batch) : {};
  const draw = () => {
    const list = filterAssets(type, data[type], { q: $('#mQ').value });
    const invNote = inv ? '<div class="card"><strong>盤點中：' + esc(inv.batch['名稱']) + '</strong><div class="meta">範圍 ' + esc(inv.batch['範圍說明']) +
      (inv.batch['截止日'] ? '｜截止 ' + fmtDate(inv.batch['截止日']) : '') + '｜請對名下每件按「自行盤點」拍照回報；Admin 看照片不合格會退回。</div></div>' : '';
    $('#mList').innerHTML = invNote + '<div class="card"><ul class="list">' + (list.map((r) => {
      const serial = displaySerial(r);
      const lines = type === 'FIXED'
        ? [assetKey(type, r), r['廠牌規格'], serial.text && (serial.isPurchaseNo ? '請購案號 ' : '序號 ') + serial.text]
        : [r['材料編號'], '帳面 ' + r['帳面數量'] + ' ' + (r['單位'] || '')];
      const lastCheck = r['最近盤點日'] ? '最近盤點 ' + fmtDate(r['最近盤點日']) +
        (type === 'FIXED' ? ' ' + (r['最近盤點結果'] || '') : (r['最近盤點數量'] ? ' 實點 ' + r['最近盤點數量'] : '')) : '尚未盤點';
      const key = assetKey(type, r);
      const result = inv ? inv.results[key] : null;
      const canSelf = inv && scope[key] && inventoryState(result) !== '已盤';
      return '<li><strong>' + esc(assetName(type, r)) + '</strong><div class="meta">' + lines.filter(Boolean).map(esc).join('｜') +
        '</div><div class="meta">位置：' + esc(currentLocation(r) || '未填') + '｜部門 ' + esc(r['部門代號']) + '｜' + esc(lastCheck) +
        (r['經管人'] ? '｜經管 ' + esc(r['經管人']) : '') + '</div><div class="row chips">' + statusChips(r) + inventoryChips(result) +
        (canSelf ? '<button type="button" class="small" data-inv="' + esc(key) + '">自行盤點</button>' : '') + '</div></li>';
    }).join('') || '<li class="muted">沒有資料</li>') + '</ul></div>';
    $('#mList').querySelectorAll('[data-inv]').forEach((b) => {
      const r = data[type].find((x) => assetKey(type, x) === b.dataset.inv);
      b.onclick = () => inventoryDialog(type, r, [inv.batch], () => viewMine(view));
    });
  };
  $('#mQ').oninput = draw;
  draw();
}

/** 批次範圍內的資產鍵：{ 鍵: true }（範圍＝清單篩選，和 filterAssets 同一套）。 */
function scopeKeys(type, rows, batch) {
  let f = {};
  try { f = JSON.parse(batch['範圍'] || '{}'); } catch (e) { f = {}; }
  const out = {};
  filterAssets(type, rows, f, state.me.email).forEach((r) => { out[assetKey(type, r)] = true; });
  return out;
}

/** 本次批次的盤點狀態標籤。 */
function inventoryChips(result) {
  const st = inventoryState(result);
  if (!st) return '';
  if (st === '退回') return '<span class="chip bad" title="' + esc(result['退回原因'] || '') + '">盤點被退回</span>';
  return '<span class="chip ' + (isAbnormal(result) ? 'warn' : 'ok') + '">已盤 ' + esc(result['結果']) +
    (result['實際數量'] ? ' ' + esc(result['實際數量']) : '') + '</span>' +
    (result['方式'] === INV_SELF ? '<span class="chip">自行盤點</span>' : '');
}

async function viewAsset(view, params) {
  const type = typeFromQr(params[0]);
  const key = params[1];
  const label = ASSET_TYPES[type].label;
  if (!can(state.me.role, 'asset.view')) return viewPublicAsset(view, type, key);
  state.lastAssetKey = params[0] + '/' + key;
  view.innerHTML = '<h1>' + esc(label) + ' ' + esc(key) + '</h1><p class="muted">載入中…</p>';
  let data;
  try {
    data = await api('asset.get', { type, key });
  } catch (e) {
    view.innerHTML = '<h1>' + esc(label) + ' ' + esc(key) + '</h1><div class="card"><p>' + esc(e.message) + '</p></div>' +
      '<a class="btn" href="#/assets">回資產清單</a>';
    return;
  }
  renderAssetDetail(view, type, data.rows, data.managers, data.items, data.inventory, data.cases);
}

/** 訪客、尚未開通的帳號、User 掃 QR 看到的公開資訊（欄位由 shared/publicView.js 決定）。 */
async function viewPublicAsset(view, type, key) {
  const label = ASSET_TYPES[type].label;
  view.innerHTML = '<h1>' + esc(label) + '</h1><p class="muted">載入中…</p>';
  let data;
  try {
    data = await api('public.get', { type, key });
  } catch (e) {
    view.innerHTML = '<h1>' + esc(label) + '</h1><div class="card"><p>' +
      esc(e.code === 'NOT_FOUND' ? '找不到這個編號，請確認 QR 貼紙是否正確。' : e.message) + '</p></div>' +
      loginHint() + '<a class="btn" href="#/">回首頁</a>';
    return;
  }
  const a = data.asset;
  const kv = (k, v) => v && String(v).trim() ? '<tr><th>' + esc(k) + '</th><td>' + v + '</td></tr>' : '';
  const chip = a.lendable ? 'ok' : a.loan === '借出中' ? 'accent' : '';
  view.innerHTML = '<h1>' + esc(a.name) + '</h1><div class="row" style="margin:-4px 0 10px"><span class="chip ' + chip + '">' +
    esc(a.loan) + '</span></div><div class="card">' +
    (data.photoId ? '<img class="photo-full" id="pubPhoto" alt="代表照片" style="margin-bottom:10px">' : '') +
    '<table class="kv">' + kv('類型', esc(a.label)) + kv('編號', '<strong>' + esc(a.code || '（未編號）') + '</strong>') +
    kv('規格', esc(a.spec)) + kv('單位', esc(data.unit)) + '</table></div>' +
    (a.lendable ? '<div class="card"><p style="margin:0">這件設備開放借用。線上借用申請建置中，請洽系辦。</p></div>' : '') +
    loginHint() + '<div class="row"><a class="btn" href="#/scan">再掃一件</a><a class="btn" href="#/">回首頁</a></div>';
  if (data.photoId) {
    photoSrc(data.photoId, 'public.photo').then((src) => { const img = $('#pubPhoto'); if (img) img.src = src; })
      .catch(() => { const img = $('#pubPhoto'); if (img) img.remove(); });
  }
}

function loginHint() {
  const me = state.me;
  if (!me.loggedIn) return '<p class="meta muted">管理者請按右上角登入，登入後會直接進入這件的管理頁。</p>';
  if (me.role === ROLE_USER) return '<p class="meta muted">保管人請到「<a href="#/mine">我名下的財產</a>」查看完整資料。</p>';
  return '<p class="meta muted">您的帳號尚未開通管理權限，請聯絡系辦。</p>';
}

/** 在螢幕上顯示這件的 QR（內容與貼紙相同）：手機掃螢幕即可測試，貼紙掉了也能臨時用。 */
async function showQrDialog(type, row) {
  const url = labelUrl(state.config.qrBase, type, qrKey(type, row));
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  form.innerHTML = '<h2>' + esc(assetName(type, row)) + '</h2><div class="qrbox" id="qrBox"><p class="muted">產生中…</p></div>' +
    '<p class="meta center" style="word-break:break-all">' + esc(url) + '</p>' +
    (type === 'CUSTODY' && !row['QR碼'] ? '<p class="meta muted">這筆保管品還沒有 QR 短碼（匯出貼紙時會自動補），這裡暫用保管品鍵。</p>' : '') +
    '<div class="row" style="margin-top:12px;justify-content:flex-end"><button value="cancel">關閉</button></div>';
  dlg.showModal();
  try {
    if (!window.qrcode) await loadScript(QRCODE_URL);
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('#qrBox').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  } catch (e) {
    $('#qrBox').innerHTML = '<p>' + esc(e.message) + '</p>';
  }
}

const QRCODE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

// ----- 掃描 QR（站內相機）-----

const JSQR_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js';
let scanner = null;

function stopScanner() {
  if (!scanner) return;
  scanner.stopped = true;
  if (scanner.stream) scanner.stream.getTracks().forEach((t) => t.stop());
  scanner = null;
}

/** 掃到或輸入的文字 → 資產頁；看不懂回傳 false。 */
function gotoQr(text, manual) {
  const p = parseQrText(text);
  if (!p) {
    toast(manual ? '看不懂這個編號' : '這不是本系統的 QR 貼紙', true);
    return false;
  }
  location.hash = '#/asset/' + ASSET_TYPES[p.type].qr + '/' + encodeURIComponent(p.key);
  return true;
}

function viewScan(view) {
  view.innerHTML = '<h1>掃描 QR 貼紙</h1>' +
    '<div class="card"><div class="scanbox"><video id="scanVideo" playsinline muted autoplay></video><div class="scanframe"></div></div>' +
    '<p class="meta muted" id="scanMsg" style="margin:8px 0 0">正在開啟相機…</p></div>' +
    '<div class="card"><h2>或輸入編號</h2><form id="scanForm" class="row">' +
    '<input id="scanInput" class="grow1" placeholder="資產編號、保管品 QR碼、系所編號（CB-001）" autocomplete="off" autocapitalize="characters">' +
    '<button class="primary" type="submit">查詢</button></form></div>' +
    '<a class="btn" href="#/">回首頁</a>';
  $('#scanForm').onsubmit = (ev) => { ev.preventDefault(); gotoQr($('#scanInput').value, true); };
  startScanner($('#scanVideo'), $('#scanMsg'));
}

/** 開後鏡頭連續辨識：有 BarcodeDetector（Android Chrome）直接用，否則載入 jsQR（iPhone Safari）。 */
async function startScanner(video, msg) {
  stopScanner();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    msg.textContent = '這個瀏覽器不支援相機，請用手機相機 App 掃描，或在下方輸入編號。';
    return;
  }
  const s = { stopped: false, stream: null };
  scanner = s;
  try {
    s.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
  } catch (e) {
    if (scanner === s) scanner = null;
    msg.textContent = '無法開啟相機（' + (e.name === 'NotAllowedError' ? '沒有允許使用相機' : e.message) +
      '）。請用手機相機 App 掃描，或在下方輸入編號。';
    return;
  }
  if (s.stopped) { s.stream.getTracks().forEach((t) => t.stop()); return; }
  video.srcObject = s.stream;
  try { await video.play(); } catch (e) { /* 使用者已離開 */ }

  let detect = null;
  if (window.BarcodeDetector) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.indexOf('qr_code') !== -1) {
        const d = new BarcodeDetector({ formats: ['qr_code'] });
        detect = async () => { const r = await d.detect(video); return r.length ? r[0].rawValue : ''; };
      }
    } catch (e) { detect = null; }
  }
  if (!detect) {
    try { if (!window.jsQR) await loadScript(JSQR_URL); } catch (e) { msg.textContent = '無法載入掃描元件，請在下方輸入編號。'; return; }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    detect = async () => {
      if (!video.videoWidth) return '';
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      return r ? r.data : '';
    };
  }
  if (s.stopped) return;
  msg.textContent = '對準貼紙上的 QR Code。';
  const tick = async () => {
    if (s.stopped) return;
    let text = '';
    try { text = await detect(); } catch (e) { text = ''; }
    if (s.stopped) return;
    if (text) {
      if (parseQrText(text)) {
        stopScanner();
        if (navigator.vibrate) navigator.vibrate(80);
        gotoQr(text);
        return;
      }
      msg.textContent = '這不是本系統的 QR 貼紙：' + text.slice(0, 60);
    }
    setTimeout(tick, 150);
  };
  tick();
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

function renderAssetDetail(view, type, rows, managers, pieces, inventory, cases) {
  const main = rows[0];
  const openCases = (cases || []).filter(isCaseOpen);
  const caseHtml = (cases || []).length ? '<div class="card"><h2>異常案件</h2><ul class="list">' + cases.map((c) => caseItemHtml(c, managers, false)).join('') + '</ul></div>' : '';
  const batches = (inventory && inventory.batches) || [];
  const invHtml = batches.map((b) => {
    const r = (inventory.results || {})[b['批次編號']];
    return '<div class="meta">' + esc(b['名稱']) + '：' + (inventoryChips(r) || '<span class="chip warn">未盤</span>') + '</div>';
  }).join('');
  const serial = displaySerial(main);
  const kv = (k, v) => v && String(v).trim() ? '<tr><th>' + esc(k) + '</th><td>' + v + '</td></tr>' : '';
  const custodian = esc(main['保管人代號']) + ' ' + esc(main['保管人姓名']);
  let table;
  if (type === 'FIXED') {
    const linked = (pieces || [])[0];
    table = (main['名稱修正'] ? kv('學校清冊名稱', esc(main['資產名稱'])) : '') + kv('資產編號', esc(main['資產編號'])) +
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
    table = (main['名稱修正'] ? kv('學校清冊名稱', esc(main['品名規格'])) : '') + kv('材料編號', '<strong>' + esc(main['材料編號']) + '</strong>') +
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
    (type === 'CUSTODY' ? piecesCardHtml(main, pieces || []) : '') + caseHtml +
    '<div class="card"><h2>建檔照片</h2><div id="photoBox"><p class="muted">載入中…</p></div>' +
    (can(state.me.role, 'photo.upload') ? photoButtonsHtml() : '') + '<ul class="list" id="upList"></ul></div>' +
    '<div class="card"><h2>管理</h2>' + invHtml + '<div class="row">' +
    (can(state.me.role, 'asset.edit') ? '<button class="primary" id="aEdit">編輯</button>' : '') +
    '<button type="button" id="aInv"' + (batches.length ? '' : ' disabled title="沒有進行中的盤點批次"') + '>盤點</button>' +
    '<button disabled>借出</button><button disabled>歸還</button>' +
    (can(state.me.role, 'case.open') && assetStatus(main) !== '報廢' ? '<button type="button" id="aCase">登記異常' + (openCases.length ? '（處理中 ' + openCases.length + '）' : '') + '</button>' : '') +
    '<button type="button" id="aQr">顯示 QR</button></div></div>' +
    '<a class="btn" href="#/assets">回資產清單</a>';
  if (type === 'CUSTODY' && $('#pcNew')) $('#pcNew').onclick = () => createPiecesDialog(main, pieces || []);
  $('#aQr').onclick = () => showQrDialog(type, main);
  if (batches.length) $('#aInv').onclick = () => inventoryDialog(type, main, batches, () => viewAsset(view, [ASSET_TYPES[type].qr, assetKey(type, main)]));
  if ($('#aCase')) $('#aCase').onclick = () => openCaseDialog(type, main, {}, () => viewAsset(view, [ASSET_TYPES[type].qr, assetKey(type, main)]));
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
      : '<p class="meta muted">規格、保管人、存放位置以學校清冊為準，請用匯入更新。清冊名稱有缺字錯字時，填「名稱修正」。</p>' +
        '<label for="eFix">名稱修正（留空＝用清冊名稱）</label><input id="eFix" value="' + esc(row['名稱修正']) + '" placeholder="' + esc(sourceName(type, row)) + '">' +
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
          isItem ? { 系所編號: $('#eCode').value, 名稱: $('#eName').value, 規格: $('#eSpec').value } : { 名稱修正: $('#eFix').value }),
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

async function photoSrc(id, action, thumb) {
  const k = thumb ? id + ':thumb' : id;
  if (!photoCache[k]) {
    photoCache[k] = api(action || 'photo.get', { id, thumb: !!thumb }).then((r) => 'data:' + (r.mime || 'image/jpeg') + ';base64,' + r.base64);
  }
  return photoCache[k];
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
    sel('fCase', '異常案件', [{ value: '處理中', label: '異常案件：處理中' }], '<option value="">異常案件：不限</option>') +
    (data.inventory ? sel('fInv', '盤點', [{ value: '已盤', label: '本次已盤' }, { value: '未盤', label: '本次未盤（範圍內）' }, { value: '自行', label: '自行盤點' },
      { value: '退回', label: '被退回' }, { value: '異常', label: '結果異常' }], '<option value="">盤點（' + esc(data.inventory.batch['名稱']) + '）：不限</option>') : '') +
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
  const inv = { openCases: data.openCases || {} };
  if (data.inventory) { inv.results = data.inventory.results; inv.scope = data.invScope || (data.invScope = scopeKeys(type, data.rows, data.inventory.batch)); }
  const list = filterAssets(type, data.rows, ui.f, state.me.email, data.photoCounts, inv);
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
        : [r['材料編號'], r['帳面數量'] + ' ' + (r['單位'] || '') + (stats ? '（單件 ' + stats['件數'] + '，借出 ' + stats['借出'] + '）' : ''),
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
      (nPhoto ? '<span class="chip">建檔照片 ' + nPhoto + '</span>' : '') + (inv.results ? inventoryChips(inv.results[assetKey(type, r)]) : '') +
      (inv.openCases[type + ':' + assetKey(type, r)] ? '<span class="chip bad">異常處理中</span>' : '') + '</div></a></li>';
  }).join('');

  $('#lResult').innerHTML = '<div class="row spread meta" style="margin:4px 2px 8px"><span>共 ' + list.length + ' 筆' +
    (canEdit ? '，已勾選 <strong id="selCount">' + ui.selected.size + '</strong> 筆' : '') + '</span>' +
    '<span class="row">' + (canEdit ? '<button type="button" id="selAll">全選篩選結果</button><button type="button" id="selNone">清除勾選</button>' : '') +
    '<button type="button" id="lLabels" title="勾選的；沒勾選就是目前篩選結果">匯出貼紙 Excel</button></span>' +
    '</div><div class="card"><ul class="list">' + (items || '<li class="muted">沒有符合的資料</li>') + '</ul>' +
    (list.length > ui.shown ? '<div class="center" style="margin-top:8px"><button type="button" id="lMore">再顯示 ' +
      Math.min(LIST_PAGE, list.length - ui.shown) + ' 筆（還有 ' + (list.length - ui.shown) + '）</button></div>' : '') + '</div>' +
    (canEdit ? '<div class="batchbar" id="batchBar"' + (ui.selected.size ? '' : ' hidden') + '>' +
      '<select id="bField" aria-label="要改的欄位">' + (type === 'ITEM' ? ['系所編號'] : type === 'FIXED' ? ['建立系所物品'] : []).concat(ASSET_BATCH_FIELDS, ['名稱取代'])
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
    if (ui.batchField === '名稱取代') {
      $('#bValueBox').innerHTML = '<input id="bFind" placeholder="找（例：周邊 統）" autocomplete="off">' +
        '<input id="bValue" placeholder="換成（例：周邊系統）" autocomplete="off">';
      return;
    }
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
    if (field === '名稱取代') {
      try {
        const r = await api('asset.replaceName', {
          type, find: $('#bFind').value, replace: value, items: [...ui.selected].map((k) => ({ rowKey: k, version: versions[k] })),
        });
        toast('已修正 ' + r.updated + ' 筆名稱');
        ui.selected.clear();
        await loadAssets(type, true);
      } catch (e) {
        toast(e.message, true);
        if (e.code === 'VERSION_CONFLICT') await loadAssets(type, true).catch(() => {});
      }
      renderAssetList(type, state.assets[type], ui);
      return;
    }
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

// ----- 盤點 -----

const DEFAULT_BATCH_NAMES = { FIXED: '年度固定資產盤點', CUSTODY: '保管品點數', ITEM: '系所物品盤點' };

async function viewInventory(view) {
  view.innerHTML = '<h1>盤點</h1><p class="muted">載入中…</p>';
  let data;
  try {
    data = await api('inventory.batches');
  } catch (e) {
    view.innerHTML = '<h1>盤點</h1><div class="card"><p>' + esc(e.message) + '</p></div>';
    return;
  }
  const active = data.batches.filter(isBatchActive);
  const closed = data.batches.filter((b) => !isBatchActive(b));
  const item = (b) => '<li><a href="#/inventory/' + encodeURIComponent(b['批次編號']) + '"><strong>' + esc(b['名稱']) + '</strong>' +
    '<div class="meta">' + esc(ASSET_TYPES[b['類型']].label) + '｜範圍 ' + esc(b['範圍說明']) + '｜' + fmtDate(b['開始日']) +
    (b['截止日'] ? ' ～ ' + fmtDate(b['截止日']) : '') + '｜' + esc(b['批次編號']) + '</div></a></li>';
  view.innerHTML = '<h1>盤點</h1><div class="row" style="margin-bottom:10px"><button type="button" class="primary" id="bNew">＋ 建立批次</button>' +
    '<a class="btn" href="#/scan">掃描 QR</a></div>' +
    '<div class="card"><h2>進行中</h2><ul class="list">' + (active.map(item).join('') || '<li class="muted">沒有進行中的批次。建立批次後，資產頁的「盤點」才會開啟。</li>') + '</ul></div>' +
    (closed.length ? '<details><summary>已結束（' + closed.length + '）</summary><div class="card"><ul class="list">' + closed.map(item).join('') + '</ul></div></details>' : '');
  $('#bNew').onclick = () => createBatchDialog(data.managers);
}

function createBatchDialog(managers) {
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  const year = new Date().getFullYear();
  form.innerHTML = '<h2>建立盤點批次</h2>' +
    '<label for="bType">類型</label><select id="bType">' + Object.keys(ASSET_TYPES).map((t) => '<option value="' + t + '">' + ASSET_TYPES[t].label + '</option>').join('') + '</select>' +
    '<label for="bName">名稱</label><input id="bName" value="' + year + ' ' + DEFAULT_BATCH_NAMES.FIXED + '">' +
    '<p class="meta muted">範圍：留空＝全部。範圍只影響「應盤幾件、未盤清單」，範圍外的資產也能盤。</p>' +
    '<div id="bScope"><p class="meta muted">載入選項…</p></div>' +
    '<label for="bEnd">截止日（提醒用，不會自動結束）</label><input id="bEnd" type="date">' +
    '<div class="row" style="margin-top:14px;justify-content:flex-end"><button value="cancel" formnovalidate>取消</button>' +
    '<button type="button" class="primary" id="bCreate">建立</button></div>';
  dlg.showModal();
  const fillScope = async () => {
    const type = $('#bType').value;
    if (!$('#bName').value || Object.values(DEFAULT_BATCH_NAMES).some((n) => $('#bName').value.endsWith(n))) $('#bName').value = year + ' ' + DEFAULT_BATCH_NAMES[type];
    $('#bScope').innerHTML = '<p class="meta muted">載入選項…</p>';
    let data;
    try { data = await loadAssets(type); } catch (e) { $('#bScope').innerHTML = '<p>' + esc(e.message) + '</p>'; return; }
    const opt = (id, field, label, opts) => '<label for="' + id + '">' + label + '</label><select id="' + id + '" data-s="' + field + '"><option value="">不限</option>' +
      opts.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>').join('') + '</select>';
    $('#bScope').innerHTML = opt('sDept', '部門代號', '部門', distinctValues(data.rows, '部門代號')) +
      opt('sCust', '保管人代號', '保管人', distinctValues(data.rows, '保管人代號')) +
      opt('sMgr', '經管人', '經管人', [{ value: 'me', label: '我經管的' }].concat(managers.map((m) => ({ value: m.email, label: m.name || m.email })))) +
      opt('sLoc', '位置', '實際位置', distinctValues(data.rows, '位置'));
  };
  $('#bType').onchange = fillScope;
  fillScope();
  $('#bCreate').onclick = async (ev) => {
    const scope = {};
    form.querySelectorAll('[data-s]').forEach((el) => { if (el.value) scope[el.dataset.s] = el.value; });
    ev.target.disabled = true;
    try {
      const b = await api('inventory.createBatch', { type: $('#bType').value, name: $('#bName').value, scope, endDate: $('#bEnd').value });
      dlg.close();
      toast('已建立 ' + b['批次編號']);
      if (state.assets) delete state.assets[b['類型']];
      location.hash = '#/inventory/' + encodeURIComponent(b['批次編號']);
    } catch (e) {
      ev.target.disabled = false;
      toast(e.message, true);
    }
  };
}

async function viewBatch(view, params) {
  const id = params[0];
  view.innerHTML = '<h1>盤點批次</h1><p class="muted">載入中…</p>';
  let data, assets;
  try {
    data = await api('inventory.batch', { id });
    assets = await loadAssets(data.batch['類型'], true);
  } catch (e) {
    view.innerHTML = '<h1>盤點批次</h1><div class="card"><p>' + esc(e.message) + '</p></div><a class="btn" href="#/inventory">回盤點</a>';
    return;
  }
  const b = data.batch;
  const type = b['類型'];
  const prefix = ASSET_TYPES[type].qr;
  const active = isBatchActive(b);
  const byKey = {};
  assets.rows.forEach((r) => { byKey[assetKey(type, r)] = r; });
  const scope = scopeKeys(type, assets.rows, b);
  const latest = latestResults(data.results, id);
  const st = batchStats(Object.keys(scope), latest);
  const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
  const name = (k) => { const r = byKey[k]; return r ? assetName(type, r) : '（清單沒有）'; };
  const link = (k, text) => '<a href="#/asset/' + prefix + '/' + encodeURIComponent(k) + '">' + text + '</a>';
  const code = (k) => { const r = byKey[k]; return type === 'CUSTODY' && r ? r['材料編號'] : type === 'ITEM' && r ? (r['系所編號'] || k) : k; };
  const missing = st.missing.map((k) => '<li>' + link(k, '<strong>' + esc(name(k)) + '</strong>') + '<div class="meta">' + esc(code(k)) +
    (byKey[k] ? '｜' + esc(currentLocation(byKey[k]) || '位置未填') + (byKey[k]['保管人姓名'] ? '｜' + esc(byKey[k]['保管人姓名']) : '') : '') +
    (inventoryState(latest[k]) === '退回' ? '｜<span class="chip bad">被退回：' + esc(latest[k]['退回原因']) + '</span>' : '') + '</div></li>').join('');
  const results = data.results.map((r) => {
    const photos = String(r['照片編號'] || '').split(',').filter(Boolean);
    const rejected = (r['狀態'] || RESULT_VALID) === RESULT_REJECTED;
    const isLatest = latest[r['資產鍵']] && latest[r['資產鍵']]['結果編號'] === r['結果編號'];
    return '<li' + (rejected || !isLatest ? ' style="opacity:.6"' : '') + '>' + link(r['資產鍵'], '<strong>' + esc(name(r['資產鍵'])) + '</strong>') +
      '<div class="meta">' + esc(code(r['資產鍵'])) + '｜' + esc(r['盤點時間']) + '｜' + esc(managerLabel(r['盤點人'], data.managers) || r['盤點人']) +
      (r['實際位置'] ? '｜位置 ' + esc(r['實際位置']) : '') + (r['備註'] ? '｜' + esc(r['備註']) : '') + (!isLatest && !rejected ? '｜已被後來的結果取代' : '') + '</div>' +
      '<div class="row chips"><span class="chip ' + (rejected ? 'bad' : r['結果'] === '正常' ? 'ok' : 'warn') + '">' + esc(rejected ? '退回：' + r['退回原因'] : r['結果']) +
      (r['實際數量'] ? ' ' + esc(r['實際數量']) : '') + '</span>' + (r['方式'] === INV_SELF ? '<span class="chip">自行盤點</span>' : '') +
      (photos.length ? '<button type="button" class="small" data-photos="' + esc(photos.join(',')) + '">照片 ' + photos.length + '</button>' : '') +
      (active && !rejected && isLatest ? '<button type="button" class="small" data-reject="' + esc(r['結果編號']) + '">退回</button>' : '') +
      (isAbnormal(r) && isLatest && byKey[r['資產鍵']] && can(state.me.role, 'case.open') ? '<button type="button" class="small" data-case="' + esc(r['資產鍵']) + '" data-result="' + esc(r['結果編號']) + '" data-kind="' + esc(r['結果']) + '">登記異常</button>' : '') + '</div></li>';
  }).join('');
  view.innerHTML = '<h1>' + esc(b['名稱']) + '</h1><p class="meta muted">' + esc(ASSET_TYPES[type].label) + '｜範圍 ' + esc(b['範圍說明']) + '｜' + fmtDate(b['開始日']) +
    (b['截止日'] ? ' ～ ' + fmtDate(b['截止日']) : '') + '｜' + esc(b['批次編號']) + '｜' + esc(b['狀態']) + '</p>' +
    '<div class="card"><div class="row spread"><strong>進度 ' + st.done + '／' + st.total + '（' + pct + '%）</strong>' +
    '<span class="row">' + (active ? '<a class="btn primary" href="#/scan">掃描 QR 盤點</a><button type="button" id="bClose">結束批次</button>' : '') + '</span></div>' +
    '<div class="progress"><div style="width:' + pct + '%"></div></div>' +
    '<div class="row chips" style="margin-top:8px"><span class="chip warn">未盤 ' + st.missing.length + '</span><span class="chip">自行盤點 ' + st.self + '</span>' +
    '<span class="chip bad">被退回 ' + st.rejected + '</span><span class="chip warn">結果異常 ' + st.abnormal + '</span>' +
    (st.extra.length ? '<span class="chip">範圍外盤到 ' + st.extra.length + '</span>' : '') + '</div>' +
    '<p class="meta muted" style="margin:8px 0 0">資產清單可用「盤點」篩選看本次已盤、未盤、自行盤點、被退回、結果異常。</p></div>' +
    '<div class="card"><h2>未盤（' + st.missing.length + '）</h2><ul class="list">' + (missing || '<li class="muted">範圍內全部盤完。</li>') + '</ul></div>' +
    '<div class="card"><h2>盤點結果（' + data.results.length + '）</h2><ul class="list">' + (results || '<li class="muted">還沒有結果。</li>') + '</ul></div>' +
    '<a class="btn" href="#/inventory">回盤點</a>';
  if ($('#bClose')) $('#bClose').onclick = async () => {
    if (!confirm('結束「' + b['名稱'] + '」？結束後不能再對這個批次盤點，未盤 ' + st.missing.length + ' 件會保持未盤。')) return;
    try { await api('inventory.closeBatch', { id, version: b['版本'] }); toast('已結束'); viewBatch(view, params); }
    catch (e) { toast(e.message, true); }
  };
  view.querySelectorAll('[data-photos]').forEach((btn) => { btn.onclick = () => showPhotoIds(btn.dataset.photos.split(',')); });
  view.querySelectorAll('[data-case]').forEach((btn) => {
    const kind = { '找不到': '遺失', '損壞': '損壞', '數量不符': '數量短少' }[btn.dataset.kind] || '其他';
    btn.onclick = () => openCaseDialog(type, byKey[btn.dataset.case], { caseType: kind, source: '盤點', sourceId: btn.dataset.result,
      description: '盤點結果：' + btn.dataset.kind + '（' + b['名稱'] + '）' }, () => viewBatch(view, params));
  });
  view.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.onclick = () => {
      const reason = prompt('退回原因（照片不合格、拍錯件等）；退回後這件回到未盤：');
      if (!reason || !reason.trim()) return;
      api('inventory.reject', { resultId: btn.dataset.reject, reason }).then(() => { toast('已退回'); viewBatch(view, params); }).catch((e) => toast(e.message, true));
    };
  });
}

/** 看幾張照片（盤點結果用）。 */
function showPhotoIds(ids) {
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  form.innerHTML = ids.map((id, i) => '<img class="photo-full" data-i="' + i + '" alt="照片 ' + (i + 1) + '" style="margin-bottom:8px">').join('') +
    '<div class="row" style="justify-content:flex-end"><button value="cancel">關閉</button></div>';
  ids.forEach((id, i) => photoSrc(id).then((src) => { const img = form.querySelector('[data-i="' + i + '"]'); if (img) img.src = src; }).catch(() => {}));
  dlg.showModal();
}

/**
 * 盤點一件：選批次 → 每格一張照片（先上傳成功）→ 結果、數量（保管品）、目前位置、備註 → 送出。
 * batches：可盤的進行中批次；done：成功後呼叫。
 */
function inventoryDialog(type, row, batches, done) {
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  const own = batches.filter((b) => b['類型'] === type);
  const slots = inventoryPhotoSlots(type, row);
  const photoIds = slots.map(() => '');
  const key = assetKey(type, row);
  const results = INVENTORY_RESULTS[type];
  form.innerHTML = '<h2>盤點 ' + esc(assetName(type, row)) + '</h2><div class="meta" style="margin-bottom:6px">' + esc(type === 'CUSTODY' ? row['材料編號'] : type === 'ITEM' ? (row['系所編號'] || key) : key) +
    (type === 'ITEM' && row['資產編號'] ? '｜連結固定資產 ' + esc(row['資產編號']) + '，視同盤點該固定資產（三張照片）' : '') + '</div>' +
    (own.length > 1 ? '<label for="iBatch">批次</label><select id="iBatch">' + own.map((b) => '<option value="' + esc(b['批次編號']) + '">' + esc(b['名稱']) + '</option>').join('') + '</select>'
      : own.length ? '<div class="meta">批次：' + esc(own[0]['名稱']) + '<input id="iBatch" type="hidden" value="' + esc(own[0]['批次編號']) + '"></div>'
        : '<p>沒有這個類型的進行中批次。</p>') +
    '<div class="slots">' + slots.map((name, i) => '<div class="slot" data-i="' + i + '"><div class="slot-img"><span class="muted">' + esc(name) + '</span></div>' +
      '<div class="row"><button type="button" class="small primary" data-cam="' + i + '">📷</button><button type="button" class="small" data-lib="' + i + '">🖼</button></div>' +
      '<div class="meta slot-msg"></div></div>').join('') + '</div>' +
    '<input id="iFile" type="file" accept="image/*" hidden>' +
    (type === 'CUSTODY' ? '<label for="iQty">實際數量（帳面 ' + esc(row['帳面數量']) + ' ' + esc(row['單位'] || '') + '）</label><input id="iQty" type="number" inputmode="numeric" min="0" value="' + esc(row['帳面數量']) + '">' : '') +
    '<label for="iResult">結果</label><select id="iResult">' + results.map((r) => '<option>' + r + '</option>').join('') + '</select>' +
    '<label for="iLoc">目前位置（實際放的地方；清冊：' + esc(row['存放位置'] || '未填') + '）</label><input id="iLoc" value="' + esc(currentLocation(row)) + '" placeholder="和清冊相同就照填">' +
    '<label for="iNote">備註</label><input id="iNote">' +
    '<div class="row" style="margin-top:14px;justify-content:flex-end"><button value="cancel" formnovalidate>取消</button>' +
    '<button type="button" class="primary" id="iSave"' + (own.length ? '' : ' disabled') + '>送出盤點</button></div>';
  dlg.showModal();
  if ($('#iQty')) {
    $('#iQty').oninput = () => { const s = suggestCustodyResult($('#iQty').value, row['帳面數量']); if (s) $('#iResult').value = s; };
  }
  let picking = -1;
  const fileInput = $('#iFile');
  form.querySelectorAll('[data-cam]').forEach((b) => { b.onclick = () => { picking = Number(b.dataset.cam); fileInput.setAttribute('capture', 'environment'); fileInput.click(); }; });
  form.querySelectorAll('[data-lib]').forEach((b) => { b.onclick = () => { picking = Number(b.dataset.lib); fileInput.removeAttribute('capture'); fileInput.click(); }; });
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file || picking < 0) return;
    const i = picking;
    const slot = form.querySelector('.slot[data-i="' + i + '"]');
    const msg = slot.querySelector('.slot-msg');
    const img = slot.querySelector('.slot-img');
    try {
      msg.textContent = '處理中…';
      const takenAt = await readExifDate(file);
      const blob = await compressImage(file);
      img.innerHTML = '<img src="' + URL.createObjectURL(blob) + '" alt="">';
      msg.textContent = '上傳中…（' + Math.round(blob.size / 1024) + ' KB）';
      const rec = await api('inventory.photo', { type, key, batchId: $('#iBatch').value, base64: await blobToBase64(blob), takenAt, originalName: file.name });
      photoIds[i] = rec['照片編號'];
      msg.textContent = '✔ ' + rec['檔名'];
    } catch (e) {
      photoIds[i] = '';
      img.innerHTML = '<span class="muted">' + esc(slots[i]) + '</span>';
      msg.innerHTML = '<span style="color:var(--bad)">✖ ' + esc(e.message) + '</span>';
    }
  };
  $('#iSave').onclick = async (ev) => {
    const input = { result: $('#iResult').value, photoCount: photoIds.filter(Boolean).length, quantity: $('#iQty') ? $('#iQty').value : '' };
    const err = validateInventoryInput(type, row, input);
    if (err) { toast(err, true); return; }
    ev.target.disabled = true;
    try {
      const r = await api('inventory.record', {
        type, key, batchId: $('#iBatch').value, result: input.result, quantity: input.quantity,
        location: $('#iLoc').value, note: $('#iNote').value, photoIds: photoIds.filter(Boolean),
      });
      dlg.close();
      toast('已盤點：' + r.result['結果'] + (r.linkedBatch ? '（固定資產批次也已記錄）' : ''));
      if (state.assets) { delete state.assets[type]; if (r.linkedBatch) delete state.assets.FIXED; }
      done();
    } catch (e) {
      ev.target.disabled = false;
      toast(e.message, true);
    }
  };
}

// ----- 異常案件 -----

function caseItemHtml(c, managers, withAsset) {
  const open = isCaseOpen(c);
  const type = c['類型'];
  const link = withAsset && ASSET_TYPES[type] ? '<a href="#/asset/' + ASSET_TYPES[type].qr + '/' + encodeURIComponent(c['資產鍵']) + '">' + esc(ASSET_TYPES[type].label + ' ' + c['資產鍵']) + '</a>｜' : '';
  return '<li><div class="row chips"><span class="chip ' + (open ? 'bad' : 'ok') + '">' + esc(c['狀態']) + '</span><strong>' + esc(c['異常類型']) + '</strong>' +
    (c['來源'] && c['來源'] !== '現場' ? '<span class="chip">' + esc(c['來源']) + '</span>' : '') + '</div>' +
    '<div class="meta">' + link + esc(c['案件編號']) + '｜' + esc(c['登記時間']) + ' ' + esc(managerLabel(c['登記人'], managers) || c['登記人']) + '</div>' +
    '<div>' + esc(c['說明']) + '</div>' +
    (open ? '' : '<div class="meta">結案：' + esc(c['處理結果']) + '｜' + esc(c['結案時間']) + ' ' + esc(managerLabel(c['結案人'], managers) || c['結案人']) +
      (c['結案說明'] ? '｜' + esc(c['結案說明']) : '') + '</div>') +
    (open && can(state.me.role, 'case.close') ? '<div class="row" style="margin-top:6px"><button type="button" class="small primary" data-close="' + esc(c['案件編號']) + '" data-v="' + esc(c['版本']) + '">結案</button></div>' : '') + '</li>';
}

async function viewCases(view) {
  view.innerHTML = '<h1>異常案件</h1><p class="muted">載入中…</p>';
  let data;
  try {
    data = await api('case.list');
  } catch (e) {
    view.innerHTML = '<h1>異常案件</h1><div class="card"><p>' + esc(e.message) + '</p></div>';
    return;
  }
  const open = data.cases.filter(isCaseOpen);
  const closed = data.cases.filter((c) => !isCaseOpen(c));
  view.innerHTML = '<h1>異常案件</h1><p class="meta muted">登記：在資產頁或盤點批次頁按「登記異常」，資產會自動停借。' +
    (can(state.me.role, 'case.close') ? '結案後解除停借（結果為報廢則改報廢）。' : '結案由 Super 執行。') + '</p>' +
    '<div class="card"><h2>處理中（' + open.length + '）</h2><ul class="list">' + (open.map((c) => caseItemHtml(c, data.managers, true)).join('') || '<li class="muted">沒有處理中的案件。</li>') + '</ul></div>' +
    (closed.length ? '<details><summary>已結案（' + closed.length + '）</summary><div class="card"><ul class="list">' + closed.map((c) => caseItemHtml(c, data.managers, true)).join('') + '</ul></div></details>' : '');
  view.querySelectorAll('[data-close]').forEach((btn) => {
    const c = data.cases.find((x) => x['案件編號'] === btn.dataset.close);
    btn.onclick = () => closeCaseDialog(c, () => viewCases(view));
  });
}

/** 登記異常。preset：{ caseType, description, source, sourceId }。 */
function openCaseDialog(type, row, preset, done) {
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  form.innerHTML = '<h2>登記異常：' + esc(assetName(type, row)) + '</h2><div class="meta">' + esc(type === 'CUSTODY' ? row['材料編號'] : type === 'ITEM' ? (row['系所編號'] || row['物品ID']) : row['資產編號']) +
    '｜目前狀態 ' + esc(assetStatus(row)) + (assetStatus(row) === '在庫' ? '→ 登記後停借' : '') + '</div>' +
    '<label for="cType">異常類型</label><select id="cType">' + CASE_TYPES.map((t) => '<option' + (t === preset.caseType ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
    '<label for="cDesc">說明（必填）</label><textarea id="cDesc" rows="3">' + esc(preset.description || '') + '</textarea>' +
    '<div class="row" style="margin-top:14px;justify-content:flex-end"><button value="cancel" formnovalidate>取消</button><button type="button" class="primary" id="cGo">登記</button></div>';
  dlg.showModal();
  $('#cGo').onclick = async (ev) => {
    if (!$('#cDesc').value.trim()) { toast('請填寫說明', true); return; }
    ev.target.disabled = true;
    try {
      const c = await api('case.open', { type, key: assetKey(type, row), caseType: $('#cType').value, description: $('#cDesc').value, source: preset.source || '現場', sourceId: preset.sourceId || '' });
      dlg.close();
      toast('已登記 ' + c['案件編號']);
      if (state.assets) delete state.assets[type];
      done();
    } catch (e) {
      ev.target.disabled = false;
      toast(e.message, true);
    }
  };
}

function closeCaseDialog(c, done) {
  const dlg = $('#dialog');
  const form = $('#dialogForm');
  form.innerHTML = '<h2>結案 ' + esc(c['案件編號']) + '</h2><div class="meta">' + esc(c['異常類型']) + '｜' + esc(c['說明']) + '</div>' +
    '<label for="cResult">處理結果</label><select id="cResult">' + CASE_RESULTS.map((r) => '<option>' + r + '</option>').join('') + '</select>' +
    '<p class="meta muted">報廢：資產改為報廢。其他：這件沒有別的處理中案件時，停借改回在庫。</p>' +
    '<label for="cNote">結案說明</label><textarea id="cNote" rows="2"></textarea>' +
    '<div class="row" style="margin-top:14px;justify-content:flex-end"><button value="cancel" formnovalidate>取消</button><button type="button" class="primary" id="cClose">結案</button></div>';
  dlg.showModal();
  $('#cClose').onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      await api('case.close', { id: c['案件編號'], version: c['版本'], result: $('#cResult').value, note: $('#cNote').value });
      dlg.close();
      toast('已結案');
      if (state.assets) delete state.assets[c['類型']];
      done();
    } catch (e) {
      ev.target.disabled = false;
      toast(e.message, true);
    }
  };
}

// ----- 貼紙 -----

/**
 * 匯出 BarTender 用的貼紙 Excel（QR 由 BarTender 產生）。
 * 用 Excel 而不是 CSV：每格都存成文字，資產編號開頭的 0 不會被去掉。
 */
async function exportLabels(type, data, rows) {
  if (!rows.length) { toast('沒有要匯出的資料', true); return; }
  if (type === 'CUSTODY' && rows.some((r) => !r['QR碼'])) {
    // 保管品鍵太長，QR 改用 6 位數短碼；還沒有的先請後端補上
    try {
      await api('asset.ensureQr', {});
      const fresh = await loadAssets(type, true);
      const byKey = {};
      fresh.rows.forEach((r) => { byKey[r['保管品鍵']] = r; });
      rows = rows.map((r) => byKey[r['保管品鍵']] || r);
      data = fresh;
    } catch (e) {
      toast(e.message, true);
      return;
    }
  }
  try {
    if (!window.XLSX) await loadScript(SHEETJS_URL);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const qrBase = state.config.qrBase || (location.origin + '/');
  const widths = state.config.labelNameWidths || [32];
  const nameOf = (email) => managerLabel(email, data.managers);
  const body = [labelColumns(widths)].concat(rows.map((r) => labelRow(qrBase, type, r, nameOf, widths)));
  const ws = XLSX.utils.aoa_to_sheet(body.map((r) => r.map((v) => String(v == null ? '' : v))));
  // 每格標成文字格式（@），在 Excel 打開再存檔也不會變成數字
  Object.keys(ws).forEach((k) => { if (k[0] !== '!') { ws[k].t = 's'; ws[k].z = '@'; } });
  ws['!cols'] = body[0].map((h) => ({ wch: h === 'QR網址' ? 48 : h.startsWith('NAME') ? 34 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '貼紙');
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  // bookSST：用一般文字儲存格（和在 Excel 打字一樣）；cellStyles：套用文字格式 @
  XLSX.writeFile(wb, '貼紙_' + ASSET_TYPES[type].label + '_' + ymd + '_' + rows.length + '筆.xlsx', { bookSST: true, cellStyles: true });
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
    el.onerror = () => reject(new Error('無法載入程式元件，請確認網路後再試'));
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
