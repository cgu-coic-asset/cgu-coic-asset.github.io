/**
 * 照片規則（純邏輯，前後端共用）：用途、資料夾、檔名、拍攝時間、統計。
 * 資料夾：照片/<固定資產|保管品>/<資產編號或保管品鍵>/，檔名「用途_日期_序號.jpg」。
 * 換帳號時靠路徑重新對應，不依賴雲端硬碟的檔案 ID（檔案ID 欄只是加速用）。
 */

if (typeof module !== 'undefined' && typeof ASSET_TYPES === 'undefined') {
  var ASSET_TYPES = require('./types.js').ASSET_TYPES;
}

/** 照片用途。建檔：設備最初的樣子；盤點、借出、歸還由各流程使用。 */
var PHOTO_PURPOSES = ['建檔', '盤點', '借出', '歸還'];
var PHOTO_MAX_BYTES = 2 * 1024 * 1024;
var PHOTO_ACTIVE = '有效';
var PHOTO_VOID = '作廢';

/** 照片歸屬的鍵：固定資產用資產編號（增值紀錄共用），保管品用保管品鍵，系所物品用物品ID。 */
function photoAssetKey(type, row) {
  return String(row[ASSET_TYPES[type].keyField] || '');
}

/** 雲端路徑（資料夾名稱陣列，從「照片」下一層開始）。 */
function photoFolderPath(type, key) {
  return [ASSET_TYPES[type].photoFolder, String(key)];
}

/** 下一個序號：同一資產、同用途、同日期已有的最大序號＋1。names：該資產已有的檔名。 */
function nextPhotoSeq(names, purpose, date) {
  const prefix = purpose + '_' + date + '_';
  let max = 0;
  (names || []).forEach(function (n) {
    const s = String(n);
    if (s.indexOf(prefix) !== 0) return;
    const seq = parseInt(s.slice(prefix.length), 10);
    if (seq > max) max = seq;
  });
  return max + 1;
}

function photoFileName(purpose, date, seq) {
  return purpose + '_' + date + '_' + seq + '.jpg';
}

/** EXIF 時間「2023:09:19 14:03:22」轉成「2023-09-19 14:03:22」；看不懂回傳空字串。 */
function normalizeExifDate(text) {
  const m = String(text || '').trim().match(/^(\d{4})[:\-\/](\d{2})[:\-\/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m || m[1] === '0000') return '';
  return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
}

/** 每件資產各用途的有效照片數：{ 鍵: { 建檔: 2, 盤點: 3 } }。 */
function photoCounts(photoRows) {
  const out = {};
  (photoRows || []).forEach(function (p) {
    if (p['狀態'] && p['狀態'] !== PHOTO_ACTIVE) return;
    const key = p['類型'] + ':' + p['資產鍵'];
    out[key] = out[key] || {};
    out[key][p['用途']] = (out[key][p['用途']] || 0) + 1;
  });
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = {
    PHOTO_PURPOSES, PHOTO_MAX_BYTES, PHOTO_ACTIVE, PHOTO_VOID, photoAssetKey, photoFolderPath, nextPhotoSeq,
    photoFileName, normalizeExifDate, photoCounts,
  };
}
