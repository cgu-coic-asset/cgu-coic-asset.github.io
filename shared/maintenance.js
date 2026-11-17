/**
 * 維運規則（純邏輯，前後端共用）：容量警示、備份保留、照片清理、個資遮蔽、LOG 封存、月度提醒信。
 * 照片清理與個資遮蔽無法復原：系統只列出候選，由 Super 在「系統」頁確認後才執行，排程不會自動做。
 */

if (typeof module !== 'undefined' && typeof LOAN_RETURNED === 'undefined') {
  var LOAN_RETURNED = require('./loan.js').LOAN_RETURNED;
  var LOAN_VOID = require('./loan.js').LOAN_VOID;
}

var BACKUP_KEEP = 12;
var PHOTO_CLEANED = '已清理';
/** 盤點照片至少保留天數（之後還要已過 NAS 確認日、且不是該件最近一次有效盤點的照片）。 */
var INVENTORY_PHOTO_KEEP_DAYS = 365;
/** NAS 確認日超過幾天沒更新就提醒。 */
var NAS_REMIND_DAYS = 35;

function dateOnly_(text) {
  const m = String(text || '').match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

/** yyyy-mm-dd 加減天數。 */
function addDays(dateText, days) {
  const d = dateOnly_(dateText);
  if (!d) return '';
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + days * 86400000);
  return t.toISOString().slice(0, 10);
}

/** yyyy-mm-dd 加減年（2/29 落到 2/28）。 */
function addYears(dateText, years) {
  const d = dateOnly_(dateText);
  if (!d) return '';
  const y = +d.slice(0, 4) + years;
  const md = d.slice(5) === '02-29' ? '02-28' : d.slice(5);
  return y + '-' + md;
}

/** 容量：{ pct（整數）, level（達到的最高門檻，未達為 0） }。thresholds：「70,85,95」。 */
function capacityLevel(used, limit, thresholds) {
  const list = String(thresholds || '70,85,95').split(/[,，\s]+/).map(Number).filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; });
  if (!(limit > 0)) return { pct: null, level: 0 };
  const pct = Math.round(used / limit * 100);
  let level = 0;
  list.forEach(function (t) { if (pct >= t) level = t; });
  return { pct: pct, level: level };
}

/** 備份檔保留最新 keep 份；names 為檔名（含日期，字典序＝時間序）。回傳要移到垃圾桶的檔名。 */
function backupsToRemove(names, keep) {
  return (names || []).slice().sort().reverse().slice(keep || BACKUP_KEEP);
}

/** 備份檔名：備份_yyyyMMdd-HHmm.zip。 */
function backupFileName(stamp) {
  return '備份_' + stamp + '.zip';
}

function isClosedLoan_(loan) {
  return !!loan && (loan['狀態'] === LOAN_RETURNED || loan['狀態'] === LOAN_VOID) && !!dateOnly_(loan['結案時間']);
}

/**
 * 可清理的照片與簽核單。
 * ctx：{ today, nasDate（NAS 確認日）, loanYears（借用照片保留年數）, photos（照片列）, results（盤點結果列）,
 *        details（借用明細列）, loans（借用單列） }。
 * 規則：建檔照片永久；一律要「上傳日早於 NAS 確認日」。
 *  - 盤點照片：上傳滿 365 天，且不是該件最近一次有效盤點的照片（盤點資料表遞補要用）。
 *  - 借出、歸還照片與簽核單：借用單已結案（已歸還／已作廢）滿 loanYears 年。
 * 回傳 { blocked（原因，沒有就空字串）, inventory: [照片列], loan: [照片列], scans: [{ loanId, fileId }] }。
 */
