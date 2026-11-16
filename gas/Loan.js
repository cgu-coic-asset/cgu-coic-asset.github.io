/**
 * 借用 A（系所物品借用單）。M2-01：公開申請與借用單查詢／列印。
 * 規則見 shared/loan.js。申請只存文字，物品狀態維持在庫，借出（M2-04）時才改借出。
 */

function loanSheet_() {
  return schemaSheet_('OPS', '借用單');
}

function loanDetailSheet_() {
  return schemaSheet_('OPS', '借用明細');
}

/** 被未結束借用單占用的物品：{ 物品ID: 借用單號 }（申請中、借出中的明細）。 */
function reservedItems_() {
  const out = {};
  readRows_(loanDetailSheet_()).forEach(function (d) {
    if (d['類型'] === 'ITEM' && (d['狀態'] === DETAIL_APPLIED || d['狀態'] === DETAIL_OUT)) out[d['資產鍵']] = d['借用單號'];
  });
  return out;
}

/**
 * 公開申請。payload：申請欄位＋items（物品ID 陣列）。
 * 物品必須開放借用、在庫、沒有被其他申請占用。回傳給申請人看的借用單（可列印）。
 */
function loanApply_(payload, actor) {
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  // 已登入的管理者代填不檢查機器人與頻率
  const isStaff = can(actor.role, 'loan.manage');
  if (!isStaff) {
    const bot = botCheck(payload._meta);
    if (bot) throw new AppError('BAD_REQUEST', bot);
  }
  const v = validateLoanRequest(payload, today);
  if (!v.ok) throw new AppError('BAD_REQUEST', v.errors.join('；'), { errors: v.errors });
  voidExpiredLoans_(SYSTEM_ACTOR_);
  if (!isStaff) {
    const rate = rateCheck(loanCounts_(v.data, now));
    if (rate) throw new AppError('BAD_REQUEST', rate);
  }

  const items = readRows_(itemSheet_());
  const reserved = reservedItems_();
  const picked = v.items.map(function (id) {
    const r = items.find(function (x) { return x['物品ID'] === id; });
    if (!r) throw new AppError('BAD_REQUEST', '找不到物品 ' + id + '，請重新整理清單');
    const label = r['系所編號'] || id;
    if (!isLendable(r)) throw new AppError('BAD_REQUEST', label + ' 目前不能借，請重新整理清單');
    if (reserved[id]) throw new AppError('BAD_REQUEST', label + ' 已有人申請，請改選其他件');
    return r;
  });

  const nowText = now_();
  const date = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  const sh = loanSheet_();
  const id = nextLoanId(readRows_(sh).map(function (r) { return r['借用單號']; }), date);
  const who = actor.email || '訪客';
  const loan = stampNew(Object.assign({}, v.data, {
    '借用單號': id, '狀態': LOAN_APPLIED, '申請時間': nowText, '結案時間': '', '已遮蔽': '',
  }), who, nowText);
  appendRow_(sh, loan);

  const dsh = loanDetailSheet_();
  const details = picked.map(function (r, i) {
    const d = stampNew({
      '明細編號': id + '-' + ('0' + (i + 1)).slice(-2), '借用單號': id, '類型': 'ITEM', '資產鍵': r['物品ID'],
      '名稱': r['名稱'], '數量': '1', '系所內部編號': r['系所編號'] || '', '借出時間': '', '借出經手人': '',
      '歸還時間': '', '歸還經手人': '', '狀態': DETAIL_APPLIED, '備註': '',
    }, who, nowText);
    appendRow_(dsh, d);
    return Object.assign({}, d, { '規格': r['規格'] || '' });
  });
  writeLog_(actor, '借用申請', '借用單', id, '', {
    借用人: v.data['借用人姓名'], 件數: details.length, 物品: details.map(function (d) { return d['系所內部編號'] || d['資產鍵']; }).join('、'),
  }, '', '網頁');
  notifyNewLoan_(loan, details, picked);
  return { loan: loanForApplicant(loan, details), unit: setting_('單位名稱') };
}

