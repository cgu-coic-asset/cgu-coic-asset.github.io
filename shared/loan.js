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

if (typeof module !== 'undefined') {
  module.exports = {
    LOAN_LIMITS, botCheck, rateCheck, isApplicationExpired, applicationAgeDays,
    LOAN_APPLIED, LOAN_OUT, LOAN_RETURNED, LOAN_VOID, LOAN_OPEN_STATES, DETAIL_APPLIED, DETAIL_OUT, DETAIL_RETURNED, DETAIL_VOID,
    LOAN_MAX_ITEMS, LOAN_MAX_DAYS, LOAN_APPLICANT_FIELDS, nextLoanId, isLoanOpen, normalizeDate, daysBetween, validateLoanRequest, loanForApplicant,
  };
}
