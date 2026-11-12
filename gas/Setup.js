/**
 * 一鍵初始化：在 Apps Script 編輯器選 setup → 執行。
 * 建立（或沿用）資料夾、試算表、分頁與欄位，並把 ID 記到指令碼屬性。
 * 可重複執行：已存在的東西一律沿用，只補缺少的部分，不刪任何資料。
 */

/** 第一位一等管理者（用來登入系統的 Google 帳號，不是存放帳號）。只在管理者名單沒有一等時寫入。 */
const INITIAL_ADMIN_EMAIL = 'ericckfeng@gmail.com';

function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const report = [];

    const folders = { ROOT: ensureRootFolder_(props, report) };
    FOLDERS.forEach(function (f) {
      folders[f.key] = ensureChildFolder_(folders[f.parent], f.name, report);
    });
    Object.keys(folders).forEach(function (key) {
      props.setProperty('FOLDER_' + key, folders[key].getId());
    });

    const books = {};
    Object.keys(SCHEMA).forEach(function (key) {
      books[key] = ensureSpreadsheet_(props, 'SHEET_' + key, SCHEMA[key].name, folders.DATA, report);
      ensureSheets_(books[key], SCHEMA[key].sheets, report);
    });

    const logName = 'LOG_' + Utilities.formatDate(new Date(), TZ, 'yyyy');
    const logBook = ensureSpreadsheet_(props, 'SHEET_' + logName, logName, folders.DATA, report);
    ensureSheets_(logBook, { 'LOG': LOG_COLUMNS }, report);

    seedSettings_(books.SYSTEM.getSheetByName('設定'), report);
    seedFirstAdmin_(books.SYSTEM.getSheetByName('管理者'), report);

    appendRow_(logBook.getSheetByName('LOG'), {
      '時間': now_(),
      '操作者Email': Session.getEffectiveUser().getEmail(),
      '操作者姓名': '系統',
      '動作': '系統初始化',
      '對象類型': '系統',
      '改後': report.join('\n').slice(0, 45000),
      '來源': '系統',
    });

    Logger.log('初始化完成：\n' + report.join('\n'));
    return report;
  } finally {
    lock.releaseLock();
  }
}

/** 列出目前記錄的資料夾與試算表，確認 setup 結果用。 */
function showSetup() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).sort().forEach(function (k) {
    if (k.indexOf('FOLDER_') !== 0 && k.indexOf('SHEET_') !== 0) return;
    let name;
    try {
      name = DriveApp.getFileById(props[k]).getName();
    } catch (e) {
      try { name = DriveApp.getFolderById(props[k]).getName(); } catch (e2) { name = '（找不到）'; }
    }
    Logger.log(k + '：' + name + '（' + props[k] + '）');
  });
}

function ensureRootFolder_(props, report) {
  const id = props.getProperty('FOLDER_ROOT');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) { report.push('沿用 資料夾 ' + ROOT_FOLDER_NAME); return f; }
    } catch (e) { /* 被刪掉了，往下重找或重建 */ }
  }
  return ensureChildFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME, report);
}

function ensureChildFolder_(parent, name, report) {
  const it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) { report.push('沿用 資料夾 ' + name); return f; }
  }
  report.push('建立 資料夾 ' + name);
  return parent.createFolder(name);
}

function ensureSpreadsheet_(props, propKey, name, folder, report) {
  const id = props.getProperty(propKey);
  if (id) {
    try {
      if (!DriveApp.getFileById(id).isTrashed()) {
        report.push('沿用 試算表 ' + name);
        return SpreadsheetApp.openById(id);
      }
    } catch (e) { /* 被刪掉了，往下重找或重建 */ }
  }
  const it = folder.getFilesByName(name);
  while (it.hasNext()) {
    const file = it.next();
    if (!file.isTrashed() && file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      props.setProperty(propKey, file.getId());
      report.push('沿用 試算表 ' + name);
      return SpreadsheetApp.openById(file.getId());
    }
  }
  const ss = SpreadsheetApp.create(name);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  props.setProperty(propKey, ss.getId());
  report.push('建立 試算表 ' + name);
  return ss;
}

function ensureSheets_(ss, sheetDefs, report) {
  Object.keys(sheetDefs).forEach(function (title) {
    let sh = ss.getSheetByName(title);
    if (!sh) {
      sh = ss.insertSheet(title);
      report.push('建立 分頁 ' + ss.getName() + '／' + title);
    }
    ensureHeaders_(sh, sheetDefs[title], report);
  });
  // 刪掉新試算表附帶的空白預設分頁
  ss.getSheets().forEach(function (sh) {
    const n = sh.getName();
    if (!sheetDefs[n] && ss.getSheets().length > 1 && sh.getLastRow() === 0 && /^(工作表|Sheet)\s?1$/.test(n)) {
      ss.deleteSheet(sh);
    }
  });
}

function ensureHeaders_(sh, headers, report) {
  const lastCol = sh.getLastColumn();
  const existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    report.push((existing.length ? '補欄位 ' : '寫入欄位 ') + sh.getParent().getName() + '／' + sh.getName() + '：' + missing.join('、'));
  }
  const total = existing.length + missing.length;
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, total).setFontWeight('bold').setBackground('#eef2f7');
  // 全部存成純文字，避免資產編號開頭的 0 或日期被試算表自動轉換
  if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, total).setNumberFormat('@');
}

function seedSettings_(sh, report) {
  const have = {};
  readRows_(sh).forEach(function (r) { have[r['鍵']] = true; });
  DEFAULT_SETTINGS.forEach(function (d) {
    if (have[d[0]]) return;
    appendRow_(sh, { '鍵': d[0], '值': d[1], '說明': d[2], '修改時間': now_(), '修改者': '系統初始化' });
    report.push('預設設定 ' + d[0] + '＝' + d[1]);
  });
}

function seedFirstAdmin_(sh, report) {
  const hasTop = readRows_(sh).some(function (r) { return r['等級'] === '一等' && r['狀態'] === '啟用'; });
  if (hasTop) { report.push('沿用 一等管理者'); return; }
  appendRow_(sh, {
    'Email': INITIAL_ADMIN_EMAIL, '等級': '一等', '狀態': '啟用', '備註': '系統初始化建立',
    '版本': '1', '建立時間': now_(), '建立者': '系統初始化',
  });
  report.push('建立 一等管理者 ' + INITIAL_ADMIN_EMAIL);
}

/** 讀整張分頁為物件陣列（以標題列為鍵）。 */
function readRows_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).map(function (row) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

/** 依標題列把物件寫成新的一列（純文字格式）；沒給的欄位留空。 */
function appendRow_(sh, obj) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  // 先設成純文字再寫值，資產編號開頭的 0 才不會被吃掉
  sh.getRange(row, 1, 1, headers.length)
    .setNumberFormat('@')
    .setValues([headers.map(function (h) { return obj[h] === undefined ? '' : String(obj[h]); })]);
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}
