/**
 * 借用 B：固定資產借用與送修紀錄。規則見 shared/fixedRecord.js。
 * Admin、Super 全部；User 只限自己名下。每次新增、修改、歸還自動寫 LOG（不需原因）。
 * 系所物品借用（借用 A）連結的固定資產，借出、歸還時由 Loan.js 呼叫這裡自動寫紀錄。
 */

function recordSheet_() {
  return schemaSheet_('OPS', '固定資產紀錄');
}

function fixedMainForRecord_(key, actor) {
  const main = findAssetRows_('FIXED', key)[0];
  if (!canEditFixedRecord(actor.role, actor.codes, main)) throw new AppError('FORBIDDEN', '只能處理自己名下的固定資產');
  return main;
}

/** payload：{ key }。回傳資產摘要與紀錄（新到舊）。 */
function fixedRecords_(payload, actor) {
  const main = fixedMainForRecord_(payload.key, actor);
  const records = readRows_(recordSheet_()).filter(function (r) { return r['資產編號'] === main['資產編號']; }).map(publicRow_).reverse();
  return {
    asset: { 資產編號: main['資產編號'], 名稱: assetName('FIXED', main), 廠牌規格: main['廠牌規格'], 配件: main['配件'] || '',
      狀態: assetStatus(main), 保管人: main['保管人姓名'] || main['保管人代號'], 版本: main['版本'] },
    records: records,
  };
}

/** 新增借用或送修。payload：紀錄欄位（含 事件）＋ key。資產須在庫。 */
function fixedRecordAdd_(payload, actor) {
  const main = fixedMainForRecord_(payload.key, actor);
  const v = validateFixedRecord(payload, true);
  if (v.errors.length) throw new AppError('BAD_REQUEST', v.errors.join('；'), { errors: v.errors });
  if (assetStatus(main) !== '在庫') throw new AppError('BAD_REQUEST', '這件目前' + assetStatus(main) + '，要在庫才能' + v.data['事件']);
  const nowText = now_();
  const row = appendFixedRecord_(main, v.data, FR_SOURCE_MANUAL, '', actor, nowText);
  const st = applyChanges(main, { '狀態': statusForEvent(v.data['事件']) }, ['狀態'], actor.email, nowText);
  writeRow_(targetSheet_(importTarget_('FIXED')), main._row, st.row);
  writeLog_(actor, '新增' + v.data['事件'] + '紀錄', '固定資產', main['資產編號'], st.before,
    Object.assign({ 紀錄編號: row['紀錄編號'] }, v.data, st.after));
  return publicRow_(row);
}

