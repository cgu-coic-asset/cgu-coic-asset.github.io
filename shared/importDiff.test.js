const test = require('node:test');
const assert = require('node:assert');
const { parseImportRows } = require('./importTemplate.js');
const { importRowKey, diffImport, diffSignature } = require('./importDiff.js');

const fixedRow = (code, extra) => Object.assign({
  資產編號: code, 增值次數: '0', 資產名稱: '電腦', 部門代號: 'D000', 存放位置: 'A室', 保管人代號: 'D000000001', 保管人姓名: '甲',
}, extra);
const existingFixed = (code, extra) => Object.assign(fixedRow(code), { 版本: '2', 來源狀態: '正常', 備註: '手寫備註', 經管人: 'me@x' }, extra);

function parsed(type, rows) {
  const r = parseImportRows(type, rows);
  assert.deepStrictEqual(r.issues.filter((i) => i.level === 'error'), []);
  return r;
}

test('鍵：固定資產含增值次數，保管品用保管品鍵', () => {
  assert.strictEqual(importRowKey('FIXED', { 資產編號: '0399999901', 增值次數: '' }), '0399999901#0');
  assert.strictEqual(importRowKey('CUSTODY', { 保管品鍵: 'D000000001-A1' }), 'D000000001-A1');
});

test('新增、變更、未變、消失', () => {
  const p = parsed('FIXED', [fixedRow('0300000001'), fixedRow('0300000002', { 存放位置: 'B室' }), fixedRow('0300000004')]);
  const d = diffImport('FIXED', p.records, p.fields, [
    existingFixed('0300000001'), existingFixed('0300000002'), existingFixed('0300000003'),
  ]);
  assert.deepStrictEqual(d.scope, ['D000']);
  assert.deepStrictEqual(d.added.map((r) => r['資產編號']), ['0300000004']);
  assert.ok(!('_row' in d.added[0]));
  assert.deepStrictEqual(d.changed, [{ key: '0300000002#0', version: '2', before: { 存放位置: 'A室' }, after: { 存放位置: 'B室' } }]);
  assert.strictEqual(d.unchanged, 1);
  assert.deepStrictEqual(d.missing, [{ key: '0300000003#0', version: '2', name: '電腦' }]);
});

test('只比對檔案裡有的欄位：檔案沒有取得價值就不會清空', () => {
  const p = parsed('FIXED', [fixedRow('0300000001')]);
  const d = diffImport('FIXED', p.records, p.fields, [existingFixed('0300000001', { 取得價值: '35000', 請購案號: 'Q1' })]);
  assert.deepStrictEqual(d.changed, []);
  assert.strictEqual(d.unchanged, 1);
});

test('檔案有該欄但留空，視為來源清空', () => {
  const p = parsed('FIXED', [fixedRow('0300000001', { 存放位置: '' })]);
  const d = diffImport('FIXED', p.records, p.fields, [existingFixed('0300000001')]);
  assert.deepStrictEqual(d.changed[0].after, { 存放位置: '' });
});

test('其他部門的資料不會被標成消失；已待確認的不重複標', () => {
  const p = parsed('FIXED', [fixedRow('0300000001')]);
  const d = diffImport('FIXED', p.records, p.fields, [
    existingFixed('0300000001'),
    existingFixed('0300000002', { 部門代號: 'D100' }),
    existingFixed('0300000003', { 來源狀態: '待確認' }),
  ]);
  assert.deepStrictEqual(d.missing, []);
});

test('待確認的資料又出現：恢復正常算變更', () => {
  const p = parsed('FIXED', [fixedRow('0300000001')]);
  const d = diffImport('FIXED', p.records, p.fields, [existingFixed('0300000001', { 來源狀態: '待確認' })]);
  assert.deepStrictEqual(d.changed[0].after, { 來源狀態: '正常' });
});

test('增值紀錄是另一筆', () => {
  const p = parsed('FIXED', [fixedRow('0300000001'), fixedRow('0300000001', { 增值次數: '1', 資產名稱: '加記憶體' })]);
  const d = diffImport('FIXED', p.records, p.fields, [existingFixed('0300000001')]);
  assert.deepStrictEqual(d.added.map((r) => importRowKey('FIXED', r)), ['0300000001#1']);
});

test('保管品：數量變動、合併保管人欄也能比對姓名', () => {
  const p = parsed('CUSTODY', [
    { 保管部門: 'D000', 保管人: 'D000000001 甲', 材料編號: 'A1', 品名規格: '椅子', 單位: 'PC', 保管量: '12.0' },
  ]);
  assert.deepStrictEqual(p.fields, ['部門代號', '保管人代號', '保管人姓名', '材料編號', '品名規格', '單位', '帳面數量', '保管品鍵']);
  const d = diffImport('CUSTODY', p.records, p.fields, [{
    保管品鍵: 'D000000001-A1', 部門代號: 'D000', 保管人代號: 'D000000001', 保管人姓名: '甲', 材料編號: 'A1',
    品名規格: '椅子', 單位: 'PC', 帳面數量: '10', 來源最後異動日: '20240101', 版本: '1', 來源狀態: '正常', 經管人: 'me@x',
  }]);
  assert.deepStrictEqual(d.changed[0].after, { 帳面數量: '12' });
});

test('簽章：內容或版本不同就不同，順序不影響', () => {
  const p = parsed('FIXED', [fixedRow('0300000001', { 存放位置: 'B室' }), fixedRow('0300000004')]);
  const ex = [existingFixed('0300000001'), existingFixed('0300000003')];
  const s1 = diffSignature(diffImport('FIXED', p.records, p.fields, ex));
  const s2 = diffSignature(diffImport('FIXED', p.records.slice().reverse(), p.fields, ex.slice().reverse()));
  assert.strictEqual(s1, s2);
  assert.match(s1, /^3-[0-9a-f]{8}$/);
  const bumped = [existingFixed('0300000001', { 版本: '3' }), existingFixed('0300000003')];
  assert.notStrictEqual(diffSignature(diffImport('FIXED', p.records, p.fields, bumped)), s1);
});