function cleanupCandidates(ctx) {
  const out = { blocked: '', inventory: [], loan: [], scans: [] };
  const nas = dateOnly_(ctx.nasDate);
  if (!nas) { out.blocked = '尚未設定 NAS 確認日：請先到 NAS 確認照片已同步，再按「NAS 已同步」'; return out; }
  const today = dateOnly_(ctx.today);
  const years = Math.max(1, parseInt(ctx.loanYears, 10) || 1);

  // 每件最近一次有效盤點用到的照片
  const latest = {};
  (ctx.results || []).forEach(function (r) {
    if ((r['狀態'] || '有效') === '退回') return;
    const k = r['類型'] + ':' + r['資產鍵'];
    const cur = latest[k];
    if (!cur || String(r['盤點時間']) > String(cur['盤點時間'])) latest[k] = r;
  });
  const keep = {};
  Object.keys(latest).forEach(function (k) {
    String(latest[k]['照片編號'] || '').split(',').forEach(function (id) { if (id) keep[id] = true; });
  });

  const loans = {};
  (ctx.loans || []).forEach(function (l) { loans[l['借用單號']] = l; });
  const loanOfDetail = {};
  (ctx.details || []).forEach(function (d) { loanOfDetail[d['明細編號']] = loans[d['借用單號']]; });
  const loanExpired = function (loan) {
    return isClosedLoan_(loan) && addYears(loan['結案時間'], years) <= today && dateOnly_(loan['結案時間']) < nas;
  };

  (ctx.photos || []).forEach(function (p) {
    if (p['狀態'] !== '有效') return;
    const up = dateOnly_(p['上傳時間']);
    if (!up || up >= nas) return;
    if (p['用途'] === '盤點') {
      if (!keep[p['照片編號']] && addDays(up, INVENTORY_PHOTO_KEEP_DAYS) <= today) out.inventory.push(p);
    } else if (p['用途'] === '借出' || p['用途'] === '歸還') {
      if (loanExpired(loanOfDetail[p['關聯編號']])) out.loan.push(p);
    }
  });
  (ctx.loans || []).forEach(function (l) {
    if (!loanExpired(l)) return;
    String(l['簽核單'] || '').split(',').filter(Boolean).forEach(function (id) { out.scans.push({ loanId: l['借用單號'], fileId: id }); });
  });
  return out;
}

/** 姓名：保留頭尾，中間改「○」（王小明 → 王○明，王明 → 王○）。 */
function maskName(name) {
  const c = Array.from(String(name || '').trim());
  if (!c.length) return '';
  if (c.length === 1) return '○';
  if (c.length === 2) return c[0] + '○';
  return c[0] + c.slice(1, -1).map(function () { return '○'; }).join('') + c[c.length - 1];
}

/** 手機：09xx-xxx-123（只留前兩碼與末三碼）。 */
function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length < 6) return 'x'.repeat(d.length);
  return d.slice(0, 2) + 'xx-xxx-' + d.slice(-3);
}

/** 學號或職號：留第一碼與末兩碼。 */
function maskIdNo(text) {
  const c = Array.from(String(text || '').trim());
  if (c.length <= 3) return c.map(function () { return '*'; }).join('');
  return c[0] + '*'.repeat(c.length - 3) + c.slice(-2).join('');
}

/** Email：留第一個字與網域。 */
function maskEmail(email) {
  const m = String(email || '').trim().match(/^(.)[^@]*(@.+)$/);
  return m ? m[1] + '***' + m[2] : (email ? '***' : '');
}

/** 借用單遮蔽後的欄位（指導教授、用途等不是借用人個資，保留）。 */
function maskedLoanFields(loan) {
  return {
    '借用人姓名': maskName(loan['借用人姓名']), '學號或職號': maskIdNo(loan['學號或職號']),
    '手機': maskPhone(loan['手機']), 'Email': maskEmail(loan['Email']), '已遮蔽': '是',
  };
}

/** 要遮蔽的借用單：已歸還或已作廢、結案滿 years 年、還沒遮蔽。借出中、申請中（未全部歸還）不遮蔽。 */
function loansToMask(loans, today, years) {
  const n = Math.max(1, parseInt(years, 10) || 2);
  return (loans || []).filter(function (l) {
    return isClosedLoan_(l) && l['已遮蔽'] !== '是' && addYears(l['結案時間'], n) <= dateOnly_(today);
  });
}

