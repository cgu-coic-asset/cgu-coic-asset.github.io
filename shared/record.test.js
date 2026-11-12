const test = require('node:test');
const assert = require('node:assert');
const { checkVersion, nextVersion, applyChanges, stampNew } = require('./record.js');

const row = { 資產編號: '0115360654', 存放位置: '1202G', 備註: '', 版本: '3', 建立者: 'a@x', 修改者: '' };

test('版本相同才能修改', () => {
  assert.strictEqual(checkVersion(row, '3'), null);
  assert.strictEqual(checkVersion(row, 3), null);
});

test('版本不同或沒給版本時回報衝突', () => {
  assert.deepStrictEqual(checkVersion(row, '2'), { currentVersion: '3', expectedVersion: '2' });
  assert.deepStrictEqual(checkVersion(row, undefined), { currentVersion: '3', expectedVersion: null });
});

test('版本遞增，空白視為 0', () => {
  assert.strictEqual(nextVersion('3'), '4');
  assert.strictEqual(nextVersion(''), '1');
});

test('只套用允許的欄位，記錄改前改後，版本加一', () => {
  const r = applyChanges(row, { 存放位置: '1802G', 資產編號: 'HACK', 版本: '99' }, ['存放位置', '備註'], 'b@x', 'T');
  assert.ok(r.changed);
  assert.deepStrictEqual(r.before, { 存放位置: '1202G' });
  assert.deepStrictEqual(r.after, { 存放位置: '1802G' });
  assert.strictEqual(r.row['資產編號'], '0115360654');
  assert.strictEqual(r.row['版本'], '4');
  assert.strictEqual(r.row['修改者'], 'b@x');
  assert.strictEqual(r.row['修改時間'], 'T');
});

test('值沒變就不算修改，版本不動', () => {
  const r = applyChanges(row, { 存放位置: '1202G', 備註: null }, ['存放位置', '備註'], 'b@x', 'T');
  assert.ok(!r.changed);
  assert.strictEqual(r.row['版本'], '3');
});

test('數字一律存成字串，開頭的 0 保留', () => {
  const r = applyChanges({ 數量: '5', 版本: '1' }, { 數量: 7 }, ['數量'], 'b@x', 'T');
  assert.strictEqual(r.row['數量'], '7');
});

test('新資料列版本從 1 開始', () => {
  const r = stampNew({ Email: 'c@x' }, 'a@x', 'T');
  assert.strictEqual(r['版本'], '1');
  assert.strictEqual(r['建立者'], 'a@x');
});