function appendFixedRecord_(main, data, source, sourceId, actor, nowText) {
  const sh = recordSheet_();
  const id = nextRecordId(readRows_(sh).map(function (r) { return r['紀錄編號']; }), Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'));
  const row = stampNew(Object.assign({}, data, {
    '紀錄編號': id, '資產編號': main['資產編號'], '狀態': FR_OPEN, '歸還日期': '', '歸還經辦': '', '歸還狀況': '', '歸還說明': '',
    '來源': source, '來源編號': sourceId || '', '簽核單': '',
  }), actor.email || '系統', nowText);
  appendRow_(sh, row);
  return row;
}

function findRecord_(id) {
  const rec = readRows_(recordSheet_()).find(function (r) { return r['紀錄編號'] === id; });
  if (!rec) throw new AppError('NOT_FOUND', '找不到這筆紀錄');
  return rec;
}

/** 修改進行中的紀錄。payload：{ id, version, changes }。 */
function fixedRecordUpdate_(payload, actor) {
  const rec = findRecord_(payload.id);
  fixedMainForRecord_(rec['資產編號'], actor);
  if (rec['狀態'] !== FR_OPEN) throw new AppError('BAD_REQUEST', '已歸還的紀錄不能修改');
  const conflict = checkVersion(rec, payload.version);
  if (conflict) throw new AppError('VERSION_CONFLICT', undefined, conflict);
  const merged = Object.assign({}, rec, payload.changes || {}, { '事件': rec['事件'] });
  const v = validateFixedRecord(merged, false);
  if (v.errors.length) throw new AppError('BAD_REQUEST', v.errors.join('；'), { errors: v.errors });
  const r = applyChanges(rec, v.data, FR_EDITABLE, actor.email, now_());
  if (!r.changed) return publicRow_(rec);
  writeRow_(recordSheet_(), rec._row, r.row);
  writeLog_(actor, '修改' + rec['事件'] + '紀錄', '固定資產', rec['資產編號'], r.before, Object.assign({ 紀錄編號: rec['紀錄編號'] }, r.after));
  return publicRow_(r.row);
}

/**
 * 結束（歸還、送修回來）。資產回在庫（有處理中案件則停借）；故障自動登記異常（損壞）。
 * 系所物品借用產生的紀錄要從借用單歸還。
 */
function fixedRecordReturn_(payload, actor) {
  const rec = findRecord_(payload.id);
  const main = fixedMainForRecord_(rec['資產編號'], actor);
  if (rec['來源'] === FR_SOURCE_LOAN_A) throw new AppError('BAD_REQUEST', '這筆由系所物品借用單產生，請在借用單 ' + String(rec['來源編號']).replace(/-\d+$/, '') + ' 歸還');
  if (rec['狀態'] !== FR_OPEN) throw new AppError('BAD_REQUEST', '這筆紀錄已經歸還');
  const conflict = checkVersion(rec, payload.version);
  if (conflict) throw new AppError('VERSION_CONFLICT', undefined, conflict);
  const v = validateFixedReturn(payload, rec['預計開始']);
  if (v.errors.length) throw new AppError('BAD_REQUEST', v.errors.join('；'), { errors: v.errors });
  closeFixedRecord_(rec, main, v.data, actor);
  if (v.data['歸還狀況'] === '故障') {
    caseOpen_({ type: 'FIXED', key: main['資產編號'], caseType: '損壞', description: rec['事件'] + '歸還時故障：' + v.data['歸還說明'],
      source: '借還', sourceId: rec['紀錄編號'] }, actor);
  }
  return publicRow_(findRecord_(payload.id));
}

function closeFixedRecord_(rec, main, data, actor) {
  const nowText = now_();
  const r = applyChanges(rec, Object.assign({ '狀態': FR_CLOSED }, data), ['狀態', '歸還日期', '歸還經辦', '歸還狀況', '歸還說明'], actor.email || '系統', nowText);
  writeRow_(recordSheet_(), rec._row, r.row);
  const expected = statusForEvent(rec['事件']);
  let st = { before: {}, after: {} };
  if (assetStatus(main) === expected) {
    const open = openCaseCountsAll_()['FIXED:' + main['資產編號']];
    st = applyChanges(main, { '狀態': statusAfterReturn(open) }, ['狀態'], actor.email || '系統', nowText);
    writeRow_(targetSheet_(importTarget_('FIXED')), main._row, st.row);
  }
  writeLog_(actor, rec['事件'] + '歸還', '固定資產', rec['資產編號'], st.before, Object.assign({ 紀錄編號: rec['紀錄編號'] }, r.after, st.after));
}

/** 借用 A 借出連結固定資產的系所物品時寫一列（狀態由 Loan.js 改）。 */
function addLoanARecord_(fixedRow, loan, detail, actor, nowText) {
  return appendFixedRecord_(fixedRow, {
    '事件': '借用', '借用部門或廠商': loan['系所單位'], '原因': '其他', '地點': '校內',
    '預計開始': loan['預計借出日'], '預計結束': loan['預計歸還日'], '借用人': loan['借用人姓名'] + '（' + loan['學號或職號'] + '）',
    '經辦': actor.name || actor.email, '備註': '系所物品 ' + (detail['系所內部編號'] || detail['資產鍵']) + '；借用單 ' + loan['借用單號'] + '；用途 ' + loan['用途'],
  }, FR_SOURCE_LOAN_A, detail['明細編號'], actor, nowText);
}

/** 借用 A 歸還時關閉對應紀錄（資產狀態由 Loan.js 改）。condition：借用 A 的歸還狀況。 */
function closeLoanARecord_(detailId, condition, note, actor, nowText) {
  const sh = recordSheet_();
  const rec = readRows_(sh).find(function (r) { return r['來源'] === FR_SOURCE_LOAN_A && r['來源編號'] === detailId && r['狀態'] === FR_OPEN; });
  if (!rec) return;
  const bad = condition !== '正常';
  const r = applyChanges(rec, { '狀態': FR_CLOSED, '歸還日期': nowText.slice(0, 10), '歸還經辦': actor.name || actor.email,
    '歸還狀況': bad ? '故障' : '正常', '歸還說明': bad ? condition + '：' + note : '' },
    ['狀態', '歸還日期', '歸還經辦', '歸還狀況', '歸還說明'], actor.email, nowText);
  writeRow_(sh, rec._row, r.row);
}