/** 新申請寄信給經管人等（失敗只記錄，不影響申請）。 */
function notifyNewLoan_(loan, details, itemRows) {
  try {
    const supers = loadAdmins_().filter(function (a) { return a['狀態'] === '啟用' && normalizeLevel(a['等級']) === ROLE_SUPER; })
      .map(function (a) { return a['Email']; });
    const to = loanNotifyRecipients(itemRows, setting_('借用通知信箱'), supers);
    if (!to.length) return;
    const mail = loanMailContent(loan, details, setting_('網站網址') || 'https://cgu-coic-asset.github.io/');
    MailApp.sendEmail({ to: to.join(','), subject: mail.subject, body: mail.body, name: '資產管理系統' });
  } catch (e) {
    console.error('借用通知信失敗 ' + loan['借用單號'] + '：' + (e && e.message));
  }
}

/** 排程與自動處理用的操作者。 */
var SYSTEM_ACTOR_ = { email: '', name: '系統排程', role: ROLE_SUPER, loggedIn: false, codes: [] };

/** 頻率計數：近一小時全部、同手機或 Email、同手機申請中。 */
function loanCounts_(data, now) {
  const since = Utilities.formatDate(new Date(now.getTime() - 3600000), TZ, 'yyyy-MM-dd HH:mm:ss');
  const phone = String(data['手機']).replace(/\D/g, '');
  const email = String(data['Email']).toLowerCase();
  const out = { global: 0, contact: 0, openPhone: 0 };
  let byPhone = 0;
  let byEmail = 0;
  readRows_(loanSheet_()).forEach(function (r) {
    const samePhone = String(r['手機']).replace(/\D/g, '') === phone;
    if (samePhone && r['狀態'] === LOAN_APPLIED) out.openPhone++;
    if (String(r['申請時間']) < since) return;
    out.global++;
    if (samePhone) byPhone++;
    if (String(r['Email']).toLowerCase() === email) byEmail++;
  });
  out.contact = Math.max(byPhone, byEmail);
  return out;
}

/**
 * 申請中超過「申請作廢天數」的借用單改為已作廢（明細一起），物品不再被占用。
 * 呼叫端須已取得指令碼鎖。回傳作廢的單號。
 */
function voidExpiredLoans_(actor) {
  const days = setting_('申請作廢天數');
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const sh = loanSheet_();
  const loans = readRows_(sh);
  const expired = loans.filter(function (l) { return isApplicationExpired(l, today, days); });
  if (!expired.length) return [];
  const nowText = now_();
  const ids = expired.map(function (l) { return l['借用單號']; });
  const logs = [];
  expired.forEach(function (l) {
    const r = applyChanges(l, { '狀態': LOAN_VOID, '結案時間': nowText }, ['狀態', '結案時間'], actor.email || '系統排程', nowText);
    Object.assign(l, r.row);
    logs.push({ action: '借用申請作廢', objectType: '借用單', key: l['借用單號'], before: r.before, after: r.after });
  });
  writeAllRows_(sh, loans, []);
  const dsh = loanDetailSheet_();
  const details = readRows_(dsh);
  let changed = false;
  details.forEach(function (d) {
    if (ids.indexOf(d['借用單號']) === -1 || d['狀態'] !== DETAIL_APPLIED) return;
    Object.assign(d, applyChanges(d, { '狀態': DETAIL_VOID }, ['狀態'], actor.email || '系統排程', nowText).row);
    changed = true;
  });
  if (changed) writeAllRows_(dsh, details, []);
  writeLogs_(actor, logs, '申請中超過 ' + days + ' 天未借出', '排程');
  return ids;
}

/** 每日排程（installTriggers 安裝）：作廢逾期申請。 */
function dailyLoanCleanup() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return;
  try {
    voidExpiredLoans_(SYSTEM_ACTOR_);
  } finally {
    lock.releaseLock();
  }
}

/** 依單號＋手機查自己的借用單（重新列印用）。手機只比對數字。 */
function loanLookup_(payload) {
  const id = String(payload.id || '').trim().toUpperCase();
  const phone = String(payload.phone || '').replace(/\D/g, '');
  const loan = readRows_(loanSheet_()).find(function (r) { return r['借用單號'] === id; });
  if (!loan || !phone || String(loan['手機']).replace(/\D/g, '') !== phone || loan['已遮蔽'] === '是') {
    throw new AppError('NOT_FOUND', '找不到這張借用單，請確認單號與手機');
  }
  const items = {};
  readRows_(itemSheet_()).forEach(function (r) { items[r['物品ID']] = r; });
  const details = readRows_(loanDetailSheet_()).filter(function (d) { return d['借用單號'] === id; }).map(function (d) {
    return Object.assign({}, d, { '規格': (items[d['資產鍵']] || {})['規格'] || '' });
  });
  return { loan: loanForApplicant(loan, details), unit: setting_('單位名稱') };
}

