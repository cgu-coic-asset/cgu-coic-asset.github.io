const test = require('node:test');
const assert = require('node:assert');
const c = require('./cases.js');
const { filterAssets } = require('./assetList.js');

test('案件編號同一天接續', () => {
  assert.strictEqual(c.nextCaseId([], '20261116'), 'A20261116-01');
  assert.strictEqual(c.nextCaseId(['A20261116-02', 'B20261116-09'], '20261116'), 'A20261116-03');
});

test('登記後：在庫（含舊的可借、空白）→停借；借出、停借不改', () => {
  assert.strictEqual(c.statusAfterCaseOpen('在庫'), '停借');
  assert.strictEqual(c.statusAfterCaseOpen('可借'), '停借');
  assert.strictEqual(c.statusAfterCaseOpen(''), '停借');
  assert.strictEqual(c.statusAfterCaseOpen('借出'), null);
  assert.strictEqual(c.statusAfterCaseOpen('停借'), null);
});

test('結案後：報廢→報廢；其他結果且沒有別的案件→停借回在庫；還有案件就不改', () => {
  assert.strictEqual(c.statusAfterCaseClose('報廢', '停借', 0), '報廢');
  assert.strictEqual(c.statusAfterCaseClose('報廢', '報廢', 0), null);
  assert.strictEqual(c.statusAfterCaseClose('找到／確認無誤', '停借', 0), '在庫');
  assert.strictEqual(c.statusAfterCaseClose('已修復', '停借', 1), null);
  assert.strictEqual(c.statusAfterCaseClose('已修復', '借出', 0), null);
});

test('處理中案件數與清單篩選', () => {
  const cases = [
    { '案件編號': 'A1', '類型': 'FIXED', '資產鍵': 'A', '狀態': '處理中' },
    { '案件編號': 'A2', '類型': 'FIXED', '資產鍵': 'A', '狀態': '已結案' },
    { '案件編號': 'A3', '類型': 'FIXED', '資產鍵': 'B', '狀態': '' },
  ];
  const counts = c.openCaseCounts(cases);
  assert.deepStrictEqual(counts, { 'FIXED:A': 1, 'FIXED:B': 1 });
  const rows = [{ '資產編號': 'A', '增值次數': '0' }, { '資產編號': 'B', '增值次數': '0' }, { '資產編號': 'C', '增值次數': '0' }];
  const keys = filterAssets('FIXED', rows, { '異常案件': '處理中' }, '', {}, { openCases: counts }).map((r) => r['資產編號']);
  assert.deepStrictEqual(keys, ['A', 'B']);
  assert.strictEqual(filterAssets('FIXED', rows, { '異常案件': '處理中' }, '', {}, null).length, 0);
});
