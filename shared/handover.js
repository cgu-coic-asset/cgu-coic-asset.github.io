/**
 * 交接精靈（A 備援：在新帳號重建）的純邏輯，前後端共用：讀備份包、欄位對應、帳號與設定合併、照片重新連結、核對報告。
 * 流程見 docs/重建步驟.md 第 9 節。只能還原到空的系統（資產、物品、作業都沒有資料）。
 */

var HANDOVER_APP = '資產管理系統';
/** 有資料就不能還原的檔案（系統設定與 LOG 會合併）。 */
var HANDOVER_DATA_BOOKS = ['FIXED', 'CUSTODY', 'ITEM', 'OPS'];
var HANDOVER_PHOTO_SOURCE = '還原_照片';
var HANDOVER_LOAN_SOURCE = '還原_借用';

/** 檢查備份內容，回傳摘要 { time, version, rows, photos, books: [{ key, name, sheets: [{ title, rows }] }] }；格式不對丟錯。 */
function parseBackup(data) {
  if (!data || data.app !== HANDOVER_APP || !data.books || typeof data.books !== 'object') {
    throw new Error('這不是本系統的備份包（缺少 app 或 books）');
  }
  const books = Object.keys(data.books).sort().map(function (key) {
    const b = data.books[key] || {};
    const sheets = Object.keys(b.sheets || {}).map(function (title) {
      const v = b.sheets[title];
      if (!Array.isArray(v) || (v.length && !Array.isArray(v[0]))) throw new Error('備份內容損壞：' + key + '／' + title);
      return { title: title, rows: Math.max(0, v.length - 1) };
    });
    return { key: key, name: b.name || key, sheets: sheets };
  });
  if (!data.books.SYSTEM) throw new Error('備份缺少系統設定');
  return { time: data.time || '', version: data.version || '', rows: data.rows || 0, photos: data.photos || 0, books: books };
}

/** 還原前檢查：counts { 'FIXED/資產': 筆數, … } 裡資料檔有資料就擋下，回傳有資料的分頁清單。 */
function restoreBlockers(counts) {
  return Object.keys(counts || {}).filter(function (k) {
    return HANDOVER_DATA_BOOKS.indexOf(k.split('/')[0]) !== -1 && counts[k] > 0;
  }).sort();
}

/**
 * 備份的分頁值對應到目前的欄位：values 第一列是備份當時的標題。
 * 回傳 { headers（目前欄位＋備份才有的欄位）, rows（依 headers 排好，空白列去掉） }。
 */
function remapSheetValues(values, currentHeaders) {
  const src = (values && values[0] || []).map(String);
  const headers = (currentHeaders && currentHeaders.length ? currentHeaders.slice() : src.slice());
  src.forEach(function (h) { if (h && headers.indexOf(h) === -1) headers.push(h); });
  const idx = headers.map(function (h) { return src.indexOf(h); });
  const rows = (values || []).slice(1).filter(function (r) {
    return r.some(function (v) { return String(v == null ? '' : v) !== ''; });
  }).map(function (r) {
    return idx.map(function (i) { return i === -1 || r[i] == null ? '' : String(r[i]); });
  });
  return { headers: headers, rows: rows };
}

/** 帳號名單：確保執行還原的人是啟用中的 Super（避免還原後自己被鎖在外面）。rows 為物件。 */
function mergeAdminRows(rows, actorEmail, nowText) {
  const me = String(actorEmail || '').trim().toLowerCase();
  const out = (rows || []).map(function (r) { return Object.assign({}, r); });
  if (!me) return out;
  const mine = out.find(function (r) { return String(r['Email'] || '').trim().toLowerCase() === me; });
  if (mine) {
    mine['等級'] = 'Super';
    mine['狀態'] = '啟用';
    mine['停用時間'] = '';
    mine['停用者'] = '';
  } else {
    out.push({ 'Email': me, '等級': 'Super', '狀態': '啟用', '備註': '交接還原時加入', '建立時間': nowText || '', '建立者': me, '版本': '1' });
  }
  return out;
}

/** 設定：以備份為準，目前有、備份沒有的鍵（新版本加的設定）保留。 */
function mergeSettingRows(backupRows, currentRows) {
  const have = {};
  (backupRows || []).forEach(function (r) { have[r['鍵']] = true; });
  return (backupRows || []).map(function (r) { return Object.assign({}, r); })
    .concat((currentRows || []).filter(function (r) { return r['鍵'] && !have[r['鍵']]; }));
}

/** 照片紀錄要到「還原_照片」找的相對路徑：雲端路徑去掉開頭的「照片」，加檔名。只處理有效照片。 */
function photoRelinkPath(photo) {
  if (photo['狀態'] !== '有效') return null;
  const parts = String(photo['雲端路徑'] || '').split('/').filter(Boolean);
  if (parts[0] === '照片') parts.shift();
  if (!parts.length || !photo['檔名']) return null;
  return { folders: parts, name: String(photo['檔名']) };
}

/**
 * 核對報告的列（寫入「交接紀錄」）。r：{ date, oldSuper, newSuper, backupName, sheets: [{ name, expected, actual }],
 *   photos: { total, linked, missing }, scans: { loans, files } }。
 * 回傳 { ok, rows: [[日期, 舊一等, 新一等, 項目, 核對結果, 備註]] }。
 */
function handoverReportRows(r) {
  const rows = [];
  let ok = true;
  const add = function (item, pass, result, note) {
    if (!pass) ok = false;
    rows.push([r.date, r.oldSuper || '', r.newSuper || '', item, (pass ? '符合 ' : '不符 ') + result, note || '']);
  };
  (r.sheets || []).forEach(function (s) {
    add('資料 ' + s.name, s.expected === s.actual, '備份 ' + s.expected + '／還原 ' + s.actual, r.backupName || '');
  });
  if (r.photos) {
    add('照片', r.photos.missing.length === 0, '有效 ' + r.photos.total + '／已連結 ' + r.photos.linked,
      r.photos.missing.length ? '找不到：' + r.photos.missing.slice(0, 30).join('、') + (r.photos.missing.length > 30 ? '…' : '') : '');
  }
  if (r.scans) add('簽核單', true, r.scans.loans + ' 張借用單、' + r.scans.files + ' 個檔案', '');
  return { ok: ok, rows: rows };
}

if (typeof module !== 'undefined') {
  module.exports = {
    HANDOVER_APP, HANDOVER_DATA_BOOKS, HANDOVER_PHOTO_SOURCE, HANDOVER_LOAN_SOURCE,
    parseBackup, restoreBlockers, remapSheetValues, mergeAdminRows, mergeSettingRows, photoRelinkPath, handoverReportRows,
  };
}
