const test = require('node:test');
const assert = require('node:assert');
const L = require('./logQuery.js');

const rows = [
  { 時間: '2026-11-01 09:00:00', 操作者Email: 'a@x.tw', 操作者姓名: '王', 動作: '盤點', 對象類型: '固定資產', 對象鍵: '0343360037', 改前: '', 改後: '{"結果":"正常"}', 原因: '' },
  { 時間: '2026-11-05 10:00:00', 操作者Email: 'b@x.tw', 操作者姓名: '李', 動作: '修改資產', 對象類型: '保管品', 對象鍵: 'A01-5110010001', 改前: '{"目前位置":"301"}', 改後: '{"目前位置":"305"}', 原因: '搬家' },
  { 時間: '2026-11-09 11:00:00', 操作者Email: 'a@x.tw', 操作者姓名: '王', 動作: '盤點', 對象類型: '保管品', 對象鍵: 'A01-5110010002', 改前: '', 改後: '', 原因: '' },
];

test('篩選條件整理', () => {
  assert.deepStrictEqual(L.cleanLogFilter({ from: '2026/1/5', to: 'x', who: ' A@X ', action: '盤點' }),
    { from: '2026-01-05', to: '', who: 'a@x', key: '', action: '盤點', objectType: '', q: '' });
});

test('依人、日期、資產、動作、全文篩選，新到舊', () => {
  const q = (f) => L.queryLogs(rows, f).rows.map((r) => r['時間'].slice(8, 10));
  assert.deepStrictEqual(q({}), ['09', '05', '01']);
  assert.deepStrictEqual(q({ who: '王' }), ['09', '01']);
  assert.deepStrictEqual(q({ from: '2026-11-02', to: '2026-11-09' }), ['09', '05']);
  assert.deepStrictEqual(q({ key: 'a01-' }), ['09', '05']);
  assert.deepStrictEqual(q({ action: '盤點', objectType: '保管品' }), ['09']);
  assert.deepStrictEqual(q({ q: '305' }), ['05']);
  assert.strictEqual(L.queryLogs(rows, {}, 2).rows.length, 2);
  assert.strictEqual(L.queryLogs(rows, {}, 2).total, 3);
  assert.strictEqual(rows[0]['時間'].slice(8, 10), '01', '不改到原陣列');
});

test('下拉選單與 CSV', () => {
  const f = L.logFacets(rows);
  assert.deepStrictEqual(f.actions, ['盤點', '修改資產']);
  assert.deepStrictEqual(f.actors, [{ email: 'a@x.tw', name: '王' }, { email: 'b@x.tw', name: '李' }]);
  const csv = L.logCsv(['時間', '改後', '原因'], [rows[0], { 時間: '=1+1', 改後: 'a,"b"', 原因: '換\n行' }]);
  assert.ok(csv.startsWith('﻿時間,改後,原因\r\n'));
  assert.ok(csv.indexOf('"{""結果"":""正常""}"') !== -1);
  assert.ok(csv.indexOf("'=1+1,\"a,\"\"b\"\"\",\"換\n行\"") !== -1);
});