// ---------- 管理：清單、單張、借出（M2-04）----------

/** 借用單清單（新到舊），每張附件數與物品編號。 */
function loanList_() {
  const details = readRows_(loanDetailSheet_());
  const byLoan = {};
  details.forEach(function (d) { (byLoan[d['借用單號']] = byLoan[d['借用單號']] || []).push(d); });
  const loans = readRows_(loanSheet_()).map(function (l) {
    const o = publicRow_(l);
    const ds = byLoan[l['借用單號']] || [];
    o.items = ds.filter(function (d) { return d['狀態'] !== DETAIL_VOID || l['狀態'] === LOAN_VOID; })
      .map(function (d) { return { code: d['系所內部編號'] || d['資產鍵'], name: d['名稱'], status: d['狀態'] }; });
    return o;
  }).reverse();
  return { loans: loans, unit: setting_('單位名稱') };
}

function findLoan_(id) {
  const loan = readRows_(loanSheet_()).find(function (r) { return r['借用單號'] === String(id || '').trim().toUpperCase(); });
  if (!loan) throw new AppError('NOT_FOUND', '找不到借用單 ' + id);
  return loan;
}

/**
 * 單張借用單（管理用）：借用單、明細（附物品目前資料與借出照片數）、可換件的候選（同名稱規格、可借、未被占用）、簽核單檔案。
 */
function loanGet_(payload) {
  const loan = findLoan_(payload.id);
  const id = loan['借用單號'];
  const items = readRows_(itemSheet_());
  const byId = {};
  items.forEach(function (r) { byId[r['物品ID']] = r; });
  const reserved = reservedItems_();
  const photos = readRows_(photoSheet_()).filter(function (p) { return p['狀態'] === PHOTO_ACTIVE && String(p['關聯編號']).indexOf(id + '-') === 0; });
  const details = readRows_(loanDetailSheet_()).filter(function (d) { return d['借用單號'] === id; }).map(function (d) {
    const it = byId[d['資產鍵']] || {};
    const o = publicRow_(d);
    o.item = { 物品ID: it['物品ID'] || d['資產鍵'], 系所編號: it['系所編號'] || '', 名稱: it['名稱'] || d['名稱'], 規格: it['規格'] || '',
      狀態: assetStatus(it), 開放借用: it['開放借用'] || '', 資產編號: it['資產編號'] || '' };
    o.photos = photos.filter(function (p) { return p['關聯編號'] === d['明細編號']; }).map(function (p) {
      return { id: p['照片編號'], purpose: p['用途'], name: p['檔名'], key: p['資產鍵'] };
    });
    if (loan['狀態'] === LOAN_APPLIED) {
      o.candidates = items.filter(function (r) {
        return r['物品ID'] !== d['資產鍵'] && r['名稱'] === (it['名稱'] || d['名稱']) && (r['規格'] || '') === (it['規格'] || '') &&
          isLendable(r) && !reserved[r['物品ID']];
      }).map(function (r) { return { 物品ID: r['物品ID'], 系所編號: r['系所編號'] || '' }; })
        .sort(function (a, b) { return compareItemCodes(a['系所編號'], b['系所編號']); });
    }
    return o;
  });
  return { loan: publicRow_(loan), details: details, unit: setting_('單位名稱') };
}

