/**
 * 資產自主盤點資料表（純邏輯，前後端共用）：只用於固定資產，每件一頁，照學校範本。
 * 照片遞補：本次盤點 → 最近一次盤點 → 建檔；每張標示拍攝日與來源。遞補不會讓資產變成已盤。
 * 借用中、送修中且本次還沒盤的，標示「待補盤」。
 */

if (typeof module !== 'undefined' && typeof INVENTORY_PHOTO_SLOTS === 'undefined') {
  var INVENTORY_PHOTO_SLOTS = require('./inventory.js').INVENTORY_PHOTO_SLOTS;
  var RESULT_REJECTED = require('./inventory.js').RESULT_REJECTED;
}

var SC_SOURCE_CURRENT = '本次盤點';
var SC_SOURCE_PREVIOUS = '前次盤點';
var SC_SOURCE_BUILD = '建檔';

/** 篩選用的盤點狀態。 */
var SC_STATES = ['已盤', '未盤', '待補盤'];

/** 「2026-11-17 …」或「20261117」轉民國「115/11/17」；看不懂回傳空字串。 */
function rocDate(text) {
  const m = String(text || '').trim().match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if (!m) return '';
  const y = parseInt(m[1], 10) - 1911;
  return y > 0 ? y + '/' + m[2] + '/' + m[3] : '';
}

/** 照片標示用的日期「2025/11/03」：拍攝時間優先，沒有就用上傳時間。 */
function photoDateText(photo) {
  const m = String((photo && (photo['拍攝時間'] || photo['上傳時間'])) || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '/' + m[2] + '/' + m[3] : '';
}

function isValidResult_(r) {
  return !!r && (r['狀態'] || '有效') !== RESULT_REJECTED;
}

/** 依盤點時間新到舊（同時間依結果編號）。 */
function newestFirst_(a, b) {
  const ta = String(a['盤點時間']), tb = String(b['盤點時間']);
  if (ta !== tb) return ta < tb ? 1 : -1;
  return String(a['結果編號']) < String(b['結果編號']) ? 1 : -1;
}

/**
 * 一件資產的盤點資料表內容。
 * row：固定資產主紀錄；batchId：本次批次（可空）；results：這件的盤點結果列（任何批次）；
 * photos：這件的有效照片列（用途、拍攝時間、上傳時間）。
 * 回傳 { current（本次有效結果或 null）, state（已盤／未盤／待補盤）, pending（待補盤文字）, date（民國盤點日期）, photos: [{ slot, id, source, date, label }] }。
 */
function selfCheckEntry(row, batchId, results, photos) {
  const byId = {};
  (photos || []).forEach(function (p) { byId[p['照片編號']] = p; });
  const sorted = (results || []).slice().sort(newestFirst_);
  // 本次：本批次最新一筆，被退回就不算
  const latestThis = batchId ? sorted.find(function (r) { return r['批次編號'] === batchId; }) : null;
  const current = isValidResult_(latestThis) ? latestThis : null;
  const previous = sorted.filter(function (r) { return r['批次編號'] !== batchId && isValidResult_(r); });
  const build = (photos || []).filter(function (p) { return p['用途'] === '建檔'; })
    .sort(function (a, b) { return String(a['上傳時間']) < String(b['上傳時間']) ? 1 : -1; });

  const used = {};
  const pickFrom = function (result, i) {
    const id = String((result && result['照片編號']) || '').split(',')[i];
    return id && byId[id] && !used[id] ? byId[id] : null;
  };
  const out = INVENTORY_PHOTO_SLOTS.FIXED.map(function (slot, i) {
    let photo = pickFrom(current, i);
    let source = SC_SOURCE_CURRENT;
    if (!photo) {
      source = SC_SOURCE_PREVIOUS;
      for (let k = 0; k < previous.length && !photo; k++) photo = pickFrom(previous[k], i);
    }
    if (!photo) {
      source = SC_SOURCE_BUILD;
      photo = build.find(function (p) { return !used[p['照片編號']]; }) || null;
    }
    if (!photo) return { slot: slot, id: '', source: '', date: '', label: '' };
    used[photo['照片編號']] = true;
    const date = photoDateText(photo);
    return { slot: slot, id: photo['照片編號'], source: source, date: date, label: (date ? date + ' ' : '') + source };
  });

  const status = String(row['狀態'] || '');
  const away = status === '借出' ? '借用中' : status === '送修中' ? '送修中' : '';
  const state = current ? '已盤' : away ? '待補盤' : '未盤';
  return {
    current: current, state: state, pending: state === '待補盤' ? away + '，待補盤' : '',
    date: current ? rocDate(current['盤點時間']) : '', photos: out,
  };
}

/** 盤點資料表檔名用：自主盤點_{民國年}_{部門代號}_{批次編號}。 */
function selfCheckFileName(dateText, dept, batchId) {
  const y = rocDate(dateText).split('/')[0] || '';
  return ['自主盤點', y, dept || '全部', batchId || '未指定批次'].join('_');
}

if (typeof module !== 'undefined') {
  module.exports = {
    SC_SOURCE_CURRENT, SC_SOURCE_PREVIOUS, SC_SOURCE_BUILD, SC_STATES,
    rocDate, photoDateText, selfCheckEntry, selfCheckFileName,
  };
}
