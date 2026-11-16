/**
 * 盤點：批次（範圍＝資產清單的篩選）、逐件結果（照片先存好才能送出）、User 自行盤點、Admin 退回。
 * 規則見 shared/inventory.js。結果只新增不改（同一件盤兩次以最後一次為準），退回只改狀態欄。
 */

function batchSheet_() {
  return schemaSheet_('OPS', '盤點批次');
}

function resultSheet_() {
  return schemaSheet_('OPS', '盤點結果');
}

function activeBatches_() {
  return readRows_(batchSheet_()).filter(isBatchActive).map(publicRow_);
}

/** 某類型最新的進行中批次；沒有回傳 null。 */
function latestActiveBatch_(type) {
  const list = activeBatches_().filter(function (b) { return b['類型'] === type; });
  return list.length ? list[list.length - 1] : null;
}

/**
 * 清單用的盤點資訊：{ batch, results }（本次批次＝該類型最新的進行中批次）；沒有批次回傳 null。
 * keys 不為 null 時只回傳這些鍵的結果（User 只看自己的）。
 */
function inventoryInfo_(type, keys) {
  const batch = latestActiveBatch_(type);
  if (!batch) return null;
  let results = latestResults(readRows_(resultSheet_()), batch['批次編號']);
  if (keys) {
    const picked = {};
    keys.forEach(function (k) { if (results[k]) picked[k] = results[k]; });
    results = picked;
  }
  Object.keys(results).forEach(function (k) { results[k] = publicRow_(results[k]); });
  return { batch: batch, results: results };
}

/** 資產頁用：可盤的進行中批次（同類型；連結固定資產的系所物品另含固定資產批次）與這件在各批次的最新結果。 */
function inventoryForAsset_(type, main) {
  const key = assetKey(type, main);
  const batches = activeBatches_().filter(function (b) {
    return b['類型'] === type || (type === 'ITEM' && main['資產編號'] && b['類型'] === 'FIXED');
  });
  const all = readRows_(resultSheet_());
  const results = {};
  batches.forEach(function (b) {
    const k = b['類型'] === type ? key : main['資產編號'];
    const r = latestResults(all, b['批次編號'])[k];
    if (r) results[b['批次編號']] = publicRow_(r);
  });
  return { batches: batches, results: results };
}

function inventoryBatches_() {
  return { batches: readRows_(batchSheet_()).map(publicRow_).reverse(), managers: activeManagers_() };
}

function inventoryActive_() {
  return { batches: activeBatches_() };
}

/** 批次詳細：{ batch, results（本批次全部結果列，新到舊）, managers }。範圍內有哪些資產由前端用清單資料算。 */
function inventoryBatch_(payload) {
  const batch = readRows_(batchSheet_()).find(function (r) { return r['批次編號'] === payload.id; });
  if (!batch) throw new AppError('NOT_FOUND', '找不到這個盤點批次');
  const results = readRows_(resultSheet_()).filter(function (r) { return r['批次編號'] === payload.id; }).map(publicRow_).reverse();
  return { batch: publicRow_(batch), results: results, managers: activeManagers_() };
}

/** payload：{ type, name, scope（清單篩選物件；經管人可填 'me'）, endDate }。 */
function inventoryCreateBatch_(payload, actor) {
  const t = importTarget_(payload.type);
  const name = String(payload.name || '').trim().slice(0, 100);
  if (!name) throw new AppError('BAD_REQUEST', '請填批次名稱');
  const scope = cleanScope(payload.scope);
  if (scope['經管人'] === 'me') scope['經管人'] = actor.email;
  const sh = batchSheet_();
  const all = readRows_(sh);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  const id = nextBatchId(all.map(function (r) { return r['批次編號']; }), today);
  const row = stampNew({
    '批次編號': id, '名稱': name, '類型': payload.type, '範圍說明': scopeText(scope, activeManagers_()),
    '開始日': today, '截止日': String(payload.endDate || '').replace(/\D/g, '').slice(0, 8), '狀態': BATCH_ACTIVE,
    '範圍': JSON.stringify(scope),
  }, actor.email, now_());
  appendRow_(sh, row);
  writeLog_(actor, '建立盤點批次', '盤點批次', id, '', { 名稱: name, 類型: t.label, 範圍: row['範圍說明'] });
  return publicRow_(row);
}

