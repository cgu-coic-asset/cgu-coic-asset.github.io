/**
 * 匯入差異比對（純邏輯，前後端共用）：把整理好的匯入資料和試算表現有資料比對。
 * - 新增：檔案有、系統沒有。
 * - 變更：兩邊都有，但檔案裡有的欄位內容不同；之前標「待確認」又出現的，也算變更（恢復正常）。
 * - 消失：系統有、檔案沒有 → 只標來源狀態「待確認」，不刪除、不報廢。
 *   只比對檔案涵蓋的部門代號，避免只匯入 D000 時把 D100 全部標成消失。
 * 前端用來預覽；後端寫入前重算一次，簽章不同就拒絕（期間資料被改過）。
 */

if (typeof module !== 'undefined' && typeof IMPORT_TEMPLATES === 'undefined') {
  var IMPORT_TEMPLATES = require('./importTemplate.js').IMPORT_TEMPLATES;
}

var SOURCE_OK = '正常';
var SOURCE_MISSING = '待確認';

/** 一筆資料的唯一鍵：固定資產為「資產編號#增值次數」，保管品為保管品鍵，系所物品為物品ID。 */
function importRowKey(type, row) {
  if (type === 'FIXED') return String(row['資產編號'] || '') + '#' + String(row['增值次數'] || '0');
  if (type === 'ITEM') return String(row['物品ID'] || '');
  return String(row['保管品鍵'] || '');
}

/**
 * records、fields：parseImportRows 的結果；existing：試算表現有的列（需有版本、來源狀態、部門代號）。
 * 回傳 { scope, added, changed, missing, unchanged }：
 *   added：要新增的資料（只含範本欄位）
 *   changed：[{ key, version, before, after }]，before／after 只放有變的欄位
 *   missing：[{ key, version, name }]
 */
function diffImport(type, records, fields, existing) {
  const compare = fields.filter(function (f) { return f !== '保管品鍵'; });
  const scope = [];
  records.forEach(function (r) {
    if (r['部門代號'] && scope.indexOf(r['部門代號']) === -1) scope.push(r['部門代號']);
  });
  scope.sort();

  const byKey = {};
  existing.forEach(function (row) { byKey[importRowKey(type, row)] = row; });

  const seen = {};
  const added = [];
  const changed = [];
  let unchanged = 0;
  records.forEach(function (rec) {
    const key = importRowKey(type, rec);
    seen[key] = true;
    const cur = byKey[key];
    if (!cur) {
      const row = {};
      IMPORT_TEMPLATES[type].columns.forEach(function (c) { row[c.name] = rec[c.name] === undefined ? '' : rec[c.name]; });
      if (type === 'CUSTODY') row['保管品鍵'] = rec['保管品鍵'];
      added.push(row);
      return;
    }
    const before = {};
    const after = {};
    compare.forEach(function (f) {
      const oldV = cur[f] === undefined || cur[f] === null ? '' : String(cur[f]);
      const newV = rec[f] === undefined || rec[f] === null ? '' : String(rec[f]);
      if (oldV !== newV) { before[f] = oldV; after[f] = newV; }
    });
    if (cur['來源狀態'] === SOURCE_MISSING) {
      before['來源狀態'] = SOURCE_MISSING;
      after['來源狀態'] = SOURCE_OK;
    }
    if (Object.keys(after).length) changed.push({ key: key, version: String(cur['版本'] || ''), before: before, after: after });
    else unchanged++;
  });

  const missing = [];
  existing.forEach(function (row) {
    const key = importRowKey(type, row);
    if (seen[key] || row['來源狀態'] === SOURCE_MISSING) return;
    if (scope.indexOf(String(row['部門代號'] || '')) === -1) return;
    missing.push({
      key: key, version: String(row['版本'] || ''),
      name: type === 'FIXED' ? row['資產名稱'] : row['品名規格'],
    });
  });

  return { scope: scope, added: added, changed: changed, missing: missing, unchanged: unchanged };
}

/**
 * 差異的簽章：前端預覽與後端重算一致才寫入。
 * 涵蓋每筆新增、變更（含版本與改後內容）、消失（含版本）。
 */
function diffSignature(diff) {
  const parts = [];
  diff.added.forEach(function (r) { parts.push('A' + JSON.stringify(r)); });
  diff.changed.forEach(function (c) { parts.push('C' + c.key + '@' + c.version + JSON.stringify(c.after)); });
  diff.missing.forEach(function (m) { parts.push('M' + m.key + '@' + m.version); });
  parts.sort();
  // FNV-1a 32 位元雜湊，前後端結果一致即可，不做安全用途
  let h = 0x811c9dc5;
  const text = parts.join('\n');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return parts.length + '-' + ('0000000' + h.toString(16)).slice(-8);
}

if (typeof module !== 'undefined') {
  module.exports = { SOURCE_OK, SOURCE_MISSING, importRowKey, diffImport, diffSignature };
}
