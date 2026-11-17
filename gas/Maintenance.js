/**
 * 維運（M4-01～M4-06，Super）：每月備份包、月度提醒信、NAS 確認日與照片清理、容量警示、個資遮蔽、LOG 封存。
 * 規則見 shared/maintenance.js。排程 monthlyMaintenance 每月 1 號凌晨：備份、封存去年 LOG、寄提醒信；
 * 照片清理與個資遮蔽無法復原，只在提醒信與系統頁列出，由 Super 按下才執行。
 */

const SYSTEM_MONTHLY_ACTOR_ = { email: '', name: '系統排程', role: ROLE_SUPER };

function todayText_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function folderByKey_(key) {
  const id = PropertiesService.getScriptProperties().getProperty('FOLDER_' + key);
  if (!id) throw new AppError('NOT_CONFIGURED', '尚未執行 setup()：找不到資料夾 ' + key);
  return DriveApp.getFolderById(id);
}

/** 寫「設定」分頁的值（沒有這個鍵就新增）。 */
function writeSetting_(key, value, actor) {
  const sh = sheet_('SYSTEM', '設定');
  const row = findRow_(sh, '鍵', key);
  const nowText = now_();
  if (row) writeRow_(sh, row._row, Object.assign({}, row, { '值': value, '修改時間': nowText, '修改者': actor.email || actor.name }));
  else appendRow_(sh, { '鍵': key, '值': value, '說明': '', '修改時間': nowText, '修改者': actor.email || actor.name });
}

function superEmails_() {
  return loadAdmins_().filter(function (a) { return a['狀態'] === '啟用' && normalizeLevel(a['等級']) === ROLE_SUPER; })
    .map(function (a) { return normalizeEmail(a['Email']); }).filter(Boolean);
}

// ---------- 容量 ----------

function capacity_() {
  let used = 0, limit = 0;
  try { used = DriveApp.getStorageUsed(); limit = DriveApp.getStorageLimit(); } catch (e) { /* 無法取得時不警示 */ }
  const c = capacityLevel(used, limit, setting_('容量警示門檻'));
  const gb = function (n) { return (n / 1073741824).toFixed(1) + ' GB'; };
  c.usedText = limit ? gb(used) + '／' + gb(limit) : '';
  return c;
}

// ---------- 備份 ----------

/** 所有資料表（含各年 LOG）轉成 { 檔名: { 分頁: [[標題…], [值…]…] } }。 */
function dumpBooks_() {
  const props = PropertiesService.getScriptProperties();
  const out = {};
  let rows = 0;
  const books = Object.keys(SCHEMA).map(function (k) { return { key: k, name: SCHEMA[k].name }; })
    .concat(logYears_().map(function (y) { return { key: 'LOG_' + y, name: 'LOG_' + y }; }));
  books.forEach(function (b) {
    if (!props.getProperty('SHEET_' + b.key)) return;
    const ss = book_(b.key);
    const sheets = {};
    ss.getSheets().forEach(function (sh) {
      const values = sh.getDataRange().getDisplayValues();
      sheets[sh.getName()] = values;
      rows += Math.max(0, values.length - 1);
    });
    out[b.key] = { name: b.name, sheets: sheets };
  });
  return { books: out, rows: rows };
}

/**
 * 產生備份包（備份_yyyyMMdd-HHmm.zip：data.json，不含照片；照片清單就是作業檔的「照片」分頁）。
 * 保留最新 12 份，更舊的移到垃圾桶（NAS 仍有）。寫備份紀錄與 LOG。回傳 { ok, name, rows, photos, removed }。
 */
