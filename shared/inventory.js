/**
 * 盤點規則（純邏輯，前後端共用）：批次編號、範圍說明、照片要求、結果、統計、清單篩選用的狀態。
 * 批次範圍用和資產清單相同的篩選物件（filterAssets 的 f），存成 JSON 在批次的「範圍」欄。
 */

if (typeof module !== 'undefined' && typeof ASSET_TYPES === 'undefined') {
  var ASSET_TYPES = require('./types.js').ASSET_TYPES;
}

var BATCH_ACTIVE = '進行中';
var BATCH_CLOSED = '已結束';

var INV_ONSITE = '現場';
var INV_SELF = '自行';
var RESULT_VALID = '有效';
var RESULT_REJECTED = '退回';

/** 可選的結果；第一個是正常。保管品多「數量不符」。 */
var INVENTORY_RESULTS = {
  FIXED: ['正常', '位置不符', '損壞', '找不到', '借用中'],
  ITEM: ['正常', '位置不符', '損壞', '找不到', '借用中'],
  CUSTODY: ['正常', '數量不符', '位置不符', '損壞', '找不到'],
};

/** 照片格：固定資產依學校盤點資料表三張；保管品、系所物品一張。 */
var INVENTORY_PHOTO_SLOTS = {
  FIXED: ['全貌', '編號貼紙', '廠牌型號'],
  CUSTODY: ['全貌'],
  ITEM: ['全貌'],
};

/** 盤點這件要拍的照片格；連結固定資產的系所物品視同盤點該固定資產，要三張。 */
function inventoryPhotoSlots(type, row) {
  if (type === 'ITEM' && row && String(row['資產編號'] || '')) return INVENTORY_PHOTO_SLOTS.FIXED;
  return INVENTORY_PHOTO_SLOTS[type];
}

/** 盤點清單用的篩選鍵（和 filterAssets 共用）；只有這些會存進批次範圍。 */
var SCOPE_FIELDS = ['部門代號', '保管人代號', '經管人', '位置'];

/** 只留範圍欄位、去空白。 */
function cleanScope(filters) {
  const out = {};
  SCOPE_FIELDS.forEach(function (k) {
    const v = String((filters || {})[k] || '').trim();
    if (v) out[k] = v;
  });
  return out;
}

/** 範圍的中文說明；managers：[{ email, name }] 用來把經管人 Email 換成姓名。 */
function scopeText(filters, managers) {
  const f = cleanScope(filters);
  const parts = [];
  if (f['部門代號']) parts.push('部門 ' + f['部門代號']);
  if (f['保管人代號']) parts.push('保管人 ' + f['保管人代號']);
  if (f['經管人']) {
    const m = (managers || []).find(function (x) { return x.email === String(f['經管人']).toLowerCase(); });
    parts.push('經管人 ' + (m && m.name ? m.name : f['經管人']));
  }
  if (f['位置']) parts.push('位置 ' + f['位置']);
  return parts.length ? parts.join('、') : '全部';
}

/** 下一個批次編號：B＋日期（yyyyMMdd）＋「-」＋兩位序號，同一天接續。 */
function nextBatchId(existingIds, dateText) {
  const prefix = 'B' + dateText + '-';
  let max = 0;
  (existingIds || []).forEach(function (id) {
    const s = String(id || '');
    if (s.indexOf(prefix) !== 0) return;
    const n = parseInt(s.slice(prefix.length), 10);
    if (n > max) max = n;
  });
  return prefix + ('00' + (max + 1)).slice(-2);
}

/** 批次是否進行中（截止日只是提醒，不自動結束）。 */
function isBatchActive(batch) {
  return !!batch && (batch['狀態'] || BATCH_ACTIVE) === BATCH_ACTIVE;
}

/**
 * 每件資產在某批次的最新一筆結果：{ 資產鍵: 結果列 }。
 * 同一件盤兩次以最後一次為準（依盤點時間，再依結果編號）。
 */
