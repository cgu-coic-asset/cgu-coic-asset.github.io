/**
 * Excel 匯入：前端讀檔、預覽；後端重新整理與比對一次，和預覽一致才寫入。
 * 規則見 shared/importTemplate.js、shared/importDiff.js 與 docs/匯入範本.md。
 */

const IMPORT_TARGETS = {
  FIXED: { book: 'FIXED', sheet: '資產', label: '固定資產', prefix: 'F' },
  CUSTODY: { book: 'CUSTODY', sheet: '保管品', label: '保管品', prefix: 'C' },
  ITEM: { book: 'ITEM', sheet: '物品', label: '系所物品', prefix: 'I' },
};

function importTarget_(type) {
  const t = IMPORT_TARGETS[type];
  if (!t) throw new AppError('BAD_REQUEST', '類型只能是 FIXED、CUSTODY 或 ITEM');
  return t;
}

/** 只有固定資產、保管品有學校清冊可匯入。 */
function importOnlyTarget_(type) {
  if (!IMPORT_TEMPLATES[type]) throw new AppError('BAD_REQUEST', '這個類型沒有匯入範本');
  return importTarget_(type);
}

/** 資產分頁；缺少新加的欄位時先補上，否則寫入時會被略過。 */
function targetSheet_(t) {
  return schemaSheet_(t.book, t.sheet);
}

/** 「設定」分頁的值；沒有就回傳空字串。 */
function setting_(key) {
  const row = findRow_(sheet_('SYSTEM', '設定'), '鍵', key);
  return row ? row['值'] : '';
}

/** 匯入前預覽用：現有資料（只給比對需要的欄位）、預設部門代號、最近的匯入批次。 */
function importCurrent_(payload) {
  const t = importOnlyTarget_(payload.type);
  const keep = IMPORT_TEMPLATES[payload.type].columns.map(function (c) { return c.name; })
    .concat(['保管品鍵', '版本', '來源狀態']);
  const rows = readRows_(sheet_(t.book, t.sheet)).map(function (r) {
    const o = {};
    keep.forEach(function (k) { if (r[k] !== undefined) o[k] = r[k]; });
    return o;
  });
  const batches = readRows_(sheet_(t.book, '匯入批次')).slice(-5).reverse().map(publicRow_);
  return { rows: rows, defaultDept: setting_('部門代號'), batches: batches };
}

/**
 * 寫入匯入結果。payload：{ type, fileName, fileBase64?, rows（檔案原始列）, signature（預覽時的差異簽章） }。
 */
function importCommit_(payload, actor) {
  const t = importOnlyTarget_(payload.type);
  if (!Array.isArray(payload.rows) || !payload.rows.length) throw new AppError('BAD_REQUEST', '檔案沒有資料');

  const parsed = parseImportRows(payload.type, payload.rows, { defaultDept: setting_('部門代號') });
  if (!parsed.records.length) throw new AppError('BAD_REQUEST', '沒有可以匯入的資料，請先修正錯誤');

  const sh = targetSheet_(t);
  const existing = readRows_(sh);
  const diff = diffImport(payload.type, parsed.records, parsed.fields, existing);
  if (diffSignature(diff) !== payload.signature) {
    throw new AppError('VERSION_CONFLICT', '預覽之後資料有變動（可能有人剛修改或匯入），請重新預覽');
  }
  const total = diff.added.length + diff.changed.length + diff.missing.length;
  if (!total) return { batchId: '', added: 0, changed: 0, missing: 0, unchanged: diff.unchanged };

  const nowText = now_();
  const batchId = t.prefix + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
  const fileName = String(payload.fileName || '').slice(0, 200);

  // 原始檔先存進「匯入檔」資料夾；存不成功就不寫資料
  if (payload.fileBase64) {
    const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_IMPORTS'));
    const blob = Utilities.newBlob(Utilities.base64Decode(payload.fileBase64),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', batchId + '_' + fileName);
    folder.createFile(blob);
  }

  const byKey = {};
  existing.forEach(function (r) { byKey[importRowKey(payload.type, r)] = r; });
  const stamp = function (row) {
    row['版本'] = nextVersion(row['版本']);
    row['修改時間'] = nowText;
    row['修改者'] = actor.email;
    row['最後匯入批次'] = batchId;
  };
  const logs = [];

  diff.changed.forEach(function (c) {
    const row = byKey[c.key];
    Object.keys(c.after).forEach(function (f) { row[f] = c.after[f]; });
    stamp(row);
    logs.push(['匯入變更', c.key, c.before, c.after]);
  });
  diff.missing.forEach(function (m) {
    const row = byKey[m.key];
    row['來源狀態'] = SOURCE_MISSING;
    stamp(row);
    logs.push(['匯入消失', m.key, { 來源狀態: SOURCE_OK }, { 來源狀態: SOURCE_MISSING }]);
  });
  const newRows = diff.added.map(function (r) {
    const row = stampNew(Object.assign({}, r, {
      '狀態': '在庫', '開放借用': '否', '來源狀態': SOURCE_OK, '最後匯入批次': batchId,
    }), actor.email, nowText);
    logs.push(['匯入新增', importRowKey(payload.type, r), '', r]);
    return row;
  });

  writeAllRows_(sh, existing, newRows);

  appendRow_(sheet_(t.book, '匯入批次'), {
    '批次編號': batchId, '匯入時間': nowText, '匯入者': actor.email, '來源檔名': fileName,
    '新增數': diff.added.length, '變更數': diff.changed.length, '消失數': diff.missing.length, '狀態': '完成',
  });
  writeLogs_(actor, [['匯入', batchId, '', {
    類型: t.label, 檔名: fileName, 範圍: diff.scope.join('、'),
    新增: diff.added.length, 變更: diff.changed.length, 消失: diff.missing.length, 未變: diff.unchanged,
  }]].concat(logs).map(function (l) {
    return { action: l[0], objectType: l[0] === '匯入' ? '匯入批次' : t.label, key: l[1], before: l[2], after: l[3] };
  }), payload.reason, '網頁');

  return {
    batchId: batchId, added: diff.added.length, changed: diff.changed.length, missing: diff.missing.length,
    unchanged: diff.unchanged,
  };
}

/** 一次寫回整張分頁（現有列依 _row 排序，新列接在後面），避免數千次逐列寫入。 */
function writeAllRows_(sh, existing, newRows) {
  const headers = headers_(sh);
  const toValues = function (obj) {
    return headers.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : String(obj[h]); });
  };
  const data = existing.slice().sort(function (a, b) { return a._row - b._row; }).map(toValues)
    .concat(newRows.map(toValues));
  if (!data.length) return;
  const needed = data.length + 1;
  if (sh.getMaxRows() < needed) sh.insertRowsAfter(sh.getMaxRows(), needed - sh.getMaxRows());
  sh.getRange(2, 1, data.length, headers.length).setNumberFormat('@').setValues(data);
}
