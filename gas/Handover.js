/**
 * 交接精靈（M4-07，Super）。規則見 shared/handover.js，步驟見 docs/重建步驟.md 第 9 節。
 * B（同帳號交接）：下載最新備份帶走。A（新帳號重建）：備份包放進「備份」資料夾 → 還原資料 → NAS 照片放進「還原_照片」「還原_借用」→ 重新連結 → 核對報告。
 */

function rootFolder_() {
  return folderByKey_('ROOT');
}

function childFolderByName_(parent, name) {
  const it = parent.getFoldersByName(name);
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}

/** 「備份」資料夾裡的備份包（新到舊）。 */
function backupFiles_() {
  const it = folderByKey_('BACKUPS').getFiles();
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed() && /^備份_\d{8}-\d{4}\.zip$/.test(f.getName())) out.push(f);
  }
  return out.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
}

function readBackup_(fileId) {
  const f = backupFiles_().find(function (x) { return x.getId() === fileId; });
  if (!f) throw new AppError('NOT_FOUND', '「備份」資料夾裡找不到這個備份包');
  let json = null;
  try {
    const blob = Utilities.unzip(f.getBlob()).find(function (b) { return b.getName() === 'data.json'; });
    json = blob ? JSON.parse(blob.getDataAsString('UTF-8')) : null;
  } catch (e) { json = null; }
  if (!json) throw new AppError('BAD_REQUEST', '備份包打不開或缺少 data.json');
  let summary;
  try { summary = parseBackup(json); } catch (e) { throw new AppError('BAD_REQUEST', e.message); }
  return { file: f, data: json, summary: summary };
}

/** 目前各資料分頁筆數（還原前檢查用）。 */
function currentCounts_() {
  const out = {};
  HANDOVER_DATA_BOOKS.forEach(function (key) {
    if (!PropertiesService.getScriptProperties().getProperty('SHEET_' + key)) return;
    book_(key).getSheets().forEach(function (sh) { out[key + '/' + sh.getName()] = Math.max(0, sh.getLastRow() - 1); });
  });
  return out;
}

/** 交接頁資料：備份包清單、目前能不能還原、還原來源資料夾在不在。 */
function handoverStatus_() {
  const root = rootFolder_();
  return {
    backups: backupFiles_().slice(0, 30).map(function (f) { return { id: f.getId(), name: f.getName(), size: f.getSize() }; }),
    blockers: restoreBlockers(currentCounts_()),
    sources: { photos: !!childFolderByName_(root, HANDOVER_PHOTO_SOURCE), loans: !!childFolderByName_(root, HANDOVER_LOAN_SOURCE) },
    records: readRows_(sheet_('SYSTEM', '交接紀錄')).map(publicRow_).reverse().slice(0, 40),
  };
}

/** 預覽備份包：摘要＋是否能還原。payload：{ fileId }。 */
function handoverPreview_(payload) {
  const b = readBackup_(payload.fileId);
  return { name: b.file.getName(), summary: b.summary, blockers: restoreBlockers(currentCounts_()) };
}

/** 把一個分頁整個換成 headers＋rows（全部文字格式）。 */
function replaceSheet_(sh, headers, rows) {
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), headers.length)).clearContent();
  if (!rows.length) return;
  if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, rows.length, headers.length).setNumberFormat('@').setValues(rows);
}

