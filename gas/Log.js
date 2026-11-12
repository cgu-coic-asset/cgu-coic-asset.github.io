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
  const text = function (v) {
    if (v === undefined || v === null || v === '') return '';
    return (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 45000);
  };
  appendRow_(logSheet_(), {
    '時間': now_(),
    '操作者Email': actor.email || '',
    '操作者姓名': actor.name || '',
    '動作': action,
    '對象類型': objectType,
    '對象鍵': objectKey || '',
    '改前': text(before),
    '改後': text(after),
    '原因': reason || '',
    '來源': source || '網頁',
  });
}
