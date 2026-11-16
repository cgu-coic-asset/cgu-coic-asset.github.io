const test = require('node:test');
const assert = require('node:assert');
const inv = require('./inventory.js');
const { filterAssets } = require('./assetList.js');

test('照片格：固定資產三張；保管品、系所物品一張；連結固定資產的系所物品三張', () => {
  assert.deepStrictEqual(inv.inventoryPhotoSlots('FIXED', {}), ['全貌', '編號貼紙', '廠牌型號']);
  assert.deepStrictEqual(inv.inventoryPhotoSlots('CUSTODY', {}), ['全貌']);
  assert.deepStrictEqual(inv.inventoryPhotoSlots('ITEM', { '資產編號': '' }), ['全貌']);
  assert.strictEqual(inv.inventoryPhotoSlots('ITEM', { '資產編號': '0343360037' }).length, 3);
});

test('範圍：只留四個欄位，說明用中文，經管人換成姓名', () => {
  const f = inv.cleanScope({ '部門代號': 'D000', q: '筆電', '經管人': 'a@b.c', '狀態': '在庫', '位置': ' ' });
  assert.deepStrictEqual(f, { '部門代號': 'D000', '經管人': 'a@b.c' });
  assert.strictEqual(inv.scopeText(f, [{ email: 'a@b.c', name: '王' }]), '部門 D000、經管人 王');
  assert.strictEqual(inv.scopeText({}), '全部');
});

test('批次編號：同一天接續', () => {
  assert.strictEqual(inv.nextBatchId([], '20261116'), 'B20261116-01');
  assert.strictEqual(inv.nextBatchId(['B20261116-01', 'B20261116-03', 'B20261101-09'], '20261116'), 'B20261116-04');
});

const R = (key, result, extra) => Object.assign({ '結果編號': 'R' + key, '批次編號': 'B1', '資產鍵': key, '結果': result, '盤點時間': '2026-11-16 10:00:00', '方式': '現場', '狀態': '有效' }, extra);

test('最新結果：同一件以最後一次為準；其他批次不算', () => {
  const rows = [R('A', '找不到'), R('A', '正常', { '結果編號': 'RA2', '盤點時間': '2026-11-16 11:00:00' }), R('B', '正常', { '批次編號': 'B2' })];
  const latest = inv.latestResults(rows, 'B1');
  assert.strictEqual(latest['A']['結果'], '正常');
  assert.strictEqual(latest['B'], undefined);
});

test('狀態與統計：未盤、已盤、自行、退回、異常、範圍外', () => {
  const results = {
    A: R('A', '正常'), B: R('B', '損壞', { '方式': '自行' }), C: R('C', '正常', { '方式': '自行', '狀態': '退回' }), X: R('X', '正常'),
  };
  const s = inv.batchStats(['A', 'B', 'C', 'D'], results);
  assert.deepStrictEqual([s.total, s.done, s.self, s.rejected, s.abnormal], [4, 2, 1, 1, 1]);
  assert.deepStrictEqual(s.missing, ['C', 'D']);
  assert.deepStrictEqual(s.extra, ['X']);
  assert.strictEqual(inv.inventoryState(undefined), '');
  assert.strictEqual(inv.matchInventoryFilter('未盤', results.C, true), true);
  assert.strictEqual(inv.matchInventoryFilter('未盤', undefined, false), false);
  assert.strictEqual(inv.matchInventoryFilter('自行', results.B, true), true);
  assert.strictEqual(inv.matchInventoryFilter('異常', results.C, true), false);
});

test('資產清單篩選：盤點狀態（本次批次）', () => {
  const rows = [
    { '資產編號': 'A', '增值次數': '0' }, { '資產編號': 'B', '增值次數': '0' }, { '資產編號': 'C', '增值次數': '0' },
  ];
  const info = { results: { A: R('A', '正常'), B: R('B', '找不到', { '方式': '自行' }) }, scope: { A: true, B: true, C: true } };
  const keys = (f) => filterAssets('FIXED', rows, f, '', {}, info).map((r) => r['資產編號']);
  assert.deepStrictEqual(keys({ '盤點': '已盤' }), ['A', 'B']);
  assert.deepStrictEqual(keys({ '盤點': '未盤' }), ['C']);
  assert.deepStrictEqual(keys({ '盤點': '自行' }), ['B']);
  assert.deepStrictEqual(keys({ '盤點': '異常' }), ['B']);
  assert.deepStrictEqual(keys({ '盤點': '未盤' }).length + keys({ '盤點': '已盤' }).length, 3);
  assert.deepStrictEqual(filterAssets('FIXED', rows, { '盤點': '未盤' }, '', {}, null).length, 0, '沒有批次就沒有未盤');
});

test('保管品建議結果與輸入檢查', () => {
  assert.strictEqual(inv.suggestCustodyResult('10', '10'), '正常');
  assert.strictEqual(inv.suggestCustodyResult('8', '10'), '數量不符');
  assert.strictEqual(inv.suggestCustodyResult('0', '10'), '找不到');
  assert.strictEqual(inv.suggestCustodyResult('x', '10'), null);
  assert.strictEqual(inv.validateInventoryInput('FIXED', {}, { result: '正常', photoCount: 2 }), '需要 3 張照片，目前 2 張');
  assert.strictEqual(inv.validateInventoryInput('FIXED', {}, { result: '壞掉', photoCount: 3 }), '請選擇盤點結果');
  assert.strictEqual(inv.validateInventoryInput('CUSTODY', {}, { result: '正常', photoCount: 1, quantity: '' }), '請填實際數量（整數）');
  assert.strictEqual(inv.validateInventoryInput('CUSTODY', {}, { result: '正常', photoCount: 1, quantity: '3' }), '');
});
