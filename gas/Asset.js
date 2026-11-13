/**
 * 資產清單、詳細資料、編輯與批次指定經管人。
 * 可編輯欄位見 shared/assetList.js 的 ASSET_EDITABLE；其他欄位來自匯入或流程。
 */

/** 啟用中的 Admin、Super（經管人選單用；User 不能當經管人）。 */
function activeManagers_() {
  return loadAdmins_().filter(function (a) {
    return a['狀態'] === '啟用' && [ROLE_ADMIN, ROLE_SUPER].indexOf(normalizeLevel(a['等級'])) !== -1;
  })
    .map(function (a) { return { email: normalizeEmail(a['Email']), name: a['姓名'] }; });
}

function assetList_(payload) {
  const t = importTarget_(payload.type);
  return { rows: readRows_(sheet_(t.book, t.sheet)).map(publicRow_), managers: activeManagers_() };
}

/** 固定資產回傳同一資產編號的所有紀錄（含增值）；保管品回傳一筆。 */
function assetGet_(payload) {
  const t = importTarget_(payload.type);
  const key = String(payload.key || '');
  const field = payload.type === 'FIXED' ? '資產編號' : '保管品鍵';
  const rows = readRows_(sheet_(t.book, t.sheet)).filter(function (r) { return r[field] === key; });
  if (!rows.length) throw new AppError('NOT_FOUND', '找不到 ' + key);
  rows.sort(function (a, b) { return Number(a['增值次數'] || 0) - Number(b['增值次數'] || 0); });
  return { rows: rows.map(publicRow_), managers: activeManagers_() };
}

function validateAssetChanges_(changes) {
  if (changes['開放借用'] !== undefined && ASSET_OPEN_VALUES.indexOf(changes['開放借用']) === -1) {
    throw new AppError('BAD_REQUEST', '開放借用只能是「是」或「否」');
  }
  if (changes['經管人'] !== undefined && changes['經管人'] !== '') {
    changes['經管人'] = normalizeEmail(changes['經管人']);
    const ok = activeManagers_().some(function (m) { return m.email === changes['經管人']; });
    if (!ok) throw new AppError('BAD_REQUEST', '經管人必須是啟用中的管理者');
  }
}

/** payload：{ type, rowKey（importRowKey）, version, changes, reason（必填） }。 */
function assetUpdate_(payload, actor) {
  const t = importTarget_(payload.type);
  if (!String(payload.reason || '').trim()) throw new AppError('BAD_REQUEST', '請填寫修改原因');
  const changes = Object.assign({}, payload.changes || {});
  validateAssetChanges_(changes);

  const sh = targetSheet_(t);
  const current = readRows_(sh).find(function (r) { return importRowKey(payload.type, r) === payload.rowKey; });
  if (!current) throw new AppError('NOT_FOUND');
  const conflict = checkVersion(current, payload.version);
  if (conflict) throw new AppError('VERSION_CONFLICT', undefined, conflict);

  const result = applyChanges(current, changes, ASSET_EDITABLE, actor.email, now_());
  if (!result.changed) return publicRow_(current);
  writeRow_(sh, current._row, result.row);
  writeLog_(actor, '修改資產', t.label, payload.rowKey, result.before, result.after, payload.reason);
  return publicRow_(result.row);
}

/**
 * 批次修改（目前位置、經管人、開放借用）。
 * payload：{ type, items: [{ rowKey, version }], field（預設經管人）, value（經管人空白＝取消）, reason }。
 */
function assetAssign_(payload, actor) {
  const t = importTarget_(payload.type);
  const items = payload.items || [];
  if (!items.length) throw new AppError('BAD_REQUEST', '請先勾選資產');
  const field = payload.field || '經管人';
  if (ASSET_BATCH_FIELDS.indexOf(field) === -1) throw new AppError('BAD_REQUEST', '這個欄位不能批次修改：' + field);
  const changes = {};
  changes[field] = payload.value !== undefined ? payload.value : (payload.manager || '');
  if (field === '開放借用' && !changes[field]) throw new AppError('BAD_REQUEST', '請選擇開放借用：是或否');
  if (field === '目前位置') changes[field] = String(changes[field] || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  validateAssetChanges_(changes);

  const sh = targetSheet_(t);
  const existing = readRows_(sh);
  const byKey = {};
  existing.forEach(function (r) { byKey[importRowKey(payload.type, r)] = r; });

  const conflicts = [];
  items.forEach(function (it) {
    const row = byKey[it.rowKey];
    if (!row || checkVersion(row, it.version)) conflicts.push(it.rowKey);
  });
  if (conflicts.length) {
    throw new AppError('VERSION_CONFLICT', conflicts.length + ' 筆資料剛被修改過，請重新整理後再改', { keys: conflicts.slice(0, 20) });
  }

  const nowText = now_();
  const logs = [];
  items.forEach(function (it) {
    const row = byKey[it.rowKey];
    const result = applyChanges(row, changes, [field], actor.email, nowText);
    if (!result.changed) return;
    Object.assign(row, result.row);
    logs.push({ action: '批次修改' + field, objectType: t.label, key: it.rowKey, before: result.before, after: result.after });
  });
  if (logs.length) {
    writeAllRows_(sh, existing, []);
    writeLogs_(actor, logs, payload.reason, '網頁');
  }
  return { updated: logs.length };
}
