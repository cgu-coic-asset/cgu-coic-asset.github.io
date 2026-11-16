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
