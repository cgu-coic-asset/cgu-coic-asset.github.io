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
  let rows = readRows_(schemaSheet_(t.book, t.sheet)).map(publicRow_);
  const out = { managers: activeManagers_(), photoCounts: photoCountsAll_() };
  if (payload.type === 'ITEM') rows = joinItemsWithCustody_(rows);
  if (payload.type === 'CUSTODY') out.itemStats = itemStatsByCustody_();
  if (payload.type === 'FIXED') {
    const codes = itemCodesByFixed_();
    rows.forEach(function (r) { if (codes[r['資產編號']]) r['系所編號'] = codes[r['資產編號']]; });
  }
  out.rows = rows;
  return out;
}

/** 固定資產回傳同一資產編號的所有紀錄（含增值）；保管品回傳一筆。 */
function assetGet_(payload) {
  const t = importTarget_(payload.type);
  const key = String(payload.key || '');
  const field = ASSET_TYPES[payload.type].keyField;
  let rows = readRows_(schemaSheet_(t.book, t.sheet)).filter(function (r) { return r[field] === key; });
  if (!rows.length) throw new AppError('NOT_FOUND', '找不到 ' + key);
  rows.sort(function (a, b) { return Number(a['增值次數'] || 0) - Number(b['增值次數'] || 0); });
  rows = rows.map(publicRow_);
  const out = { managers: activeManagers_() };
  if (payload.type === 'ITEM') rows = joinItemsWithCustody_(rows);
  if (payload.type === 'CUSTODY') out.items = joinItemsWithCustody_(itemsOfCustody_(key));
  if (payload.type === 'FIXED') {
    out.items = readRows_(itemSheet_()).filter(function (r) { return r['資產編號'] === key && assetStatus(r) !== '報廢'; }).map(publicRow_);
  }
  out.rows = rows;
  return out;
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
  const all = readRows_(sh);
  const current = all.find(function (r) { return importRowKey(payload.type, r) === payload.rowKey; });
  if (current && payload.type === 'ITEM') validateItemChanges_(changes, all, current);
  if (!current) throw new AppError('NOT_FOUND');
  const conflict = checkVersion(current, payload.version);
  if (conflict) throw new AppError('VERSION_CONFLICT', undefined, conflict);

  const result = applyChanges(current, changes, editableFields(payload.type), actor.email, now_());
  if (!result.changed) return publicRow_(current);
  writeRow_(sh, current._row, result.row);
  writeLog_(actor, '修改資產', t.label, payload.rowKey, result.before, result.after, payload.reason);
  return payload.type === 'ITEM' ? joinItemsWithCustody_([publicRow_(result.row)])[0] : publicRow_(result.row);
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

/**
 * 批次取代名稱文字（學校清冊缺字、錯字時自己修）。固定資產、保管品寫到「名稱修正」，系所物品直接改「名稱」。
 * payload：{ type, items: [{ rowKey, version }], find, replace, reason }。找不到 find 的列不改。
 */
function assetReplaceName_(payload, actor) {
  const t = importTarget_(payload.type);
  const find = String(payload.find || '');
  if (!find) throw new AppError('BAD_REQUEST', '請輸入要找的文字');
  const items = payload.items || [];
  if (!items.length) throw new AppError('BAD_REQUEST', '請先勾選資產');
  const field = payload.type === 'ITEM' ? '名稱' : '名稱修正';

  const sh = targetSheet_(t);
  const existing = readRows_(sh);
  const byKey = {};
  existing.forEach(function (r) { byKey[importRowKey(payload.type, r)] = r; });
  const conflicts = items.filter(function (it) { return !byKey[it.rowKey] || checkVersion(byKey[it.rowKey], it.version); });
  if (conflicts.length) throw new AppError('VERSION_CONFLICT', conflicts.length + ' 筆資料剛被修改過，請重新整理後再改');

  const nowText = now_();
  const logs = [];
  items.forEach(function (it) {
    const row = byKey[it.rowKey];
    const value = replaceNameFix(payload.type, row, find, payload.replace);
    if (value === null) return;
    const changes = {};
    changes[field] = payload.type === 'ITEM' ? (value || row['名稱']) : value;
    if (payload.type === 'ITEM' && !String(changes[field]).trim()) return;
    const result = applyChanges(row, changes, [field], actor.email, nowText);
    if (!result.changed) return;
    Object.assign(row, result.row);
    logs.push({ action: '修正名稱', objectType: t.label, key: it.rowKey, before: result.before, after: result.after });
  });
  if (logs.length) {
    writeAllRows_(sh, existing, []);
    writeLogs_(actor, logs, payload.reason || '名稱取代：' + find + ' → ' + (payload.replace || '（刪除）'), '網頁');
  }
  return { updated: logs.length };
}
