const test = require('node:test');
const assert = require('node:assert');
const { publicLoanStatus, publicAsset, representativePhoto, parseQrText } = require('./publicView.js');

const FIXED_ROW = {
  '資產編號': '0343360037', '增值次數': '0', '資產名稱': '筆記型電腦', '名稱修正': '', '廠牌規格': 'ASUS X515',
  '產品序號': 'SN123', '請購案號': 'P001', '部門代號': 'D000', '存放位置': '研究室 301', '目前位置': '',
  '保管人代號': 'A01', '保管人姓名': '王小明', '取得價值': '30000', '狀態': '在庫', '開放借用': '是',
  '經管人': 'admin@example.com', '備註': '內部備註', '版本': '3',
};

test('公開借用狀態', () => {
  assert.strictEqual(publicLoanStatus({ '開放借用': '是', '狀態': '在庫' }), '可借用');
  assert.strictEqual(publicLoanStatus({ '開放借用': '是', '狀態': '可借' }), '可借用');
  assert.strictEqual(publicLoanStatus({ '開放借用': '是', '狀態': '借出' }), '借出中');
  assert.strictEqual(publicLoanStatus({ '開放借用': '是', '狀態': '停借' }), '暫停借用');
  assert.strictEqual(publicLoanStatus({ '開放借用': '否', '狀態': '在庫' }), '不開放借用');
  assert.strictEqual(publicLoanStatus({ '狀態': '借出' }), '不開放借用');
});

test('固定資產：只帶公開欄位，不含保管人、位置、價值、序號、經管人、備註', () => {
  const p = publicAsset('FIXED', FIXED_ROW);
  assert.deepStrictEqual(Object.keys(p).sort(), ['code', 'key', 'label', 'lendable', 'loan', 'name', 'qr', 'spec', 'type'].sort());
  assert.deepStrictEqual(p, {
    type: 'FIXED', label: '固定資產', key: '0343360037', qr: 'F0343360037', code: '0343360037',
    name: '筆記型電腦', spec: 'ASUS X515', loan: '可借用', lendable: true,
  });
  const text = JSON.stringify(p);
  ['王小明', 'A01', '301', '30000', 'SN123', 'P001', 'admin@', '內部備註'].forEach((s) => assert.ok(text.indexOf(s) === -1, '外洩 ' + s));
});

test('固定資產：名稱修正優先', () => {
  const p = publicAsset('FIXED', Object.assign({}, FIXED_ROW, { '名稱修正': '筆記型電腦（修正）' }));
  assert.strictEqual(p.name, '筆記型電腦（修正）');
});

test('保管品：編號為材料編號、QR 用短碼、沒有規格', () => {
  const p = publicAsset('CUSTODY', {
    '保管品鍵': 'A01-5110010001', '材料編號': '5110010001', '品名規格': 'HDMI 線 2m', 'QR碼': '000123',
    '帳面數量': '10', '保管人姓名': '王小明', '開放借用': '否', '狀態': '',
  });
  assert.strictEqual(p.key, 'A01-5110010001');
  assert.strictEqual(p.qr, 'C000123');
  assert.strictEqual(p.code, '5110010001');
  assert.strictEqual(p.name, 'HDMI 線 2m');
  assert.strictEqual(p.spec, '');
  assert.strictEqual(p.loan, '不開放借用');
  assert.ok(JSON.stringify(p).indexOf('王小明') === -1);
});

test('系所物品：編號為系所編號，未編號為空字串', () => {
  const p = publicAsset('ITEM', { '物品ID': 'I000012', '系所編號': 'CB-001', '名稱': 'Chromebook', '規格': 'Lenovo 100e', '開放借用': '是', '狀態': '借出' });
  assert.strictEqual(p.qr, 'II000012');
  assert.strictEqual(p.code, 'CB-001');
  assert.strictEqual(p.spec, 'Lenovo 100e');
  assert.strictEqual(p.loan, '借出中');
  assert.strictEqual(p.lendable, false);
  assert.strictEqual(publicAsset('ITEM', { '物品ID': 'I000013', '名稱': 'x' }).code, '');
});

test('代表照片：最新的有效建檔照片；盤點與作廢不算', () => {
  const rows = [
    { '照片編號': 'P1', '用途': '建檔', '狀態': '有效', '上傳時間': '2026-11-01 10:00:00' },
    { '照片編號': 'P2', '用途': '盤點', '狀態': '有效', '上傳時間': '2026-11-05 10:00:00' },
    { '照片編號': 'P3', '用途': '建檔', '狀態': '作廢', '上傳時間': '2026-11-06 10:00:00' },
    { '照片編號': 'P4', '用途': '建檔', '狀態': '有效', '上傳時間': '2026-11-03 10:00:00' },
  ];
  assert.strictEqual(representativePhoto(rows)['照片編號'], 'P4');
  assert.strictEqual(representativePhoto([rows[1], rows[2]]), null);
  assert.strictEqual(representativePhoto([]), null);
});

test('QR 文字解析：貼紙網址', () => {
  assert.deepStrictEqual(parseQrText('https://cgu-coic-asset.github.io/?F0343360037'), { type: 'FIXED', key: '0343360037' });
  assert.deepStrictEqual(parseQrText('https://cgu-coic-asset.github.io/?C000123'), { type: 'CUSTODY', key: '000123' });
  assert.deepStrictEqual(parseQrText('https://cgu-coic-asset.github.io/?II000012'), { type: 'ITEM', key: 'I000012' });
  assert.deepStrictEqual(parseQrText('https://other.host/a/?CA01-5110010001'), { type: 'CUSTODY', key: 'A01-5110010001' });
  assert.deepStrictEqual(parseQrText('https://x/?CA01%2D5110010001#frag'), { type: 'CUSTODY', key: 'A01-5110010001' });
  assert.strictEqual(parseQrText('https://cgu-coic-asset.github.io/?X123'), null);
});

test('QR 文字解析：手動輸入編號', () => {
  assert.deepStrictEqual(parseQrText(' 000123 '), { type: 'CUSTODY', key: '000123' });
  assert.deepStrictEqual(parseQrText('i000012'), { type: 'ITEM', key: 'I000012' });
  assert.deepStrictEqual(parseQrText('cb-001'), { type: 'ITEM', key: 'CB-001' });
  assert.deepStrictEqual(parseQrText('0343360037'), { type: 'FIXED', key: '0343360037' });
  assert.strictEqual(parseQrText('hello world'), null);
  assert.strictEqual(parseQrText(''), null);
});
