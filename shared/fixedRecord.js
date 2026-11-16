/**
 * 借用 B：固定資產借用與送修紀錄（純邏輯，前後端共用）。欄位依學校「儀器設備校內/校外借用記錄表」。
 * 事件開始：借用→借出、送修→送修中；結束（歸還）：回在庫（有處理中異常案件則停借），故障自動登記異常。
 */

var FR_EVENTS = ['借用', '送修'];
var FR_REASONS = ['上課', '實驗', '維修', '其他'];
var FR_PLACES = ['校內', '校外'];
var FR_CONDITIONS = ['正常', '故障'];
var FR_OPEN = '進行中';
var FR_CLOSED = '已歸還';
var FR_SOURCE_MANUAL = '手動';
var FR_SOURCE_LOAN_A = '系所物品借用';

/** 可修改的欄位（進行中時）。 */
var FR_EDITABLE = ['借用部門或廠商', '原因', '地點', '預計開始', '預計結束', '借用人', '經辦', '備註'];

function nextRecordId(existingIds, dateText) {
  const prefix = 'H' + dateText + '-';
  let max = 0;
  (existingIds || []).forEach(function (id) {
    const s = String(id || '');
    if (s.indexOf(prefix) !== 0) return;
    const n = parseInt(s.slice(prefix.length), 10);
    if (n > max) max = n;
  });
  return prefix + ('00' + (max + 1)).slice(-2);
}

/** 事件開始後資產狀態。 */
function statusForEvent(event) {
  return event === '送修' ? '送修中' : '借出';
}

function frDate_(text) {
  const m = String(text || '').trim().match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!m) return '';
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return m[1] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

/**
 * 檢查並整理新紀錄或修改。input 為欄位物件（含 事件）；isNew 時事件必填。
 * 回傳 { errors, data }。
 */
function validateFixedRecord(input, isNew) {
  const src = input || {};
  const data = {};
  const errors = [];
  const text = function (k, max) { return String(src[k] === undefined || src[k] === null ? '' : src[k]).replace(/\s+/g, ' ').trim().slice(0, max); };
  if (isNew) {
    data['事件'] = text('事件', 10);
    if (FR_EVENTS.indexOf(data['事件']) === -1) errors.push('請選事件：借用或送修');
  }
  data['借用部門或廠商'] = text('借用部門或廠商', 100);
  data['原因'] = text('原因', 10);
  data['地點'] = text('地點', 10);
  data['預計開始'] = frDate_(src['預計開始']);
  data['預計結束'] = frDate_(src['預計結束']);
  data['借用人'] = text('借用人', 50);
  data['經辦'] = text('經辦', 50);
  data['備註'] = text('備註', 300);
  if (!data['借用部門或廠商']) errors.push(data['事件'] === '送修' ? '請填維修廠商' : '請填借用部門');
  if (FR_REASONS.indexOf(data['原因']) === -1) errors.push('請選原因');
  if (FR_PLACES.indexOf(data['地點']) === -1) errors.push('請選地點：校內或校外');
  if (!data['預計開始']) errors.push('請填預計開始日');
  if (data['預計結束'] && data['預計開始'] && data['預計結束'] < data['預計開始']) errors.push('預計結束不能早於開始');
  if (!data['借用人']) errors.push(data['事件'] === '送修' ? '請填送修聯絡人' : '請填借用人');
  if (!data['經辦']) errors.push('請填經辦');
  return { errors: errors, data: data };
}

/** 歸還檢查。input：{ 歸還日期, 歸還經辦, 歸還狀況, 歸還說明 }。 */
function validateFixedReturn(input, startDate) {
  const src = input || {};
  const data = {
    '歸還日期': frDate_(src['歸還日期']),
    '歸還經辦': String(src['歸還經辦'] || '').trim().slice(0, 50),
    '歸還狀況': String(src['歸還狀況'] || '').trim(),
    '歸還說明': String(src['歸還說明'] || '').replace(/\s+/g, ' ').trim().slice(0, 300),
  };
  const errors = [];
  if (!data['歸還日期']) errors.push('請填歸還日期');
  if (data['歸還日期'] && startDate && data['歸還日期'] < startDate) errors.push('歸還日期不能早於開始日');
  if (!data['歸還經辦']) errors.push('請填歸還經辦');
  if (FR_CONDITIONS.indexOf(data['歸還狀況']) === -1) errors.push('請選狀況：正常或故障');
  if (data['歸還狀況'] === '故障' && !data['歸還說明']) errors.push('故障請填說明');
  return { errors: errors, data: data };
}

/** User 只能處理自己名下（保管人代號）的固定資產；Admin、Super 全部。 */
function canEditFixedRecord(role, codes, assetRow) {
  if (role === 'Admin' || role === 'Super') return true;
  if (role !== 'User') return false;
  const code = String((assetRow || {})['保管人代號'] || '').toUpperCase();
  return !!code && (codes || []).indexOf(code) !== -1;
}

if (typeof module !== 'undefined') {
  module.exports = {
    FR_EVENTS, FR_REASONS, FR_PLACES, FR_CONDITIONS, FR_OPEN, FR_CLOSED, FR_SOURCE_MANUAL, FR_SOURCE_LOAN_A, FR_EDITABLE,
    nextRecordId, statusForEvent, validateFixedRecord, validateFixedReturn, canEditFixedRecord,
  };
}
