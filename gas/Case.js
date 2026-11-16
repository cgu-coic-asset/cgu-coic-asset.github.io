/**
 * 異常案件：Admin 登記（資產自動停借）；Super 確認處理結果後結案（解除停借或改報廢）。
 * 規則見 shared/cases.js。案件列只在登記與結案時寫入；每次都寫 LOG。
 */

function caseSheet_() {
  return schemaSheet_('OPS', '異常案件');
}

/** 清單用：每件資產處理中的案件數。 */
function openCaseCountsAll_() {
  return openCaseCounts(readRows_(caseSheet_()));
}

/** 某件資產的所有案件（新到舊）。 */
function casesOfAsset_(type, key) {
  return readRows_(caseSheet_()).filter(function (c) { return c['類型'] === type && c['資產鍵'] === key; }).map(publicRow_).reverse();
}

/** 全部案件（新到舊）＋管理者（顯示姓名用）。 */
function caseList_() {
  return { cases: readRows_(caseSheet_()).map(publicRow_).reverse(), managers: activeManagers_() };
}

/** 改資產狀態（有變才寫），回傳 applyChanges 結果。 */
function setAssetStatus_(type, main, status, actor, nowText) {
  const result = applyChanges(main, { '狀態': status }, ['狀態'], actor.email, nowText);
  if (result.changed) writeRow_(targetSheet_(importTarget_(type)), main._row, result.row);
  return result;
}

/**
 * 登記異常。payload：{ type, key, caseType, description, source（盤點／借還／現場）, sourceId }。
 * 資產在庫→停借；借出保持借出；報廢不能登記。
 */
function caseOpen_(payload, actor) {
  const type = payload.type;
  const t = importTarget_(type);
  if (CASE_TYPES.indexOf(payload.caseType) === -1) throw new AppError('BAD_REQUEST', '請選擇異常類型');
  const description = String(payload.description || '').trim().slice(0, 500);
  if (!description) throw new AppError('BAD_REQUEST', '請填寫說明');
  const main = findAssetRows_(type, payload.key)[0];
  const key = assetKey(type, main);
  if (assetStatus(main) === '報廢') throw new AppError('BAD_REQUEST', '這件已報廢，不能登記異常');

  const sh = caseSheet_();
  const all = readRows_(sh);
  const now = new Date();
  const nowText = now_();
  const id = nextCaseId(all.map(function (r) { return r['案件編號']; }), Utilities.formatDate(now, TZ, 'yyyyMMdd'));
  const source = CASE_SOURCES.indexOf(payload.source) !== -1 ? payload.source : '現場';
  const row = stampNew({
    '案件編號': id, '類型': type, '資產鍵': key, '異常類型': payload.caseType, '來源': source,
    '來源編號': String(payload.sourceId || '').slice(0, 50), '說明': description, '登記人': actor.email, '登記時間': nowText,
    '狀態': CASE_OPEN, '處理結果': '', '結案人': '', '結案時間': '', '結案說明': '',
  }, actor.email, nowText);
  appendRow_(sh, row);

  const next = statusAfterCaseOpen(main['狀態']);
  const changed = next ? setAssetStatus_(type, main, next, actor, nowText) : { before: {}, after: {} };
  writeLog_(actor, '登記異常', t.label, key, changed.before,
    Object.assign({ 案件編號: id, 異常類型: payload.caseType, 來源: source }, changed.after), description);
  return publicRow_(row);
}

/**
 * 結案（只有 Super）。payload：{ id, version, result, note }。
 * 結果報廢→資產報廢；否則沒有其他處理中案件時停借→在庫。
 */
function caseClose_(payload, actor) {
  if (CASE_RESULTS.indexOf(payload.result) === -1) throw new AppError('BAD_REQUEST', '請選擇處理結果');
  const sh = caseSheet_();
  const all = readRows_(sh);
  const rec = all.find(function (r) { return r['案件編號'] === payload.id; });
  if (!rec) throw new AppError('NOT_FOUND', '找不到這個案件');
  if (!isCaseOpen(rec)) throw new AppError('BAD_REQUEST', '這個案件已經結案');
  const conflict = checkVersion(rec, payload.version);
  if (conflict) throw new AppError('VERSION_CONFLICT', undefined, conflict);

  const nowText = now_();
  const note = String(payload.note || '').trim().slice(0, 500);
  const result = applyChanges(rec, {
    '狀態': CASE_CLOSED, '處理結果': payload.result, '結案人': actor.email, '結案時間': nowText, '結案說明': note,
  }, ['狀態', '處理結果', '結案人', '結案時間', '結案說明'], actor.email, nowText);
  writeRow_(sh, rec._row, result.row);

  const type = rec['類型'];
  const main = findAssetRows_(type, rec['資產鍵'])[0];
  const otherOpen = all.filter(function (r) {
    return r['案件編號'] !== rec['案件編號'] && r['類型'] === type && r['資產鍵'] === rec['資產鍵'] && isCaseOpen(r);
  }).length;
  const next = statusAfterCaseClose(payload.result, assetStatus(main), otherOpen);
  const changed = next ? setAssetStatus_(type, main, next, actor, nowText) : { before: {}, after: {} };
  writeLog_(actor, '結案異常', importTarget_(type).label, rec['資產鍵'], Object.assign({ 案件編號: rec['案件編號'] }, changed.before),
    Object.assign({ 處理結果: payload.result, 其他處理中案件: otherOpen }, changed.after), note);
  return publicRow_(result.row);
}
