/**
 * 異常案件規則（純邏輯，前後端共用）。
 * Admin 登記（遺失、損壞、標籤不符等）→ 資產自動停借；Super 確認處理結果後結案，解除停借（報廢則改報廢）。
 */

var CASE_TYPES = ['遺失', '損壞', '標籤不符', '數量短少', '其他'];
var CASE_RESULTS = ['找到／確認無誤', '已修復', '報廢', '其他'];
var CASE_OPEN = '處理中';
var CASE_CLOSED = '已結案';
var CASE_SOURCES = ['盤點', '借還', '現場'];

/** 下一個案件編號：A＋日期（yyyyMMdd）＋「-」＋兩位序號。 */
function nextCaseId(existingIds, dateText) {
  const prefix = 'A' + dateText + '-';
  let max = 0;
  (existingIds || []).forEach(function (id) {
    const s = String(id || '');
    if (s.indexOf(prefix) !== 0) return;
    const n = parseInt(s.slice(prefix.length), 10);
    if (n > max) max = n;
  });
  return prefix + ('00' + (max + 1)).slice(-2);
}

function isCaseOpen(row) {
  return (row['狀態'] || CASE_OPEN) === CASE_OPEN;
}

/**
 * 登記異常後資產該變成的狀態：在庫→停借；借出保持借出（歸還時再處理）；已停借不變。
 * 回傳 null 表示不改；報廢的資產不能登記（呼叫端先擋）。
 */
function statusAfterCaseOpen(currentStatus) {
  const st = !currentStatus || currentStatus === '可借' ? '在庫' : currentStatus;
  return st === '在庫' ? '停借' : null;
}

/**
 * 結案後資產該變成的狀態：結果報廢→報廢；否則該件沒有其他處理中案件且目前停借→在庫。
 * 回傳 null 表示不改。
 */
function statusAfterCaseClose(result, currentStatus, otherOpenCount) {
  if (result === '報廢') return currentStatus === '報廢' ? null : '報廢';
  if ((otherOpenCount || 0) > 0) return null;
  return currentStatus === '停借' ? '在庫' : null;
}

/** 每件資產處理中的案件數：{ 類型:鍵: n }。 */
function openCaseCounts(caseRows) {
  const out = {};
  (caseRows || []).forEach(function (c) {
    if (!isCaseOpen(c)) return;
    const k = c['類型'] + ':' + c['資產鍵'];
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = {
    CASE_TYPES, CASE_RESULTS, CASE_OPEN, CASE_CLOSED, CASE_SOURCES, nextCaseId, isCaseOpen, statusAfterCaseOpen,
    statusAfterCaseClose, openCaseCounts,
  };
}