function toObjects_(headers, rows) {
  return rows.map(function (r) { const o = {}; headers.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}

function toValues_(headers, objs) {
  return objs.map(function (o) { return headers.map(function (h) { return o[h] == null ? '' : String(o[h]); }); });
}

/**
 * 還原資料（只能在空系統）。payload：{ fileId, confirm: '還原' }。
 * 系統設定：帳號名單保留自己為 Super、設定以備份為準並保留新鍵；LOG：備份內容在前、這個帳號重建後的紀錄接在後面。
 */
function handoverRestore_(payload, actor) {
  if (payload.confirm !== '還原') throw new AppError('BAD_REQUEST', '請輸入「還原」確認');
  const b = readBackup_(payload.fileId);
  const blockers = restoreBlockers(currentCounts_());
  if (blockers.length) throw new AppError('BAD_REQUEST', '這個系統已經有資料，不能還原：' + blockers.join('、'));
  const props = PropertiesService.getScriptProperties();
  const dataFolder = folderByKey_('DATA');
  const sheets = [];
  Object.keys(b.data.books).forEach(function (key) {
    const isLog = /^LOG_\d{4}$/.test(key);
    if (!SCHEMA[key] && !isLog) return;
    const ss = isLog ? ensureSpreadsheet_(props, 'SHEET_' + key, key, dataFolder, []) : book_(key);
    if (isLog) ensureSheets_(ss, { 'LOG': LOG_COLUMNS }, []);
    const src = b.data.books[key].sheets || {};
    Object.keys(src).forEach(function (title) {
      const sh = ss.getSheetByName(title) || ss.insertSheet(title);
      const current = sh.getLastColumn() ? headers_(sh) : [];
      const m = remapSheetValues(src[title], current);
      let rows = m.rows;
      const expected = rows.length;
      if (key === 'SYSTEM' && title === '管理者') {
        rows = toValues_(m.headers, mergeAdminRows(toObjects_(m.headers, rows), actor.email, now_()));
      } else if (key === 'SYSTEM' && title === '設定') {
        rows = toValues_(m.headers, mergeSettingRows(toObjects_(m.headers, rows), readRows_(sh)));
      } else if (isLog) {
        rows = rows.concat(toValues_(m.headers, readRows_(sh)));
      }
      replaceSheet_(sh, m.headers, rows);
      sheets.push({ name: (SCHEMA[key] ? SCHEMA[key].name : key) + '／' + title, expected: expected, actual: Math.max(0, sh.getLastRow() - 1) - (rows.length - expected) });
    });
  });
  CacheService.getScriptCache().remove(ADMIN_CACHE_KEY);
  const report = handoverReportRows({ date: todayText_(), newSuper: actor.email, backupName: b.file.getName(), sheets: sheets });
  const rsh = sheet_('SYSTEM', '交接紀錄');
  report.rows.forEach(function (r) { appendRow_(rsh, { '日期': r[0], '舊一等': r[1], '新一等': r[2], '項目': r[3], '核對結果': r[4], '備註': r[5] }); });
  writeLog_(actor, '交接還原資料', '系統', b.file.getName(), '', { 分頁: sheets.length, 符合: report.ok, 備份時間: b.summary.time });
  return { ok: report.ok, sheets: sheets, backup: b.summary };
}

/** 依路徑在 root 底下找檔案；找不到回傳 null。 */
function fileByPath_(root, folders, name) {
  let f = root;
  for (let i = 0; i < folders.length && f; i++) f = childFolderByName_(f, folders[i]);
  if (!f) return null;
  const it = f.getFilesByName(name);
  while (it.hasNext()) { const x = it.next(); if (!x.isTrashed()) return x; }
  return null;
}

function fileUsable_(id) {
  try { const f = DriveApp.getFileById(id); return !f.isTrashed(); } catch (e) { return false; }
}

/**
 * 重新連結照片與簽核單（可重複按，直到 remaining 為 0）：照片依「雲端路徑／檔名」從「還原_照片」搬到正確資料夾並更新檔案ID；
 * 簽核單依借用單號從「還原_借用/<單號>」搬到「借用/<單號>」。每次最多跑 4 分半。
 */
function handoverRelink_(payload, actor) {
  const started = Date.now();
  const budget = 270000;
  const root = rootFolder_();
  const photoSrc = childFolderByName_(root, HANDOVER_PHOTO_SOURCE);
  const loanSrc = childFolderByName_(root, HANDOVER_LOAN_SOURCE);
  if (!photoSrc && !loanSrc) throw new AppError('BAD_REQUEST', '找不到「' + HANDOVER_PHOTO_SOURCE + '」或「' + HANDOVER_LOAN_SOURCE + '」資料夾：請把 NAS 的照片、借用資料夾上傳到「資產管理系統」並改成這兩個名稱');

  const sh = photoSheet_();
  const photos = readRows_(sh);
  const nowText = now_();
  let linked = 0, total = 0, changed = false, timedOut = false;
  const missing = [];
  photos.forEach(function (p) {
    const path = photoRelinkPath(p);
    if (!path) return;
    total++;
    if (timedOut || Date.now() - started > budget) { timedOut = true; return; }
    if (p['檔案ID'] && fileUsable_(p['檔案ID'])) { linked++; return; }
    const f = photoSrc ? fileByPath_(photoSrc, path.folders, path.name) : null;
    if (!f) { missing.push(p['照片編號']); return; }
    f.moveTo(assetPhotoFolder_(p['類型'], p['資產鍵'], true));
    Object.assign(p, applyChanges(p, { '檔案ID': f.getId() }, ['檔案ID'], actor.email, nowText).row);
    linked++;
    changed = true;
  });
  if (changed) writeAllRows_(sh, photos, []);

  let scanLoans = 0, scanFiles = 0;
  if (loanSrc && !timedOut) {
    const lsh = loanSheet_();
    const loans = readRows_(lsh);
    const target = folderByKey_('LOANS');
    let lchanged = false;
    loans.forEach(function (l) {
      if (timedOut || Date.now() - started > budget) { timedOut = true; return; }
      const ids = String(l['簽核單'] || '').split(',').filter(Boolean);
      if (!ids.length || ids.every(fileUsable_)) return;
      const src = childFolderByName_(loanSrc, l['借用單號']);
      if (!src) return;
      const dest = ensureChildFolder_(target, l['借用單號'], []);
      const files = [];
      const it = src.getFiles();
      while (it.hasNext()) { const f = it.next(); if (!f.isTrashed() && /^簽核單_/.test(f.getName())) files.push(f); }
      if (!files.length) return;
      files.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
      files.forEach(function (f) { f.moveTo(dest); });
      Object.assign(l, applyChanges(l, { '簽核單': files.map(function (f) { return f.getId(); }).join(',') }, ['簽核單'], actor.email, nowText).row);
      scanLoans++;
      scanFiles += files.length;
      lchanged = true;
    });
    if (lchanged) writeAllRows_(lsh, loans, []);
  }

  const remaining = timedOut ? total - linked - missing.length : 0;
  const result = { total: total, linked: linked, missing: missing, remaining: remaining, scans: { loans: scanLoans, files: scanFiles } };
  writeLog_(actor, '交接連結照片', '系統', '', '', { 有效照片: total, 已連結: linked, 找不到: missing.length, 未處理: remaining, 簽核單: scanFiles });
  if (!remaining) {
    const report = handoverReportRows({ date: todayText_(), newSuper: actor.email, photos: { total: total, linked: linked, missing: missing }, scans: result.scans });
    const rsh = sheet_('SYSTEM', '交接紀錄');
    report.rows.forEach(function (r) { appendRow_(rsh, { '日期': r[0], '舊一等': r[1], '新一等': r[2], '項目': r[3], '核對結果': r[4], '備註': r[5] }); });
    result.ok = report.ok;
  }
  return result;
}

/** 下載備份包（B 交接時帶走、或 A 重建前先存一份）。payload：{ fileId（空白＝最新） }。 */
function handoverDownload_(payload) {
  const files = backupFiles_();
  const f = payload.fileId ? files.find(function (x) { return x.getId() === payload.fileId; }) : files[0];
  if (!f) throw new AppError('NOT_FOUND', '還沒有備份包，請先按「立即備份」');
  if (f.getSize() > 30 * 1024 * 1024) throw new AppError('BAD_REQUEST', '備份包太大，請直接到雲端硬碟「備份」資料夾下載');
  return { name: f.getName(), base64: Utilities.base64Encode(f.getBlob().getBytes()) };
}
