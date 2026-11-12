/**
 * 試算表讀寫工具。所有值一律以純文字存放（資產編號開頭的 0 不會被吃掉）。
 */

function book_(key) {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_' + key);
  if (!id) throw new AppError('NOT_CONFIGURED', '尚未執行 setup()：找不到 ' + key);
  return SpreadsheetApp.openById(id);
}

function sheet_(bookKey, name) {
  const sh = book_(bookKey).getSheetByName(name);
  if (!sh) throw new AppError('NOT_CONFIGURED', '找不到分頁 ' + name + '，請重新執行 setup()');
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

/** 讀整張分頁為物件陣列（以標題列為鍵）；每筆附 _row（試算表列號）。 */
function readRows_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).map(function (row, i) {
    const o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = row[j] === null ? '' : String(row[j]); });
    return o;
  });
}

/** 找第一筆 field 等於 value 的資料列；找不到回傳 null。 */
function findRow_(sh, field, value, normalize) {
  const norm = normalize || function (v) { return String(v); };
  const target = norm(value);
  const rows = readRows_(sh);
  for (let i = 0; i < rows.length; i++) {
    if (norm(rows[i][field]) === target) return rows[i];
  }
  return null;
}

/** 依標題列把物件寫回指定列。 */
function writeRow_(sh, rowNumber, obj) {
  const headers = headers_(sh);
  sh.getRange(rowNumber, 1, 1, headers.length)
    .setNumberFormat('@')
    .setValues([headers.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : String(obj[h]); })]);
}

/** 依標題列把物件寫成新的一列；沒給的欄位留空。回傳列號。 */
function appendRow_(sh, obj) {
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  writeRow_(sh, row, obj);
  return row;
}

/** 去掉內部欄位（_row）後回傳給前端。 */
function publicRow_(row) {
  const o = Object.assign({}, row);
  delete o._row;
  return o;
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}
