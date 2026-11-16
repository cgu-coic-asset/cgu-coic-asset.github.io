const test = require('node:test');
const assert = require('node:assert');
const { custodySummary } = require('./managed.js');

test('保管品摘要與差異', () => {
  const a = custodySummary({ '帳面數量': '10', '最近盤點數量': '9' }, { 件數: 6, 借出: 2, 在庫: 4 });
  assert.deepStrictEqual([a.book, a.numbered, a.out, a.inStock, a.counted, a.diff], [10, 6, 2, 4, 9, -1]);
  assert.deepStrictEqual(a.issues, ['點數 9／帳面 10']);
  const b = custodySummary({ '帳面數量': '3', '最近盤點數量': '' }, { 件數: 4 });
  assert.strictEqual(b.counted, null);
  assert.deepStrictEqual(b.issues, ['已編號 4 件超過帳面 3']);
  assert.deepStrictEqual(custodySummary({ '帳面數量': '5', '最近盤點數量': '5' }, null).issues, []);
});