/** 借出、歸還照片。payload：{ loanId, detailId, itemId, purpose（借出／歸還）, base64, takenAt, originalName }。 */
function loanPhoto_(payload, actor) {
  if (['借出', '歸還'].indexOf(payload.purpose) === -1) throw new AppError('BAD_REQUEST', '照片用途不正確');
  const loan = findLoan_(payload.loanId);
  const detail = readRows_(loanDetailSheet_()).find(function (d) { return d['明細編號'] === payload.detailId && d['借用單號'] === loan['借用單號']; });
  if (!detail) throw new AppError('NOT_FOUND', '找不到這筆明細');
  const want = payload.purpose === '借出' ? LOAN_APPLIED : LOAN_OUT;
  if (loan['狀態'] !== want) throw new AppError('BAD_REQUEST', '借用單狀態是' + loan['狀態'] + '，不能拍' + payload.purpose + '照片');
  const itemId = String(payload.itemId || detail['資產鍵']);
  return savePhoto_({ type: 'ITEM', key: itemId, purpose: payload.purpose, relatedId: detail['明細編號'],
    base64: payload.base64, takenAt: payload.takenAt, originalName: payload.originalName }, actor);
}

/**
 * 借出。payload：{ id, version, lines: [{ detailId, itemId（空白＝不借）, verified, photoIds }], note }。
 * 物品狀態改借出；連結固定資產者固定資產須在庫，一起改借出。換件時記原申請物品。
 */
function loanCheckout_(payload, actor) {
  const sh = loanSheet_();
  const loan = findLoan_(payload.id);
  const id = loan['借用單號'];
  if (loan['狀態'] !== LOAN_APPLIED) throw new AppError('BAD_REQUEST', '這張單是' + loan['狀態'] + '，不能借出');
  const conflict = checkVersion(loan, payload.version);
  if (conflict) throw new AppError('VERSION_CONFLICT', undefined, conflict);

  const dsh = loanDetailSheet_();
  const allDetails = readRows_(dsh);
  const details = allDetails.filter(function (d) { return d['借用單號'] === id && d['狀態'] === DETAIL_APPLIED; });
  const photos = readRows_(photoSheet_());
  const lines = (payload.lines || []).map(function (l) {
    const ids = (l.photoIds || []).map(String);
    const ok = photos.filter(function (p) {
      return ids.indexOf(p['照片編號']) !== -1 && p['類型'] === 'ITEM' && p['資產鍵'] === l.itemId && p['用途'] === '借出' &&
        p['關聯編號'] === l.detailId && p['狀態'] === PHOTO_ACTIVE;
    });
    return { detailId: l.detailId, itemId: String(l.itemId || ''), verified: !!l.verified, photoCount: ok.length, photoIds: ok.map(function (p) { return p['照片編號']; }) };
  });
  const errs = checkoutErrors(details, lines);
  if (errs.length) throw new AppError('BAD_REQUEST', errs.join('；'), { errors: errs });

  const ish = itemSheet_();
  const items = readRows_(ish);
  const reserved = reservedItems_();
  const nowText = now_();
  const logs = [];
  const fixedChanges = [];
  const byLine = {};
  lines.forEach(function (l) { byLine[l.detailId] = l; });

  // 先全部檢查，再寫入
  const plan = details.map(function (d) {
    const l = byLine[d['明細編號']];
    if (!l.itemId) return { d: d, l: l };
    const it = items.find(function (r) { return r['物品ID'] === l.itemId; });
    const label = (it && it['系所編號']) || l.itemId;
    if (!it || !isLendable(it)) throw new AppError('BAD_REQUEST', label + ' 目前不能借（狀態或開放借用已變更）');
    if (reserved[l.itemId] && reserved[l.itemId] !== id) throw new AppError('BAD_REQUEST', label + ' 已被借用單 ' + reserved[l.itemId] + ' 占用');
    let fixed = null;
    if (it['資產編號']) {
      fixed = findAssetRows_('FIXED', it['資產編號'])[0];
      if (assetStatus(fixed) !== '在庫') throw new AppError('BAD_REQUEST', label + ' 連結的固定資產 ' + it['資產編號'] + ' 目前' + assetStatus(fixed) + '，不能借出');
    }
    return { d: d, l: l, it: it, fixed: fixed };
  });

  plan.forEach(function (p) {
    const d = p.d;
    if (!p.l.itemId) {
      Object.assign(d, applyChanges(d, { '狀態': DETAIL_VOID, '備註': '借出時取消' }, ['狀態', '備註'], actor.email, nowText).row);
      return;
    }
    const swap = p.l.itemId !== d['資產鍵'];
    const changes = { '狀態': DETAIL_OUT, '借出時間': nowText, '借出經手人': actor.email, '借出照片': p.l.photoIds.join(',') };
    if (swap) Object.assign(changes, { '申請物品': d['資產鍵'], '資產鍵': p.l.itemId, '名稱': p.it['名稱'], '系所內部編號': p.it['系所編號'] || '' });
    Object.assign(d, applyChanges(d, changes, Object.keys(changes), actor.email, nowText).row);
    const ir = applyChanges(p.it, { '狀態': '借出' }, ['狀態'], actor.email, nowText);
    Object.assign(p.it, ir.row);
    logs.push({ action: '借出', objectType: '系所物品', key: p.l.itemId, before: ir.before, after: Object.assign({ 借用單: id }, ir.after, swap ? { 換件自: changes['申請物品'] } : {}) });
    if (p.fixed) fixedChanges.push(p);
  });
  writeAllRows_(dsh, allDetails, []);
  writeAllRows_(ish, items, []);
  fixedChanges.forEach(function (p) {
    const fr = applyChanges(p.fixed, { '狀態': '借出' }, ['狀態'], actor.email, nowText);
    writeRow_(targetSheet_(importTarget_('FIXED')), p.fixed._row, fr.row);
    logs.push({ action: '借出', objectType: '固定資產', key: p.fixed['資產編號'], before: fr.before, after: Object.assign({ 借用單: id, 系所物品: p.it['系所編號'] || p.it['物品ID'] }, fr.after) });
  });
  const lr = applyChanges(loan, { '狀態': LOAN_OUT, '借出時間': nowText, '備註': [loan['備註'], payload.note].filter(Boolean).join('；').slice(0, 300) },
    ['狀態', '借出時間', '備註'], actor.email, nowText);
  writeRow_(sh, loan._row, lr.row);
  logs.unshift({ action: '借用單借出', objectType: '借用單', key: id, before: lr.before, after: Object.assign({ 件數: logs.length }, lr.after) });
  writeLogs_(actor, logs, payload.note || '');
  return loanGet_({ id: id });
}

