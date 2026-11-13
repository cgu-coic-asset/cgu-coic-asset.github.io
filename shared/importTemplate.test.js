const test = require('node:test');
const assert = require('node:assert');
const {
  IMPORT_TEMPLATES, mapImportHeaders, normalizeImportDate, normalizeImportNumber, custodyKey, parseImportRows,
} = require('./importTemplate.js');

const errors = (r) => r.issues.filter((i) => i.level === 'error');
const warnings = (r) => r.issues.filter((i) => i.level === 'warning');

test('日期轉成 YYYYMMDD', () => {
  assert.strictEqual(normalizeImportDate(20230919), '20230919');
  assert.strictEqual(normalizeImportDate('20230919.0'), '20230919');
  assert.strictEqual(normalizeImportDate('2023/9/19'), '20230919');
  assert.strictEqual(normalizeImportDate('2023-09-19'), '20230919');
  assert.strictEqual(normalizeImportDate(new Date(2023, 8, 19)), '20230919');
  assert.strictEqual(normalizeImportDate(''), '');
  assert.strictEqual(normalizeImportDate('20230231'), null);
  assert.strictEqual(normalizeImportDate('112/09/19'), null);
});

test('數字去千分位與多餘小數', () => {
  assert.strictEqual(normalizeImportNumber('3.0'), '3');
  assert.strictEqual(normalizeImportNumber('35,000'), '35000');
  assert.strictEqual(normalizeImportNumber(2.5), '2.5');
  assert.strictEqual(normalizeImportNumber('三'), null);
});

test('標題可用別名、忽略空白，認不得的列出來', () => {
  const r = mapImportHeaders('CUSTODY', ['保管部門', ' 材料 編號', '保管量', '最後異動日', '項次']);
  assert.deepStrictEqual(r.map, { 保管部門: '部門代號', ' 材料 編號': '材料編號', 保管量: '帳面數量', 最後異動日: '來源最後異動日' });
  assert.deepStrictEqual(r.unknown, ['項次']);
});

test('範本欄名都在試算表欄位裡', () => {
  // 與 gas/Schema.js 的「資產」「保管品」分頁對照；改欄名時兩邊要一起改
  const fixed = ['資產編號', '增值次數', '資產名稱', '廠牌規格', '產品序號', '部門代號', '存放位置', '保管人代號',
    '保管人姓名', '驗收取得日', '取得價值', '耐用年數', '保固期限', '研究計劃編號', '請購案號'];
  const custody = ['保管品鍵', '材料編號', '品名規格', '單位', '帳面數量', '部門代號', '保管人代號', '保管人姓名', '來源最後異動日'];
  IMPORT_TEMPLATES.FIXED.columns.forEach((c) => assert.ok(fixed.includes(c.name), c.name));
  IMPORT_TEMPLATES.CUSTODY.columns.forEach((c) => assert.ok(custody.includes(c.name), c.name));
});

test('固定資產：標準範本一列', () => {
  const r = parseImportRows('FIXED', [{
    資產編號: '0399999901', 增值次數: '0', 資產名稱: '筆記型電腦', 部門代號: 'd000', 保管人代號: 'D000000001',
    保管人姓名: '王小明', 驗收取得日: '20240115', 耐用年數: '3', 取得價值: '35,000',
  }]);
  assert.deepStrictEqual(r.issues, []);
  assert.strictEqual(r.records[0]['資產編號'], '0399999901');
  assert.strictEqual(r.records[0]['部門代號'], 'D000');
  assert.strictEqual(r.records[0]['取得價值'], '35000');
  assert.strictEqual(r.records[0]._row, 2);
});

