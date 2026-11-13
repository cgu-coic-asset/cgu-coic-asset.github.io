/**
 * 系所物品（可借用的單件）：建立、從保管品建立多件、批次編號，以及和保管品的對照。
 * 編號規則見 shared/item.js；名稱、規格等一般修改走 Asset.js 的 assetUpdate_／assetAssign_。
 */

function itemSheet_() {
  return schemaSheet_('ITEM', '物品');
}

/** 連結保管品的物品補上保管品的材料編號、保管人、部門與品名（以學校清冊為準）。 */
function joinItemsWithCustody_(rows) {
  const custody = {};
  readRows_(sheet_('CUSTODY', '保管品')).forEach(function (c) { custody[c['保管品鍵']] = c; });
  return rows.map(function (r) {
    const c = r['保管品鍵'] ? custody[r['保管品鍵']] : null;
    if (!c) return r;
    return Object.assign({}, r, {
      '材料編號': c['材料編號'], '保管品名稱': c['品名規格'], '保管人代號': c['保管人代號'], '保管人姓名': c['保管人姓名'],
      '部門代號': c['部門代號'] || r['部門代號'],
    });
  });
}

function itemsOfCustody_(key) {
  return readRows_(itemSheet_()).filter(function (r) { return r['保管品鍵'] === key; }).map(publicRow_);
}

/** 各保管品的單件統計：{ 保管品鍵: { 件數, 借出, 在庫 } }（報廢不算）。 */
function itemStatsByCustody_() {
  const out = {};
  readRows_(itemSheet_()).forEach(function (r) {
    if (!r['保管品鍵'] || assetStatus(r) === '報廢') return;
    const s = out[r['保管品鍵']] || (out[r['保管品鍵']] = { 件數: 0, 借出: 0, 在庫: 0 });
    s['件數']++;
    if (assetStatus(r) === '借出') s['借出']++;
    if (assetStatus(r) === '在庫') s['在庫']++;
  });
  return out;
}

/** 修改系所物品時檢查：系所編號格式與不重複、名稱不可空白。 */
function validateItemChanges_(changes, all, current) {
  if (changes['系所編號'] !== undefined) {
    const code = normalizeItemCode(changes['系所編號']);
    if (code === null) throw new AppError('BAD_REQUEST', '系所編號格式應為「前綴-號碼」，例如 COIC-001、NX2-008');
    if (code && all.some(function (r) { return r !== current && r['系所編號'] === code; })) {
      throw new AppError('DUPLICATE', '系所編號 ' + code + ' 已經有人用了');
    }
    changes['系所編號'] = code;
  }
  if (changes['名稱'] !== undefined && !String(changes['名稱']).trim()) throw new AppError('BAD_REQUEST', '名稱不可空白');
}

/**
 * 依定義建立多筆新物品（只產生資料列，不寫入）。
 * defs：[{ 系所編號, 名稱, 規格, 保管品鍵, 部門代號, 目前位置, 經管人, 開放借用, 備註 }]。
 */
function buildItems_(defs, all, actor, nowText) {
  const custody = {};
  readRows_(sheet_('CUSTODY', '保管品')).forEach(function (c) { custody[c['保管品鍵']] = c; });
  const usedCodes = all.map(function (r) { return r['系所編號']; }).filter(Boolean);
  const ids = all.map(function (r) { return r['物品ID']; });
  const linked = {};
  all.forEach(function (r) {
    if (r['保管品鍵'] && assetStatus(r) !== '報廢') linked[r['保管品鍵']] = (linked[r['保管品鍵']] || 0) + 1;
  });
  const defaultDept = setting_('部門代號');

  return defs.map(function (d, i) {
    const code = normalizeItemCode(d['系所編號']);
    if (code === null) throw new AppError('BAD_REQUEST', '第 ' + (i + 1) + ' 筆系所編號格式不對：' + d['系所編號']);
    if (code && usedCodes.indexOf(code) !== -1) throw new AppError('DUPLICATE', '系所編號 ' + code + ' 已經有人用了');
    if (code) usedCodes.push(code);

    const key = String(d['保管品鍵'] || '').trim();
    const c = key ? custody[key] : null;
    if (key && !c) throw new AppError('NOT_FOUND', '找不到保管品 ' + key);
    if (c) {
      linked[key] = (linked[key] || 0) + 1;
      const book = Number(c['帳面數量']);
      if (!isNaN(book) && linked[key] > book) {
        throw new AppError('BAD_REQUEST', '保管品 ' + key + ' 帳面數量 ' + book + '，單件不能超過這個數');
      }
    }
    const name = String(d['名稱'] || (c ? c['品名規格'] : '') || '').trim();
    if (!name) throw new AppError('BAD_REQUEST', '第 ' + (i + 1) + ' 筆沒有名稱');
    const manager = normalizeEmail(d['經管人'] || (c ? c['經管人'] : '') || '');
    if (manager) validateAssetChanges_({ '經管人': manager });

    const id = nextItemId(ids);
    ids.push(id);
    return stampNew({
      '物品ID': id, '系所編號': code, '名稱': name, '規格': String(d['規格'] || '').trim(), '保管品鍵': key,
      '部門代號': c ? c['部門代號'] : (String(d['部門代號'] || '').trim().toUpperCase() || defaultDept),
      '狀態': '在庫', '開放借用': d['開放借用'] === '否' ? '否' : '是', '經管人': manager,
      '目前位置': String(d['目前位置'] || (c ? currentLocation(c) : '') || '').trim(), '備註': String(d['備註'] || ''),
    }, actor.email, nowText);
  });
}