/** payload：{ id, version }。結束後不能再盤；已有的結果保留。 */
function inventoryCloseBatch_(payload, actor) {
  const sh = batchSheet_();
  const batch = readRows_(sh).find(function (r) { return r['批次編號'] === payload.id; });
  if (!batch) throw new AppError('NOT_FOUND', '找不到這個盤點批次');
  const conflict = checkVersion(batch, payload.version);
  if (conflict) throw new AppError('VERSION_CONFLICT', undefined, conflict);
  const result = applyChanges(batch, { '狀態': BATCH_CLOSED }, ['狀態'], actor.email, now_());
  if (result.changed) {
    writeRow_(sh, batch._row, result.row);
    writeLog_(actor, '結束盤點批次', '盤點批次', payload.id, result.before, result.after);
  }
  return publicRow_(result.row);
}

/** User 只能盤自己名下的固定資產與保管品（依保管人代號）。 */
function assertCanInventory_(actor, type, main) {
  if (actor.role !== ROLE_USER) return;
  const code = String(main['保管人代號'] || '').toUpperCase();
  if (type === 'ITEM' || !code || (actor.codes || []).indexOf(code) === -1) {
    throw new AppError('FORBIDDEN', '只能盤點自己名下的財產');
  }
}

/** 盤點照片存在哪件底下：連結固定資產的系所物品存到該固定資產（盤點資料表要用）。 */
function photoTarget_(type, main) {
  if (type === 'ITEM' && String(main['資產編號'] || '')) return { type: 'FIXED', key: main['資產編號'] };
  return { type: type, key: photoAssetKey(type, main) };
}

function requireActiveBatch_(batchId, type) {
  const batch = activeBatches_().find(function (b) { return b['批次編號'] === batchId; });
  if (!batch) throw new AppError('BAD_REQUEST', '這個盤點批次不存在或已結束，請重新整理');
  if (batch['類型'] !== type) throw new AppError('BAD_REQUEST', '批次類型和這件資產不符');
  return batch;
}

/** 盤點照片（用途「盤點」，關聯批次）。payload：{ type, key, batchId, base64, takenAt, originalName }。 */
function inventoryPhoto_(payload, actor) {
  const main = findAssetRows_(payload.type, payload.key)[0];
  assertCanInventory_(actor, payload.type, main);
  requireActiveBatch_(payload.batchId, payload.type);
  const target = photoTarget_(payload.type, main);
  return savePhoto_({
    type: target.type, key: target.key, purpose: '盤點', relatedId: payload.batchId,
    base64: payload.base64, takenAt: payload.takenAt, originalName: payload.originalName,
  }, actor);
}

/** 盤點後更新資產列：最近盤點日、最近盤點結果（固定資產、系所物品）或最近盤點數量（保管品）、目前位置（有填才改）。 */
function updateAssetAfterInventory_(type, main, input, actor, nowText, date) {
  const changes = { '最近盤點日': date };
  if (type === 'CUSTODY') changes['最近盤點數量'] = input.quantity;
  else changes['最近盤點結果'] = input.result;
  if (input.location) changes['目前位置'] = input.location;
  const result = applyChanges(main, changes, ['最近盤點日', '最近盤點結果', '最近盤點數量', '目前位置'], actor.email, nowText);
  if (result.changed) writeRow_(targetSheet_(importTarget_(type)), main._row, result.row);
  return result;
}

/**
 * 盤點一件。payload：{ type, key, batchId, result, quantity, location, note, photoIds }。
 * 照片必須已經存好（inventory.photo）且屬於這件、這批次；數量不足就不接受。
 * 連結固定資產的系所物品：同時替該固定資產在進行中的固定資產批次寫一筆結果。
 */
