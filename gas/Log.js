/**
 * 操作紀錄（LOG）：只新增、不修改。每年一個試算表，跨年時自動建立。
 */

function logSheet_() {
  const year = Utilities.formatDate(new Date(), TZ, 'yyyy');
  const name = 'LOG_' + year;
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_' + name)) {
    const dataFolderId = props.getProperty('FOLDER_DATA');
    if (!dataFolderId) throw new AppError('NOT_CONFIGURED', '尚未執行 setup()');
    const ss = ensureSpreadsheet_(props, 'SHEET_' + name, name, DriveApp.getFolderById(dataFolderId), []);
    ensureSheets_(ss, { 'LOG': LOG_COLUMNS }, []);
  }
  return sheet_(name, 'LOG');
}

/**
 * 寫一筆 LOG。before／after 可以是物件（只放有變的欄位）或字串。
 * source：網頁、排程、系統。
 */
function writeLog_(actor, action, objectType, objectKey, before, after, reason, source) {
  writeLogs_(actor, [{ action: action, objectType: objectType, key: objectKey, before: before, after: after }],
    reason, source);
}

/** 一次寫多筆 LOG（匯入等大量變更用）。entries：[{ action, objectType, key, before, after }]。 */
function writeLogs_(actor, entries, reason, source) {
  if (!entries.length) return;
  const text = function (v) {
    if (v === undefined || v === null || v === '') return '';
    return (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 45000);
  };
  const time = now_();
  const rows = entries.map(function (e) {
    const o = {
      '時間': time, '操作者Email': actor.email || '', '操作者姓名': actor.name || '', '動作': e.action,
      '對象類型': e.objectType, '對象鍵': e.key || '', '改前': text(e.before), '改後': text(e.after),
      '原因': reason || '', '來源': source || '網頁',
    };
    return LOG_COLUMNS.map(function (h) { return o[h]; });
  });
  const sh = logSheet_();
  const start = sh.getLastRow() + 1;
  const needed = start + rows.length - 1;
  if (sh.getMaxRows() < needed) sh.insertRowsAfter(sh.getMaxRows(), needed - sh.getMaxRows() + 100);
  sh.getRange(start, 1, rows.length, LOG_COLUMNS.length).setNumberFormat('@').setValues(rows);
}