function saveNewItems_(sh, all, rows, actor, reason) {
  writeAllRows_(sh, all, rows);
  writeLogs_(actor, rows.map(function (r) {
    return {
      action: '新增系所物品', objectType: '系所物品', key: r['物品ID'], before: '',
      after: { 系所編號: r['系所編號'], 名稱: r['名稱'], 保管品鍵: r['保管品鍵'] },
    };
  }), reason, '網頁');
  return joinItemsWithCustody_(rows.map(publicRow_));
}

/** 逐筆建立（既有紙本編號、無帳物品）。payload：{ items: [定義…], reason }。 */
function itemCreate_(payload, actor) {
  const defs = payload.items || [];
  if (!defs.length) throw new AppError('BAD_REQUEST', '沒有要建立的物品');
  if (defs.length > 500) throw new AppError('BAD_REQUEST', '一次最多建立 500 件');
  const sh = itemSheet_();
  const all = readRows_(sh);
  return saveNewItems_(sh, all, buildItems_(defs, all, actor, now_()), actor, payload.reason);
}

/** 從保管品建立多件。payload：{ key（保管品鍵）, count, prefix（選填，有填就一併編號） }。 */
function itemFromCustody_(payload, actor) {
  const count = parseInt(payload.count, 10);
  if (!(count >= 1 && count <= 500)) throw new AppError('BAD_REQUEST', '件數要在 1～500 之間');
  const sh = itemSheet_();
  const all = readRows_(sh);
  let codes = [];
  if (payload.prefix) {
    const prefix = normalizeItemPrefix(payload.prefix);
    if (!prefix) throw new AppError('BAD_REQUEST', '前綴只能是英文字母或數字（1～10 字）');
    codes = nextItemCodes(all.map(function (r) { return r['系所編號']; }), prefix, count);
  }
  const defs = [];
  for (let i = 0; i < count; i++) defs.push({ '保管品鍵': payload.key, '系所編號': codes[i] || '' });
  return saveNewItems_(sh, all, buildItems_(defs, all, actor, now_()), actor, payload.reason || '從保管品建立單件');
}

/**
 * 批次編號：依勾選順序給「前綴-三位數」，前綴已用過就接續最大號。
 * payload：{ items: [{ rowKey（物品ID）, version }], prefix }。
 */
function itemNumber_(payload, actor) {
  const prefix = normalizeItemPrefix(payload.prefix);
  if (!prefix) throw new AppError('BAD_REQUEST', '前綴只能是英文字母或數字（1～10 字）');
  const items = payload.items || [];
  if (!items.length) throw new AppError('BAD_REQUEST', '請先勾選物品');

  const sh = itemSheet_();
  const all = readRows_(sh);
  const byId = {};
  all.forEach(function (r) { byId[r['物品ID']] = r; });
  const conflicts = items.filter(function (it) { return !byId[it.rowKey] || checkVersion(byId[it.rowKey], it.version); });
  if (conflicts.length) throw new AppError('VERSION_CONFLICT', conflicts.length + ' 筆資料剛被修改過，請重新整理後再編號');

  const codes = nextItemCodes(all.map(function (r) { return r['系所編號']; }), prefix, items.length);
  const nowText = now_();
  const logs = [];
  items.forEach(function (it, i) {
    const row = byId[it.rowKey];
    const result = applyChanges(row, { '系所編號': codes[i] }, ['系所編號'], actor.email, nowText);
    Object.assign(row, result.row);
    logs.push({ action: '批次編號', objectType: '系所物品', key: it.rowKey, before: result.before, after: result.after });
  });
  writeAllRows_(sh, all, []);
  writeLogs_(actor, logs, payload.reason || '批次編號：' + prefix, '網頁');
  return { codes: codes };
}