/** 要封存的 LOG 年份：今年以前、還沒封存的。 */
function logYearsToArchive(years, currentYear, archived) {
  return (years || []).filter(function (y) { return +y < +currentYear && (archived || []).indexOf(String(y)) === -1; }).sort();
}

/**
 * 月度提醒信內容。s：{ unit, today, url, backup: { ok, name, error }, nasDate, capacity: { pct, level, usedText },
 *   overdue: [{ id, name, due, days }], cleanup: { inventory, loan, scans, blocked }, mask, archivedLogs: [] }。
 */
function monthlyMailContent(s) {
  const lines = [];
  const warn = [];
  lines.push((s.unit || '資產管理系統') + ' 月度提醒（' + s.today + '）', '');
  lines.push('1. 備份：' + (s.backup && s.backup.ok ? '已產生 ' + s.backup.name : '失敗：' + ((s.backup && s.backup.error) || '未執行')));
  if (!(s.backup && s.backup.ok)) warn.push('備份失敗');
  const nas = dateOnly_(s.nasDate);
  const nasStale = !nas || addDays(nas, NAS_REMIND_DAYS) < dateOnly_(s.today);
  lines.push('2. NAS 確認日：' + (nas || '尚未確認') + (nasStale ? '（請到 NAS 確認同步後，在系統頁按「NAS 已同步」）' : ''));
  if (nasStale) warn.push('NAS 待確認');
  const cap = s.capacity || {};
  lines.push('3. 雲端容量：' + (cap.pct === null || cap.pct === undefined ? '無法取得' : cap.pct + '%' + (cap.usedText ? '（' + cap.usedText + '）' : '')) +
    (cap.level ? '，已達 ' + cap.level + '% 警示' : ''));
  if (cap.level) warn.push('容量 ' + cap.pct + '%');
  const od = s.overdue || [];
  lines.push('4. 逾期未還：' + (od.length ? od.length + ' 張' : '無'));
  od.slice(0, 20).forEach(function (o) { lines.push('   ' + o.id + ' ' + o.name + ' 應還 ' + o.due + '（逾期 ' + o.days + ' 天）'); });
  if (od.length > 20) lines.push('   …其餘請到系統查看');
  if (od.length) warn.push('逾期 ' + od.length);
  const c = s.cleanup || {};
  const nClean = (c.inventory || 0) + (c.loan || 0) + (c.scans || 0);
  lines.push('5. 可清理的雲端照片：' + (c.blocked ? c.blocked : nClean ? '盤點照片 ' + (c.inventory || 0) + '、借還照片 ' + (c.loan || 0) + '、簽核單 ' + (c.scans || 0) + '（到系統頁確認後清理）' : '無'));
  lines.push('6. 待遮蔽個資的借用單：' + (s.mask ? s.mask + ' 張（到系統頁確認後遮蔽）' : '無'));
  if ((s.archivedLogs || []).length) lines.push('7. 已封存 LOG：' + s.archivedLogs.join('、') + ' 年');
  lines.push('', '系統：' + (s.url || ''), '（這封信由系統每月 1 號自動寄出）');
  return {
    subject: '【資產系統】' + s.today.slice(0, 7) + ' 月度提醒' + (warn.length ? '：' + warn.join('、') : ''),
    body: lines.join('\n'),
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    BACKUP_KEEP, PHOTO_CLEANED, INVENTORY_PHOTO_KEEP_DAYS, NAS_REMIND_DAYS,
    addDays, addYears, capacityLevel, backupsToRemove, backupFileName, cleanupCandidates,
    maskName, maskPhone, maskIdNo, maskEmail, maskedLoanFields, loansToMask, logYearsToArchive, monthlyMailContent,
  };
}