function inventoryRecord_(payload, actor) {
  const type = payload.type;
  const t = importTarget_(type);
  const main = findAssetRows_(type, payload.key)[0];
  const key = assetKey(type, main);
  assertCanInventory_(actor, type, main);
  const batch = requireActiveBatch_(payload.batchId, type);
  const photoIds = (payload.photoIds || []).map(String).filter(Boolean);
  const quantity = type === 'CUSTODY' ? String(parseInt(payload.quantity, 10)) : '';
  const err = validateInventoryInput(type, main, { result: payload.result, photoCount: photoIds.length, quantity: payload.quantity });
  if (err) throw new AppError('BAD_REQUEST', err);

  const target = photoTarget_(type, main);
  const photos = readRows_(photoSheet_()).filter(function (p) { return photoIds.indexOf(p['照片編號']) !== -1; });
  const bad = photos.length !== photoIds.length || photos.some(function (p) {
    return p['類型'] !== target.type || p['資產鍵'] !== target.key || p['用途'] !== '盤點' || p['狀態'] !== PHOTO_ACTIVE;
  });
  if (bad) throw new AppError('BAD_REQUEST', '照片和這件資產不符，請重新拍照');

  const now = new Date();
  const nowText = now_();
  const date = Utilities.formatDate(now, TZ, 'yyyyMMdd');
  const stamp = Utilities.formatDate(now, TZ, 'yyyyMMddHHmmss');
  const input = {
    result: payload.result, quantity: quantity,
    location: String(payload.location || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    note: String(payload.note || '').trim().slice(0, 500),
  };
  const method = actor.role === ROLE_USER ? INV_SELF : INV_ONSITE;
  const sh = resultSheet_();
  const logs = [];
  const makeResult = function (rtype, rkey, batchId, note) {
    const row = stampNew({
      '結果編號': 'R' + stamp + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      '批次編號': batchId, '類型': rtype, '資產鍵': rkey, '結果': input.result, '實際數量': input.quantity,
      '實際位置': input.location, '盤點人': actor.email, '盤點時間': nowText, '備註': note,
      '方式': method, '狀態': RESULT_VALID, '照片編號': photoIds.join(','), '退回原因': '', '退回者': '', '退回時間': '',
    }, actor.email, nowText);
    appendRow_(sh, row);
    return row;
  };

  const resultRow = makeResult(type, key, batch['批次編號'], input.note);
  const changed = updateAssetAfterInventory_(type, main, input, actor, nowText, date);
  logs.push({
    action: method === INV_SELF ? '自行盤點' : '盤點', objectType: t.label, key: key, before: changed.before,
    after: Object.assign({ 批次: batch['批次編號'], 結果: input.result, 照片: photoIds.length }, changed.after),
  });

  let linkedBatch = '';
  if (type === 'ITEM' && main['資產編號']) {
    const fb = latestActiveBatch_('FIXED');
    if (fb) {
      const fixedMain = findAssetRows_('FIXED', main['資產編號'])[0];
      makeResult('FIXED', main['資產編號'], fb['批次編號'], '由系所物品 ' + (main['系所編號'] || main['物品ID']) + ' 盤點');
      const fc = updateAssetAfterInventory_('FIXED', fixedMain, input, actor, nowText, date);
      logs.push({
        action: '盤點', objectType: '固定資產', key: main['資產編號'], before: fc.before,
        after: Object.assign({ 批次: fb['批次編號'], 結果: input.result, 來源: '系所物品 ' + (main['系所編號'] || main['物品ID']) }, fc.after),
      });
      linkedBatch = fb['批次編號'];
    }
  }
  writeLogs_(actor, logs, input.note);
  return { result: publicRow_(resultRow), linkedBatch: linkedBatch };
}

/** Admin 退回一筆結果（照片不合格等），該件回到未盤。payload：{ resultId, reason }。 */
function inventoryReject_(payload, actor) {
  const reason = String(payload.reason || '').trim();
  if (!reason) throw new AppError('BAD_REQUEST', '請填退回原因');
  const sh = resultSheet_();
  const rec = readRows_(sh).find(function (r) { return r['結果編號'] === payload.resultId; });
  if (!rec) throw new AppError('NOT_FOUND', '找不到這筆盤點結果');
  if ((rec['狀態'] || RESULT_VALID) !== RESULT_VALID) throw new AppError('BAD_REQUEST', '這筆結果已經退回');
  const nowText = now_();
  const result = applyChanges(rec, { '狀態': RESULT_REJECTED, '退回原因': reason, '退回者': actor.email, '退回時間': nowText },
    ['狀態', '退回原因', '退回者', '退回時間'], actor.email, nowText);
  writeRow_(sh, rec._row, result.row);
  if (rec['類型'] !== 'CUSTODY') {
    const main = findAssetRows_(rec['類型'], rec['資產鍵'])[0];
    const ac = applyChanges(main, { '最近盤點結果': '退回' }, ['最近盤點結果'], actor.email, nowText);
    if (ac.changed) writeRow_(targetSheet_(importTarget_(rec['類型'])), main._row, ac.row);
  }
  writeLog_(actor, '退回盤點', importTarget_(rec['類型']).label, rec['資產鍵'], { 結果: rec['結果'], 盤點人: rec['盤點人'] }, { 狀態: RESULT_REJECTED }, reason);
  return publicRow_(result.row);
}