function backupNow_(actor, type) {
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmm');
  const name = backupFileName(stamp);
  const log = sheet_('SYSTEM', '備份紀錄');
  try {
    const dump = dumpBooks_();
    const photoSheet = (dump.books.OPS && dump.books.OPS.sheets['照片']) || [[]];
    const photos = Math.max(0, photoSheet.length - 1);
    const json = JSON.stringify({ app: '資產管理系統', version: APP_VERSION, time: now_(), rows: dump.rows, photos: photos, books: dump.books });
    const zip = Utilities.zip([Utilities.newBlob(json, 'application/json', 'data.json')], name);
    const folder = folderByKey_('BACKUPS');
    folder.createFile(zip);
    const names = [];
    const it = folder.getFiles();
    const files = {};
    while (it.hasNext()) {
      const f = it.next();
      if (/^備份_\d{8}-\d{4}\.zip$/.test(f.getName())) { names.push(f.getName()); files[f.getName()] = f; }
    }
    const removed = backupsToRemove(names, BACKUP_KEEP);
    removed.forEach(function (n) { files[n].setTrashed(true); });
    appendRow_(log, { '時間': now_(), '類型': type || '手動', '檔名': name, '資料筆數': dump.rows, '照片數': photos, '執行者': actor.email || actor.name, '結果': '成功' });
    writeLog_(actor, '備份', '系統', name, '', { 資料筆數: dump.rows, 照片數: photos, 移除舊備份: removed.length }, '', type === '每月' ? '排程' : '網頁');
    return { ok: true, name: name, rows: dump.rows, photos: photos, removed: removed };
  } catch (e) {
    appendRow_(log, { '時間': now_(), '類型': type || '手動', '檔名': name, '資料筆數': '', '照片數': '', '執行者': actor.email || actor.name, '結果': '失敗：' + (e && e.message) });
    return { ok: false, name: name, error: String(e && e.message) };
  }
}

// ---------- 照片清理 ----------

function cleanupContext_() {
  return {
    today: todayText_(), nasDate: setting_('NAS確認日'), loanYears: setting_('借用照片保留年數'),
    photos: readRows_(photoSheet_()), results: readRows_(resultSheet_()),
    details: readRows_(loanDetailSheet_()), loans: readRows_(loanSheet_()),
  };
}

/** 簽核單也要早於 NAS 確認日才清（簽核單可能在結案後才上傳）。 */
function scanFileIfSynced_(fileId, nasDate) {
  try {
    const f = DriveApp.getFileById(fileId);
    const created = Utilities.formatDate(f.getDateCreated(), TZ, 'yyyy-MM-dd');
    return created < nasDate && !f.isTrashed() ? f : null;
  } catch (e) { return null; }
}

/**
 * 執行清理（Super 按下）。payload：{ count（畫面上看到的候選數，不一致就要重新整理） }。
 * 一次最多 300 個檔案（Apps Script 執行時間限制），剩下的再按一次。雲端檔移到垃圾桶，紀錄改「已清理」。
 */
function systemCleanup_(payload, actor) {
  const ctx = cleanupContext_();
  const c = cleanupCandidates(ctx);
  if (c.blocked) throw new AppError('BAD_REQUEST', c.blocked);
  const total = c.inventory.length + c.loan.length + c.scans.length;
  if (Number(payload.count) !== total) throw new AppError('VERSION_CONFLICT', '可清理的項目有變動，請重新整理後再確認');
  const MAX = 300;
  const photos = c.inventory.concat(c.loan).slice(0, MAX);
  const sh = photoSheet_();
  const nowText = now_();
  const reason = 'NAS 確認日 ' + ctx.nasDate + ' 前已同步，雲端清理';
  const done = [];
  photos.forEach(function (p) {
    try { photoFile_(p).setTrashed(true); } catch (e) { /* 雲端已找不到也標記，NAS 仍有 */ }
    const r = applyChanges(p, { '狀態': PHOTO_CLEANED, '作廢原因': reason }, ['狀態', '作廢原因'], actor.email, nowText);
    writeRow_(sh, p._row, r.row);
    done.push(p['照片編號']);
  });
  const scans = c.scans.slice(0, Math.max(0, MAX - photos.length));
  const cleanedScans = {};
  scans.forEach(function (s) {
    const f = scanFileIfSynced_(s.fileId, ctx.nasDate);
    if (!f) return;
    f.setTrashed(true);
    (cleanedScans[s.loanId] = cleanedScans[s.loanId] || []).push(f.getName());
  });
  if (Object.keys(cleanedScans).length) {
    const lsh = loanSheet_();
    const loans = readRows_(lsh);
    loans.forEach(function (l) {
      const names = cleanedScans[l['借用單號']];
      if (!names) return;
      const note = String(l['備註'] || '') + (l['備註'] ? '；' : '') + '簽核單已自雲端清理（NAS 保存）：' + names.join('、');
      Object.assign(l, applyChanges(l, { '簽核單': '', '備註': note }, ['簽核單', '備註'], actor.email, nowText).row);
    });
    writeAllRows_(lsh, loans, []);
  }
  const scanCount = Object.keys(cleanedScans).reduce(function (n, k) { return n + cleanedScans[k].length; }, 0);
  writeLog_(actor, '清理雲端照片', '系統', '', '', {
    照片: done.length, 簽核單: scanCount, 照片編號: done.slice(0, 200).join(','), 借用單: Object.keys(cleanedScans).join(','),
  }, reason);
  return { photos: done.length, scans: scanCount, remaining: total - photos.length - scans.length };
}