function latestResults(resultRows, batchId) {
  const out = {};
  (resultRows || []).forEach(function (r) {
    if (r['批次編號'] !== batchId) return;
    const cur = out[r['資產鍵']];
    if (!cur || String(r['盤點時間']) > String(cur['盤點時間']) ||
      (String(r['盤點時間']) === String(cur['盤點時間']) && String(r['結果編號']) > String(cur['結果編號']))) {
      out[r['資產鍵']] = r;
    }
  });
  return out;
}

/** 一件資產在本次批次的狀態：''（未盤）、已盤、退回。 */
function inventoryState(result) {
  if (!result) return '';
  return (result['狀態'] || RESULT_VALID) === RESULT_REJECTED ? '退回' : '已盤';
}

/** 結果是否異常（不是正常）；退回的不算。 */
function isAbnormal(result) {
  return !!result && inventoryState(result) === '已盤' && result['結果'] !== INVENTORY_RESULTS.FIXED[0];
}

/**
 * 清單篩選值 '已盤'、'未盤'、'自行'、'退回'、'異常' 對一件資產是否成立。
 * inScope：這件在批次範圍內（未盤只算範圍內的）。
 */
function matchInventoryFilter(value, result, inScope) {
  const st = inventoryState(result);
  if (value === '已盤') return st === '已盤';
  if (value === '未盤') return inScope && st !== '已盤';
  if (value === '自行') return st === '已盤' && result['方式'] === INV_SELF;
  if (value === '退回') return st === '退回';
  if (value === '異常') return isAbnormal(result);
  return true;
}

/**
 * 批次進度。scopeKeys：範圍內的資產鍵；results：latestResults()。
 * 回傳 { total, done, self, rejected, abnormal, missing（未盤的鍵）, extra（範圍外卻盤到的鍵） }。
 */
function batchStats(scopeKeys, results) {
  const scope = {};
  (scopeKeys || []).forEach(function (k) { scope[k] = true; });
  const s = { total: (scopeKeys || []).length, done: 0, self: 0, rejected: 0, abnormal: 0, missing: [], extra: [] };
  (scopeKeys || []).forEach(function (k) {
    const r = results[k];
    if (inventoryState(r) === '已盤') {
      s.done++;
      if (r['方式'] === INV_SELF) s.self++;
      if (isAbnormal(r)) s.abnormal++;
    } else {
      s.missing.push(k);
      if (inventoryState(r) === '退回') s.rejected++;
    }
  });
  Object.keys(results || {}).forEach(function (k) { if (!scope[k] && inventoryState(results[k]) === '已盤') s.extra.push(k); });
  return s;
}

/** 保管品：依實際數量建議結果；數量不是整數回傳 null。 */
function suggestCustodyResult(quantity, bookQuantity) {
  const q = String(quantity).trim();
  if (!/^\d+$/.test(q)) return null;
  const n = parseInt(q, 10);
  if (n === 0) return '找不到';
  return n === parseInt(bookQuantity, 10) ? '正常' : '數量不符';
}

/** 檢查盤點輸入；回傳錯誤訊息或空字串。photoCount：已上傳成功的照片數。 */
function validateInventoryInput(type, row, input) {
  const results = INVENTORY_RESULTS[type];
  if (results.indexOf(input.result) === -1) return '請選擇盤點結果';
  const need = inventoryPhotoSlots(type, row).length;
  if ((input.photoCount || 0) < need) return '需要 ' + need + ' 張照片，目前 ' + (input.photoCount || 0) + ' 張';
  if (type === 'CUSTODY' && !/^\d+$/.test(String(input.quantity === undefined ? '' : input.quantity).trim())) return '請填實際數量（整數）';
  return '';
}

if (typeof module !== 'undefined') {
  module.exports = {
    BATCH_ACTIVE, BATCH_CLOSED, INV_ONSITE, INV_SELF, RESULT_VALID, RESULT_REJECTED, INVENTORY_RESULTS, INVENTORY_PHOTO_SLOTS,
    SCOPE_FIELDS, inventoryPhotoSlots, cleanScope, scopeText, nextBatchId, isBatchActive, latestResults, inventoryState,
    isAbnormal, matchInventoryFilter, batchStats, suggestCustodyResult, validateInventoryInput,
  };
}
