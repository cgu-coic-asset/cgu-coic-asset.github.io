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
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const v = validateLoanRequest(payload, today);
  if (!v.ok) throw new AppError('BAD_REQUEST', v.errors.join('；'), { errors: v.errors });

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
  return { loan: loanForApplicant(loan, details), unit: setting_('單位名稱') };
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
