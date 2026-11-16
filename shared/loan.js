/**
 * 借用 A（系所物品借用單）規則（純邏輯，前後端共用）：單號、申請檢查、狀態。
 * 流程：訪客申請（申請中）→ Admin 借出（借出中）→ 分批歸還 → 全部歸還結案（已歸還）；申請中逾期自動作廢（已作廢）。
 */

var LOAN_APPLIED = '申請中';
var LOAN_OUT = '借出中';
var LOAN_RETURNED = '已歸還';
var LOAN_VOID = '已作廢';
/** 單子還沒結束（物品被這張單占用）。 */
var LOAN_OPEN_STATES = [LOAN_APPLIED, LOAN_OUT];

var DETAIL_APPLIED = '申請中';
var DETAIL_OUT = '借出中';
var DETAIL_RETURNED = '已歸還';
var DETAIL_VOID = '已作廢';

var LOAN_MAX_ITEMS = 20;
var LOAN_MAX_DAYS = 90;

/** 申請表欄位（借用單分頁的欄名）與長度上限。 */
var LOAN_APPLICANT_FIELDS = [
  { name: '借用人姓名', max: 50, required: true },
  { name: '學號或職號', max: 20, required: true },
  { name: '系所單位', max: 50, required: true },
  { name: '手機', max: 20, required: true },
  { name: 'Email', max: 100, required: true },
  { name: '指導教授', max: 50, required: false },
  { name: '用途', max: 200, required: true },
  { name: '使用地點', max: 100, required: true },
  { name: '預計借出日', max: 10, required: true },
  { name: '預計歸還日', max: 10, required: true },
  { name: '備註', max: 300, required: false },
];

/** 下一個借用單號：L＋日期（yyyyMMdd）＋「-」＋兩位序號，同一天接續。 */
function nextLoanId(existingIds, dateText) {
  const prefix = 'L' + dateText + '-';
  let max = 0;
  (existingIds || []).forEach(function (id) {
    const s = String(id || '');
    if (s.indexOf(prefix) !== 0) return;
    const n = parseInt(s.slice(prefix.length), 10);
    if (n > max) max = n;
  });
  return prefix + ('00' + (max + 1)).slice(-2);
}

function isLoanOpen(loan) {
  return LOAN_OPEN_STATES.indexOf(loan['狀態']) !== -1;
}

/** 日期文字 yyyy-mm-dd（也接受 yyyy/mm/dd）轉成 yyyy-mm-dd；不合法回傳 ''。 */
function normalizeDate(text) {
  const m = String(text || '').trim().match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!m) return '';
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return m[1] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/**
 * 整理並檢查申請內容。input：{ 借用人姓名, 學號或職號, …, items: [物品ID] }；today：yyyy-mm-dd。
 * 回傳 { ok, errors: [訊息], data: 整理後的欄位（空白去掉、長度截斷、日期正規化）, items: 去重後的物品ID }。
 */
function validateLoanRequest(input, today) {
  const errors = [];
  const data = {};
  const src = input || {};
  LOAN_APPLICANT_FIELDS.forEach(function (f) {
    const v = String(src[f.name] === undefined || src[f.name] === null ? '' : src[f.name]).replace(/\s+/g, ' ').trim().slice(0, f.max);
    data[f.name] = v;
    if (f.required && !v) errors.push('請填寫' + f.name);
  });
  if (data['手機'] && !/^0\d{1,3}-?\d{6,8}$/.test(data['手機'].replace(/\s/g, ''))) errors.push('手機格式不正確（例：0912345678）');
  if (data['Email'] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data['Email'])) errors.push('Email 格式不正確');
  if (data['學號或職號'] && !/^[A-Za-z0-9]{3,20}$/.test(data['學號或職號'])) errors.push('學號或職號只能是英數字');
  const from = normalizeDate(data['預計借出日']);
  const to = normalizeDate(data['預計歸還日']);
  if (data['預計借出日'] && !from) errors.push('預計借出日格式不正確');
  if (data['預計歸還日'] && !to) errors.push('預計歸還日格式不正確');
  if (from && today && from < today) errors.push('預計借出日不能早於今天');
  if (from && to && to < from) errors.push('預計歸還日不能早於借出日');
  if (from && to && daysBetween(from, to) > LOAN_MAX_DAYS) errors.push('借用最多 ' + LOAN_MAX_DAYS + ' 天');
  data['預計借出日'] = from;
  data['預計歸還日'] = to;
  const items = [];
  (Array.isArray(src.items) ? src.items : []).forEach(function (id) {
    const s = String(id || '').trim().toUpperCase();
    if (/^I\d{6}$/.test(s) && items.indexOf(s) === -1) items.push(s);
  });
  if (!items.length) errors.push('請至少選一件物品');
  if (items.length > LOAN_MAX_ITEMS) errors.push('一張借用單最多 ' + LOAN_MAX_ITEMS + ' 件');
  return { ok: !errors.length, errors: errors, data: data, items: items };
}