/** 上傳簽好的借用單掃描檔（JPEG、PNG 或 PDF，5 MB 內），存到 借用/<單號>/。payload：{ id, base64, mime, name }。 */
function loanUploadScan_(payload, actor) {
  const sh = loanSheet_();
  const loan = findLoan_(payload.id);
  const mimes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
  if (!mimes[payload.mime]) throw new AppError('BAD_REQUEST', '只接受 JPEG、PNG 或 PDF');
  const bytes = Utilities.base64Decode(String(payload.base64 || ''));
  if (!bytes.length) throw new AppError('BAD_REQUEST', '沒有收到檔案');
  if (bytes.length > 5 * 1024 * 1024) throw new AppError('BAD_REQUEST', '檔案超過 5 MB');
  const props = PropertiesService.getScriptProperties();
  const rootId = props.getProperty('FOLDER_LOANS');
  if (!rootId) throw new AppError('NOT_CONFIGURED', '尚未執行 setup()：找不到借用資料夾');
  const folder = ensureChildFolder_(DriveApp.getFolderById(rootId), loan['借用單號'], []);
  const existing = String(loan['簽核單'] || '').split(',').filter(Boolean);
  const name = '簽核單_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') + '_' + (existing.length + 1) + '.' + mimes[payload.mime];
  const file = folder.createFile(Utilities.newBlob(bytes, payload.mime, name));
  const r = applyChanges(loan, { '簽核單': existing.concat([file.getId()]).join(',') }, ['簽核單'], actor.email, now_());
  writeRow_(sh, loan._row, r.row);
  writeLog_(actor, '上傳簽核單', '借用單', loan['借用單號'], '', { 檔名: name, 原始檔名: String(payload.name || '').slice(0, 100) });
  return { name: name, fileId: file.getId() };
}

/** 讀簽核單（管理用）。payload：{ id, fileId }。 */
function loanScanGet_(payload) {
  const loan = findLoan_(payload.id);
  if (String(loan['簽核單'] || '').split(',').indexOf(payload.fileId) === -1) throw new AppError('NOT_FOUND', '找不到這個檔案');
  const blob = DriveApp.getFileById(payload.fileId).getBlob();
  return { name: blob.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}