/** NAS 已同步：設定 NAS 確認日為今天。 */
function systemNasConfirm_(payload, actor) {
  const before = setting_('NAS確認日');
  const today = todayText_();
  writeSetting_('NAS確認日', today, actor);
  writeLog_(actor, 'NAS確認', '系統', 'NAS確認日', before, today);
  return { nasDate: today };
}

// ---------- 個資遮蔽 ----------

/** 執行遮蔽（Super 按下）。payload：{ ids（畫面上的候選單號） }。只遮蔽仍符合條件的；連結固定資產紀錄的借用人一併遮蔽。 */
function systemMask_(payload, actor) {
  const ids = (payload.ids || []).map(String);
  if (!ids.length) throw new AppError('BAD_REQUEST', '沒有要遮蔽的借用單');
  const sh = loanSheet_();
  const loans = readRows_(sh);
  const due = loansToMask(loans, todayText_(), setting_('個資遮蔽年數')).filter(function (l) { return ids.indexOf(l['借用單號']) !== -1; });
  if (!due.length) return { masked: 0 };
  const nowText = now_();
  const maskedIds = {};
  due.forEach(function (l) {
    maskedIds[l['借用單號']] = true;
    Object.assign(l, applyChanges(l, maskedLoanFields(l), ['借用人姓名', '學號或職號', '手機', 'Email', '已遮蔽'], actor.email, nowText).row);
  });
  writeAllRows_(sh, loans, []);
  // 借用 A 自動寫的固定資產紀錄：借用人欄是「姓名（學號）」
  const detailLoan = {};
  readRows_(loanDetailSheet_()).forEach(function (d) { if (maskedIds[d['借用單號']]) detailLoan[d['明細編號']] = true; });
  const fsh = schemaSheet_('OPS', '固定資產紀錄');
  const records = readRows_(fsh);
  let fixed = 0;
  records.forEach(function (r) {
    if (r['來源'] !== FR_SOURCE_LOAN_A || !detailLoan[r['來源編號']]) return;
    const m = String(r['借用人'] || '').match(/^(.*?)（(.*)）$/);
    const masked = m ? maskName(m[1]) + '（' + maskIdNo(m[2]) + '）' : maskName(r['借用人']);
    if (masked === r['借用人']) return;
    Object.assign(r, applyChanges(r, { '借用人': masked }, ['借用人'], actor.email, nowText).row);
    fixed++;
  });
  if (fixed) writeAllRows_(fsh, records, []);
  // LOG 不記個資的改前改後，只記哪些單號
  writeLogs_(actor, due.map(function (l) {
    return { action: '個資遮蔽', objectType: '借用單', key: l['借用單號'], before: '', after: { 已遮蔽: '是' } };
  }), '結案滿 ' + setting_('個資遮蔽年數') + ' 年');
  return { masked: due.length, fixedRecords: fixed };
}

// ---------- LOG 封存 ----------

function archivedLogYears_() {
  return String(PropertiesService.getScriptProperties().getProperty('LOG_ARCHIVED') || '').split(',').filter(Boolean);
}

/** 封存今年以前的 LOG：移到「資料/LOG封存」、分頁加保護（只有擁有者能改），查詢照常。 */
function archiveLogs_(actor) {
  const props = PropertiesService.getScriptProperties();
  const archived = archivedLogYears_();
  const years = logYearsToArchive(logYears_(), Utilities.formatDate(new Date(), TZ, 'yyyy'), archived);
  if (!years.length) return [];
  const target = ensureChildFolder_(folderByKey_('DATA'), 'LOG封存', []);
  years.forEach(function (y) {
    const ss = book_('LOG_' + y);
    const file = DriveApp.getFileById(ss.getId());
    file.moveTo(target);
    ss.getSheets().forEach(function (sh) {
      const p = sh.protect().setDescription('LOG ' + y + ' 已封存');
      p.removeEditors(p.getEditors());
      if (p.canDomainEdit()) p.setDomainEdit(false);
    });
    archived.push(y);
  });
  props.setProperty('LOG_ARCHIVED', archived.join(','));
  writeLog_(actor, '封存LOG', '系統', years.join(','), '', { 年份: years.join('、'), 位置: '資料/LOG封存' });
  return years;
}

