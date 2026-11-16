const test = require('node:test');
const assert = require('node:assert');
const L = require('./loan.js');

const GOOD = {
  '借用人姓名': ' 王小明 ', '學號或職號': 'B1234567', '系所單位': '資工系', '手機': '0912-345678', 'Email': 'a@b.edu.tw',
  '用途': '專題', '使用地點': '301 教室', '預計借出日': '2026/11/20', '預計歸還日': '2026-11-27', items: ['I000001', 'i000001', 'I000002', 'x'],
};

test('借用單號同一天接續', () => {
  assert.strictEqual(L.nextLoanId([], '20261116'), 'L20261116-01');
  assert.strictEqual(L.nextLoanId(['L20261116-07', 'L20261115-20'], '20261116'), 'L20261116-08');
});

test('日期正規化', () => {
  assert.strictEqual(L.normalizeDate('2026/1/5'), '2026-01-05');
  assert.strictEqual(L.normalizeDate('2026-02-30'), '');
  assert.strictEqual(L.normalizeDate('abc'), '');
  assert.strictEqual(L.daysBetween('2026-11-20', '2026-11-27'), 7);
});

test('申請檢查：正常內容整理後通過，物品去重並忽略不合法 ID', () => {
  const r = L.validateLoanRequest(GOOD, '2026-11-16');
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.data['借用人姓名'], '王小明');
  assert.strictEqual(r.data['預計借出日'], '2026-11-20');
  assert.deepStrictEqual(r.items, ['I000001', 'I000002']);
});

test('申請檢查：缺欄位、格式、日期、件數', () => {
  const bad = Object.assign({}, GOOD, { '借用人姓名': '', '手機': '12', 'Email': 'nope', '學號或職號': 'b-1', '預計借出日': '2026-11-10', items: [] });
  const r = L.validateLoanRequest(bad, '2026-11-16');
  ['請填寫借用人姓名', '手機格式不正確（例：0912345678）', 'Email 格式不正確', '學號或職號只能是英數字', '預計借出日不能早於今天', '請至少選一件物品']
    .forEach((m) => assert.ok(r.errors.indexOf(m) !== -1, m));
  assert.ok(L.validateLoanRequest(Object.assign({}, GOOD, { '預計歸還日': '2026-11-19' }), '2026-11-16').errors.indexOf('預計歸還日不能早於借出日') !== -1);
  assert.ok(L.validateLoanRequest(Object.assign({}, GOOD, { '預計歸還日': '2027-03-01' }), '2026-11-16').errors.indexOf('借用最多 90 天') !== -1);
  const many = Object.assign({}, GOOD, { items: Array.from({ length: 21 }, (_, i) => 'I' + ('000000' + (i + 1)).slice(-6)) });
  assert.ok(L.validateLoanRequest(many, '2026-11-16').errors.indexOf('一張借用單最多 20 件') !== -1);
});

test('給申請人看的借用單不含系統欄位', () => {
  const out = L.loanForApplicant({ '借用單號': 'L1', '狀態': '申請中', '申請時間': 't', '借用人姓名': '王', '建立者': 'x', '版本': '1', '已遮蔽': '' },
    [{ '明細編號': 'D1', '系所內部編號': 'CB-001', '名稱': 'Chromebook', '狀態': '申請中', '借出經手人': 'admin@x' }]);
  assert.strictEqual(out['建立者'], undefined);
  assert.strictEqual(out.details[0]['系所編號'], 'CB-001');
  assert.strictEqual(out.details[0]['借出經手人'], undefined);
});

test('防機器人：隱藏欄位有值、填太快、沒有時間都擋', () => {
  assert.strictEqual(L.botCheck({ hp: '', elapsed: 30 }), '');
  assert.ok(L.botCheck({ hp: 'http://spam', elapsed: 30 }));
  assert.ok(L.botCheck({ hp: '', elapsed: 2 }));
  assert.ok(L.botCheck({}));
});

test('頻率：全系統、同聯絡方式、同手機申請中', () => {
  assert.strictEqual(L.rateCheck({ contact: 2, global: 29, openPhone: 2 }), '');
  assert.match(L.rateCheck({ global: 30 }), /太多/);
  assert.match(L.rateCheck({ contact: 3 }), /一小時內最多送出 3 張/);
  assert.match(L.rateCheck({ openPhone: 3 }), /3 張申請中/);
});

test('申請中逾期作廢與天數', () => {
  const loan = { '狀態': '申請中', '申請時間': '2026-11-01 10:00:00' };
  assert.strictEqual(L.isApplicationExpired(loan, '2026-11-08', '7'), false);
  assert.strictEqual(L.isApplicationExpired(loan, '2026-11-09', '7'), true);
  assert.strictEqual(L.isApplicationExpired(Object.assign({}, loan, { '狀態': '借出中' }), '2026-12-01', '7'), false);
  assert.strictEqual(L.isApplicationExpired(loan, '2026-12-01', ''), false);
  assert.strictEqual(L.applicationAgeDays(loan, '2026-11-04'), 3);
  assert.strictEqual(L.applicationAgeDays({ '狀態': '已歸還' }, '2026-11-04'), -1);
});