/** 借用單（含明細）給訪客看的版本：只留申請人自己填的欄位與明細的公開欄位。 */
function loanForApplicant(loan, details) {
  const keep = ['借用單號', '狀態', '申請時間', '結案時間'].concat(LOAN_APPLICANT_FIELDS.map(function (f) { return f.name; }));
  const out = {};
  keep.forEach(function (k) { out[k] = loan[k] === undefined ? '' : loan[k]; });
  out.details = (details || []).map(function (d) {
    return { '明細編號': d['明細編號'], '系所編號': d['系所內部編號'], '名稱': d['名稱'], '規格': d['規格'] || '', '狀態': d['狀態'], '借出時間': d['借出時間'] || '', '歸還時間': d['歸還時間'] || '' };
  });
  return out;
}

/** 防濫用門檻：同一手機或 Email 一小時內最多幾張、全系統一小時最多幾張、表單最少要填幾秒、同一手機最多幾張申請中。 */
var LOAN_LIMITS = { perContactPerHour: 3, globalPerHour: 30, minFillSeconds: 5, openPerPhone: 3 };

/**
 * 防機器人檢查。meta：{ hp（隱藏欄位，人不會填）, elapsed（表單開啟到送出的秒數） }。
 * 回傳錯誤訊息或空字串；訊息不透露是哪一項。
 */
function botCheck(meta) {
  const m = meta || {};
  if (String(m.hp || '').trim()) return '無法送出，請重新整理後再試';
  const t = Number(m.elapsed);
  if (!isFinite(t) || t < LOAN_LIMITS.minFillSeconds) return '無法送出，請重新整理後再試';
  return '';
}

/**
 * 頻率檢查。counts：{ contact（同手機或 Email 近一小時張數，取大者）, global（近一小時全部張數）, openPhone（同手機申請中張數） }。
 */
function rateCheck(counts) {
  const c = counts || {};
  if ((c.global || 0) >= LOAN_LIMITS.globalPerHour) return '目前申請太多，請稍後再試或洽系辦';
  if ((c.contact || 0) >= LOAN_LIMITS.perContactPerHour) return '同一手機或 Email 一小時內最多送出 ' + LOAN_LIMITS.perContactPerHour + ' 張，請稍後再試';
  if ((c.openPhone || 0) >= LOAN_LIMITS.openPerPhone) return '您已有 ' + c.openPhone + ' 張申請中的借用單，請先到系辦借出或等候作廢';
  return '';
}

/** 申請中是否已逾期作廢：申請日（yyyy-MM-dd…）距今天（yyyy-mm-dd）超過 days 天。days 無效時不作廢。 */
function isApplicationExpired(loan, today, days) {
  const n = parseInt(days, 10);
  if (loan['狀態'] !== LOAN_APPLIED || !(n > 0)) return false;
  const applied = String(loan['申請時間'] || '').slice(0, 10);
  if (!normalizeDate(applied) || !normalizeDate(today)) return false;
  return daysBetween(applied, today) > n;
}

/** 申請中超過幾天（首頁提醒用）；不是申請中回傳 -1。 */
function applicationAgeDays(loan, today) {
  if (loan['狀態'] !== LOAN_APPLIED) return -1;
  const applied = String(loan['申請時間'] || '').slice(0, 10);
  return normalizeDate(applied) ? daysBetween(applied, today) : -1;
}

/**
 * 新申請通知對象：物品的經管人＋設定「借用通知信箱」（逗號、頓號或空白分隔）；都沒有時通知全部 Super。
 * 回傳去重、轉小寫的 Email 陣列。
 */
function loanNotifyRecipients(itemRows, settingText, superEmails) {
  const out = [];
  const add = function (e) {
    const v = String(e || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && out.indexOf(v) === -1) out.push(v);
  };
  (itemRows || []).forEach(function (r) { add(r['經管人']); });
  String(settingText || '').split(/[\s,，、;；]+/).forEach(add);
  if (!out.length) (superEmails || []).forEach(add);
  return out;
}

/** 新申請通知信：{ subject, body }（純文字）。不放學號、手機以外的個資到主旨。 */
function loanMailContent(loan, details, siteUrl) {
  const lines = [
    '有一張新的借用申請，請在借出前核對。', '',
    '借用單號：' + loan['借用單號'],
    '借用人：' + loan['借用人姓名'] + '（' + loan['學號或職號'] + '，' + loan['系所單位'] + '）',
    '手機：' + loan['手機'] + '　Email：' + loan['Email'],
    '用途：' + loan['用途'] + '　地點：' + loan['使用地點'],
    '預計期間：' + loan['預計借出日'] + ' ～ ' + loan['預計歸還日'], '',
    '物品（' + details.length + ' 件）：',
  ].concat(details.map(function (d) { return '・' + (d['系所內部編號'] || d['資產鍵']) + ' ' + d['名稱']; }));
  if (siteUrl) lines.push('', '系統：' + siteUrl);
  return { subject: '[借用申請] ' + loan['借用單號'] + ' ' + details.length + ' 件', body: lines.join('\n') };
}

var CHECKOUT_MIN_PHOTOS = 2;