function systemArchiveLogs_(payload, actor) {
  return { archived: archiveLogs_(actor) };
}

// ---------- 系統頁、首頁警示、排程 ----------

/** 系統頁資料（Super）：備份紀錄、NAS 確認日、容量、清理候選、遮蔽候選、LOG 年份。 */
function systemStatus_() {
  const backups = readRows_(sheet_('SYSTEM', '備份紀錄')).map(publicRow_).reverse().slice(0, 24);
  const ctx = cleanupContext_();
  const c = cleanupCandidates(ctx);
  const slimPhoto = function (p) { return { id: p['照片編號'], type: p['類型'], key: p['資產鍵'], purpose: p['用途'], uploaded: String(p['上傳時間']).slice(0, 10), path: p['雲端路徑'] + '/' + p['檔名'] }; };
  const mask = loansToMask(ctx.loans, ctx.today, setting_('個資遮蔽年數')).map(function (l) {
    return { id: l['借用單號'], status: l['狀態'], closed: String(l['結案時間']).slice(0, 10), name: maskName(l['借用人姓名']) };
  });
  return {
    today: ctx.today, nasDate: ctx.nasDate, capacity: capacity_(), backups: backups,
    settings: { loanYears: setting_('借用照片保留年數'), maskYears: setting_('個資遮蔽年數'), thresholds: setting_('容量警示門檻') },
    cleanup: {
      blocked: c.blocked, count: c.inventory.length + c.loan.length + c.scans.length,
      inventory: c.inventory.slice(0, 200).map(slimPhoto), inventoryTotal: c.inventory.length,
      loan: c.loan.slice(0, 200).map(slimPhoto), loanTotal: c.loan.length, scans: c.scans,
    },
    mask: mask, logYears: logYears_(), archivedLogs: archivedLogYears_(),
  };
}

/** Super 首頁警示（輕量）：容量、NAS 確認日、最近一次備份。 */
function systemAlerts_() {
  const backups = readRows_(sheet_('SYSTEM', '備份紀錄'));
  const last = backups.length ? backups[backups.length - 1] : null;
  return { today: todayText_(), capacity: capacity_(), nasDate: setting_('NAS確認日'), lastBackup: last ? { time: last['時間'], result: last['結果'] } : null };
}

function systemBackup_(payload, actor) {
  const r = backupNow_(actor, '手動');
  if (!r.ok) throw new AppError('INTERNAL', '備份失敗：' + r.error);
  return r;
}

/** 排程：每月 1 號凌晨 4 點。備份、封存去年 LOG、寄月度提醒信給全部 Super。 */
function monthlyMaintenance() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) return;
  try {
    const actor = SYSTEM_MONTHLY_ACTOR_;
    const backup = backupNow_(actor, '每月');
    let archivedLogs = [];
    try { archivedLogs = archiveLogs_(actor); } catch (e) { console.error('LOG 封存失敗：' + (e && e.message)); }
    const ctx = cleanupContext_();
    const c = cleanupCandidates(ctx);
    const overdue = loanReminders(ctx.loans, ctx.today, setting_('申請提醒天數')).overdue.map(function (x) {
      return { id: x.loan['借用單號'], name: x.loan['借用人姓名'], due: x.loan['預計歸還日'], days: x.days };
    });
    const mail = monthlyMailContent({
      unit: setting_('單位名稱'), today: ctx.today, url: setting_('網站網址') || 'https://cgu-coic-asset.github.io/',
      backup: backup, nasDate: ctx.nasDate, capacity: capacity_(), overdue: overdue,
      cleanup: { blocked: c.blocked, inventory: c.inventory.length, loan: c.loan.length, scans: c.scans.length },
      mask: loansToMask(ctx.loans, ctx.today, setting_('個資遮蔽年數')).length, archivedLogs: archivedLogs,
    });
    const to = superEmails_();
    if (to.length) MailApp.sendEmail({ to: to.join(','), subject: mail.subject, body: mail.body, name: '資產管理系統' });
    writeLog_(actor, '月度提醒', '系統', ctx.today.slice(0, 7), '', { 收件: to.length, 主旨: mail.subject }, '', '排程');
  } finally {
    lock.releaseLock();
  }
}