test('通知對象：經管人＋設定信箱；都沒有才通知 Super', () => {
  assert.deepStrictEqual(L.loanNotifyRecipients([{ '經管人': 'A@x.tw' }, { '經管人': 'a@x.tw' }, { '經管人': '' }], 'b@x.tw、bad', ['s@x.tw']), ['a@x.tw', 'b@x.tw']);
  assert.deepStrictEqual(L.loanNotifyRecipients([{ '經管人': '' }], '', ['S@x.tw']), ['s@x.tw']);
  assert.deepStrictEqual(L.loanNotifyRecipients([], '', []), []);
});

test('通知信內容含單號、借用人、物品', () => {
  const m = L.loanMailContent({ '借用單號': 'L1', '借用人姓名': '王', '學號或職號': 'B1', '系所單位': '資工', '手機': '09', 'Email': 'w@x', '用途': 'u', '使用地點': 'p', '預計借出日': 'a', '預計歸還日': 'b' },
    [{ '系所內部編號': 'CB-001', '名稱': 'Chromebook' }], 'https://x/');
  assert.strictEqual(m.subject, '[借用申請] L1 1 件');
  assert.ok(m.body.indexOf('CB-001 Chromebook') !== -1 && m.body.indexOf('https://x/') !== -1);
});

test('借出檢查：每筆都要處理、核對、兩張照片；不借的略過；至少一件；不可重複', () => {
  const details = [{ '明細編號': 'D1', '系所內部編號': 'CB-001' }, { '明細編號': 'D2', '系所內部編號': 'CB-002' }];
  assert.deepStrictEqual(L.checkoutErrors(details, [
    { detailId: 'D1', itemId: 'I1', verified: true, photoCount: 2 }, { detailId: 'D2', itemId: '', verified: false, photoCount: 0 },
  ]), []);
  const e = L.checkoutErrors(details, [{ detailId: 'D1', itemId: 'I1', verified: false, photoCount: 1 }]);
  assert.deepStrictEqual(e, ['CB-001：尚未核對實物（掃 QR 或勾選）', 'CB-001：借出照片至少 2 張', 'CB-002：沒有處理']);
  assert.ok(L.checkoutErrors(details, [{ detailId: 'D1', itemId: '' }, { detailId: 'D2', itemId: '' }]).indexOf('至少要借出一件') !== -1);
  assert.ok(L.checkoutErrors(details, [{ detailId: 'D1', itemId: 'I1', verified: true, photoCount: 2 }, { detailId: 'D2', itemId: 'I1', verified: true, photoCount: 2 }])
    .indexOf('CB-002：同一件物品重複') !== -1);
});

test('歸還檢查：可分批、還錯件擋、照片、狀況與說明', () => {
  const out = [{ '明細編號': 'D1', '系所內部編號': 'CB-001' }, { '明細編號': 'D2', '系所內部編號': 'CB-002' }];
  assert.deepStrictEqual(L.returnErrors(out, [{ detailId: 'D1', verified: true, photoCount: 2, condition: '正常' }]), []);
  assert.deepStrictEqual(L.returnErrors(out, [{ detailId: 'D9', verified: true, photoCount: 2, condition: '正常' }]), ['D9：不在這張單的借出中物品（還錯件或已歸還）']);
  assert.deepStrictEqual(L.returnErrors(out, [{ detailId: 'D2', verified: false, photoCount: 1, condition: '損壞', note: '' }]),
    ['CB-002：尚未核對實物（掃 QR 或勾選）', 'CB-002：歸還照片至少 2 張', 'CB-002：狀況不是正常，請填說明']);
  assert.deepStrictEqual(L.returnErrors(out, []), ['請至少勾選一件歸還']);
  assert.strictEqual(L.statusAfterReturn(0), '在庫');
  assert.strictEqual(L.statusAfterReturn(1), '停借');
});

test('首頁提醒：申請中超過 3 天、逾期未還', () => {
  const loans = [
    { '借用單號': 'A', '狀態': '申請中', '申請時間': '2026-11-10 09:00:00' },
    { '借用單號': 'B', '狀態': '申請中', '申請時間': '2026-11-14 09:00:00' },
    { '借用單號': 'C', '狀態': '借出中', '預計歸還日': '2026-11-16' },
    { '借用單號': 'D', '狀態': '借出中', '預計歸還日': '2026-11-17' },
    { '借用單號': 'E', '狀態': '已歸還', '預計歸還日': '2026-11-01' },
  ];
  const r = L.loanReminders(loans, '2026-11-17', '3');
  assert.deepStrictEqual(r.stale.map((x) => [x.loan['借用單號'], x.days]), [['A', 7]]);
  assert.deepStrictEqual(r.overdue.map((x) => [x.loan['借用單號'], x.days]), [['C', 1]]);
  assert.strictEqual(L.isLoanOverdue(loans[3], '2026-11-17'), false);
});