/**
 * 借出前檢查。lines：[{ detailId, itemId（實際借出的物品ID；空白＝這件不借）, photoCount, verified }]；
 * details：這張單的申請明細。回傳錯誤訊息陣列（空＝可以借出）。
 */
function checkoutErrors(details, lines) {
  const errors = [];
  const byId = {};
  (lines || []).forEach(function (l) { byId[l.detailId] = l; });
  let lending = 0;
  const used = {};
  (details || []).forEach(function (d) {
    const l = byId[d['明細編號']];
    const label = d['系所內部編號'] || d['資產鍵'];
    if (!l) { errors.push(label + '：沒有處理'); return; }
    if (!l.itemId) return;
    lending++;
    if (used[l.itemId]) errors.push(label + '：同一件物品重複');
    used[l.itemId] = true;
    if (!l.verified) errors.push(label + '：尚未核對實物（掃 QR 或勾選）');
    if ((l.photoCount || 0) < CHECKOUT_MIN_PHOTOS) errors.push(label + '：借出照片至少 ' + CHECKOUT_MIN_PHOTOS + ' 張');
  });
  if (!lending) errors.push('至少要借出一件');
  return errors;
}

var RETURN_MIN_PHOTOS = 2;
/** 歸還狀況；損壞、缺件會自動登記異常案件（來源：借還）。 */
var RETURN_CONDITIONS = ['正常', '損壞', '缺件', '其他'];
var RETURN_CASE_TYPES = { '損壞': '損壞', '缺件': '數量短少' };

/**
 * 歸還檢查（可分批）。outDetails：這張單借出中的明細；lines：[{ detailId, verified, photoCount, condition, note }]。
 * 回傳錯誤訊息陣列。
 */
function returnErrors(outDetails, lines) {
  const errors = [];
  const byId = {};
  (outDetails || []).forEach(function (d) { byId[d['明細編號']] = d; });
  const seen = {};
  (lines || []).forEach(function (l) {
    const d = byId[l.detailId];
    if (!d) { errors.push((l.detailId || '？') + '：不在這張單的借出中物品（還錯件或已歸還）'); return; }
    const label = d['系所內部編號'] || d['資產鍵'];
    if (seen[l.detailId]) errors.push(label + '：重複');
    seen[l.detailId] = true;
    if (!l.verified) errors.push(label + '：尚未核對實物（掃 QR 或勾選）');
    if ((l.photoCount || 0) < RETURN_MIN_PHOTOS) errors.push(label + '：歸還照片至少 ' + RETURN_MIN_PHOTOS + ' 張');
    if (RETURN_CONDITIONS.indexOf(l.condition) === -1) errors.push(label + '：請選歸還狀況');
    if (l.condition && l.condition !== '正常' && !String(l.note || '').trim()) errors.push(label + '：狀況不是正常，請填說明');
  });
  if (!(lines || []).length) errors.push('請至少勾選一件歸還');
  return errors;
}

/** 歸還後物品狀態：還有處理中的異常案件→停借，否則在庫。 */
function statusAfterReturn(openCaseCount) {
  return (openCaseCount || 0) > 0 ? '停借' : '在庫';
}

/** 借出中且預計歸還日已過（今天還不算逾期）。 */
function isLoanOverdue(loan, today) {
  return loan['狀態'] === LOAN_OUT && !!normalizeDate(loan['預計歸還日']) && loan['預計歸還日'] < today;
}

/**
 * 首頁提醒：{ stale（申請中超過 remindDays 天，舊到新）, overdue（逾期未還，逾期最久的在前） }，每筆附 days。
 */
function loanReminders(loans, today, remindDays) {
  const n = parseInt(remindDays, 10);
  const limit = n > 0 ? n : 3;
  const stale = [];
  const overdue = [];
  (loans || []).forEach(function (l) {
    const age = applicationAgeDays(l, today);
    if (age > limit) stale.push({ loan: l, days: age });
    if (isLoanOverdue(l, today)) overdue.push({ loan: l, days: daysBetween(l['預計歸還日'], today) });
  });
  stale.sort(function (a, b) { return b.days - a.days; });
  overdue.sort(function (a, b) { return b.days - a.days; });
  return { stale: stale, overdue: overdue };
}

if (typeof module !== 'undefined') {
  module.exports = {
    isLoanOverdue, loanReminders,
    RETURN_MIN_PHOTOS, RETURN_CONDITIONS, RETURN_CASE_TYPES, returnErrors, statusAfterReturn,
    CHECKOUT_MIN_PHOTOS, checkoutErrors,
    loanNotifyRecipients, loanMailContent,
    LOAN_LIMITS, botCheck, rateCheck, isApplicationExpired, applicationAgeDays,
    LOAN_APPLIED, LOAN_OUT, LOAN_RETURNED, LOAN_VOID, LOAN_OPEN_STATES, DETAIL_APPLIED, DETAIL_OUT, DETAIL_RETURNED, DETAIL_VOID,
    LOAN_MAX_ITEMS, LOAN_MAX_DAYS, LOAN_APPLICANT_FIELDS, nextLoanId, isLoanOpen, normalizeDate, daysBetween, validateLoanRequest, loanForApplicant,
  };
}