test('固定資產：舊版 AI 轉出的 Excel 也能對應', () => {
  const r = parseImportRows('FIXED', [{
    ID: 1, 類別: '', 資產編號: '351360284', 資產名稱: '互動式觸控顯示器', 廠牌規格: 'BENQ RM7503', 存放位置: '管理大樓14樓',
    保管人: 'D000000256 馮建凱', 產品序號: 'Q40AG30001', 驗收取得日: 20230919.0, 保固期限: 20240918.0, 耐用年數: 5.0,
  }], { defaultDept: 'D000' });
  assert.deepStrictEqual(errors(r), []);
  const rec = r.records[0];
  assert.strictEqual(rec['資產編號'], '0351360284');
  assert.strictEqual(rec['增值次數'], '0');
  assert.strictEqual(rec['部門代號'], 'D000');
  assert.strictEqual(rec['保管人代號'], 'D000000256');
  assert.strictEqual(rec['保管人姓名'], '馮建凱');
  assert.strictEqual(rec['驗收取得日'], '20230919');
  assert.strictEqual(rec['耐用年數'], '5');
  assert.deepStrictEqual(warnings(r).map((i) => i.field), ['資產編號']);
  assert.deepStrictEqual(r.unknownColumns, ['ID', '類別']);
});

test('固定資產：缺必要欄位整份不收', () => {
  const r = parseImportRows('FIXED', [{ 資產名稱: 'x', 保管人代號: 'D000000001' }]);
  assert.deepStrictEqual(errors(r).map((i) => i.field), ['資產編號']);
  assert.strictEqual(r.records.length, 0);
});

test('固定資產：同編號同增值次數重複是錯誤，不同增值次數可以', () => {
  const base = { 資產編號: '0399999901', 資產名稱: 'x', 保管人代號: 'D000000001', 保管人姓名: '甲' };
  const r = parseImportRows('FIXED', [base, Object.assign({}, base, { 增值次數: 1 }), Object.assign({}, base, { 增值次數: '0' })]);
  assert.strictEqual(r.records.length, 2);
  assert.deepStrictEqual(errors(r).map((i) => [i.row, i.field]), [[4, '資產編號']]);
});

test('固定資產：空白列略過，非整數耐用年數是錯誤', () => {
  const r = parseImportRows('FIXED', [
    { 資產編號: '', 資產名稱: '', 保管人代號: '' },
    { 資產編號: '0399999901', 資產名稱: 'x', 保管人代號: 'D000000001', 保管人姓名: '甲', 耐用年數: '3.5' },
  ]);
  assert.deepStrictEqual(errors(r).map((i) => [i.row, i.field]), [[3, '耐用年數']]);
});

test('保管品：鍵為保管人代號-材料編號，數量去掉 .0', () => {
  assert.strictEqual(custodyKey('D000000256', 'CMPPEE3-0A'), 'D000000256-CMPPEE3-0A');
  const r = parseImportRows('CUSTODY', [{
    保管部門: 'D000', 保管人: 'D000000001 王小明', 材料編號: 'cmppee3-0a', 品名規格: '顯示卡', 單位: 'ST', 保管量: '3.0', 最後異動日: '20230330',
  }]);
  assert.deepStrictEqual(r.issues, []);
  assert.strictEqual(r.records[0]['保管品鍵'], 'D000000001-CMPPEE3-0A');
  assert.strictEqual(r.records[0]['帳面數量'], '3');
});

test('保管品：數量為 0、同人同材料重複、沒有姓名', () => {
  const r = parseImportRows('CUSTODY', [
    { 部門代號: 'D000', 保管人代號: 'D000000001', 材料編號: 'A1', 品名規格: 'x', 帳面數量: 0 },
    { 部門代號: 'D100', 保管人代號: 'D000000002', 材料編號: 'A1', 品名規格: 'x', 帳面數量: 1 },
    { 部門代號: 'D100', 保管人代號: 'D000000002', 材料編號: 'A1', 品名規格: 'x', 帳面數量: 2 },
  ]);
  assert.deepStrictEqual(errors(r).map((i) => [i.row, i.field]), [[2, '帳面數量'], [4, '保管品鍵']]);
  assert.ok(warnings(r).some((i) => i.field === '保管人姓名'));
  assert.strictEqual(r.records.length, 1);
});

test('同一保管人代號姓名不一致時提醒', () => {
  const r = parseImportRows('CUSTODY', [
    { 部門代號: 'D000', 保管人: 'D000019097 楊智淵', 材料編號: 'A1', 品名規格: 'x', 帳面數量: 1 },
    { 部門代號: 'D000', 保管人: 'D000019097 楊智淯', 材料編號: 'A2', 品名規格: 'x', 帳面數量: 1 },
  ]);
  assert.deepStrictEqual(warnings(r).map((i) => [i.row, i.field]), [[3, '保管人姓名']]);
});
