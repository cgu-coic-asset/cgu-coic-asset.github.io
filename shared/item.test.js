const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeItemPrefix, normalizeItemCode, itemCodeParts, nextItemCodes, nextItemId, compareItemCodes,
} = require('./item.js');

test('前綴：英數字轉大寫，其他不收', () => {
  assert.strictEqual(normalizeItemPrefix(' coic '), 'COIC');
  assert.strictEqual(normalizeItemPrefix('NX2'), 'NX2');
  assert.strictEqual(normalizeItemPrefix('NX-2'), null);
  assert.strictEqual(normalizeItemPrefix(''), null);
});

test('系所編號：紙本寫法統一成前綴-三位數', () => {
  assert.strictEqual(normalizeItemCode('NX2 #8'), 'NX2-008');
  assert.strictEqual(normalizeItemCode('nx2-8'), 'NX2-008');
  assert.strictEqual(normalizeItemCode('NX2-008'), 'NX2-008');
  assert.strictEqual(normalizeItemCode('COIC 12'), 'COIC-012');
  assert.strictEqual(normalizeItemCode('DOAI-1234'), 'DOAI-1234');
  assert.strictEqual(normalizeItemCode(''), '');
  assert.strictEqual(normalizeItemCode('椅子'), null);
  assert.deepStrictEqual(itemCodeParts('NX2-008'), { prefix: 'NX2', num: 8 });
});

test('批次編號：從 1 開始；前綴已用過就接續最大號', () => {
  assert.deepStrictEqual(nextItemCodes([], 'COIC', 3), ['COIC-001', 'COIC-002', 'COIC-003']);
  assert.deepStrictEqual(nextItemCodes(['COIC-001', 'COIC-005', 'NX2-099', ''], 'COIC', 2), ['COIC-006', 'COIC-007']);
  assert.deepStrictEqual(nextItemCodes(['NX2-099'], 'NX2', 2), ['NX2-100', 'NX2-101']);
});

test('物品ID 接續最大值', () => {
  assert.strictEqual(nextItemId([]), 'I000001');
  assert.strictEqual(nextItemId(['I000009', 'I000002', 'X']), 'I000010');
});

test('排序：前綴、號碼大小，沒編號最後', () => {
  const list = ['NX2-010', '', 'COIC-002', 'NX2-002', 'COIC-010'];
  assert.deepStrictEqual(list.sort(compareItemCodes), ['COIC-002', 'COIC-010', 'NX2-002', 'NX2-010', '']);
});
