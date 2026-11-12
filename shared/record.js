/**
 * 資料列的版本比對、修改合併與 LOG 差異（純邏輯，前後端共用）。
 */

/** 系統管理的欄位，前端送來的修改不得覆寫。 */
var SYSTEM_FIELDS = ['版本', '建立時間', '建立者', '修改時間', '修改者'];

/**
 * 檢查前端拿到的版本是否仍是最新。
 * 回傳 null 表示可以修改；否則回傳衝突資訊。
 */
function checkVersion(currentRow, expectedVersion) {
  const current = String(currentRow['版本'] || '0');
  if (expectedVersion === undefined || expectedVersion === null || String(expectedVersion) !== current) {
    return { currentVersion: current, expectedVersion: expectedVersion === undefined ? null : String(expectedVersion) };
  }
  return null;
}

function nextVersion(v) {
  const n = parseInt(v, 10);
  return String((isNaN(n) ? 0 : n) + 1);
}

/**
 * 把修改套到資料列上，回傳新的列與實際改變的欄位。
 * 只接受 allowedFields 裡的欄位；值一律轉成字串；沒有變化的欄位不算。
 */
function applyChanges(currentRow, changes, allowedFields, actorEmail, nowText) {
  const next = Object.assign({}, currentRow);
  const before = {};
  const after = {};
  Object.keys(changes || {}).forEach(function (field) {
    if (allowedFields.indexOf(field) === -1 || SYSTEM_FIELDS.indexOf(field) !== -1) return;
    const value = changes[field] === null || changes[field] === undefined ? '' : String(changes[field]);
    const old = currentRow[field] === null || currentRow[field] === undefined ? '' : String(currentRow[field]);
    if (value === old) return;
    before[field] = old;
    after[field] = value;
    next[field] = value;
  });
  const changed = Object.keys(after).length > 0;
  if (changed) {
    next['版本'] = nextVersion(currentRow['版本']);
    next['修改時間'] = nowText;
    next['修改者'] = actorEmail;
  }
  return { row: next, changed: changed, before: before, after: after };
}

/** 新建資料列時補上系統欄位。 */
function stampNew(row, actorEmail, nowText) {
  return Object.assign({}, row, { '版本': '1', '建立時間': nowText, '建立者': actorEmail, '修改時間': '', '修改者': '' });
}

if (typeof module !== 'undefined') {
  module.exports = { SYSTEM_FIELDS, checkVersion, nextVersion, applyChanges, stampNew };
}
