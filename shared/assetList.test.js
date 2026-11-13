const test = require('node:test');
const assert = require('node:assert');
const {
  displaySerial, assetKey, currentLocation, filterAssets, distinctValues, assetStatus, isLendable, isMoved,
} = require('./assetList.js');

const rows = [
  { 資產編號: '0300000001', 增值次數: '0', 資產名稱: '筆記型電腦', 廠牌規格: 'ACME X14', 部門代號: 'D000', 存放位置: 'A室',
    保管人代號: 'D000000001', 保管人姓名: '甲', 狀態: '可借', 來源狀態: '正常', 經管人: 'Me@x' },
  { 資產編號: '0300000001', 增值次數: '1', 資產名稱: '加記憶體', 部門代號: 'D000', 狀態: '可借', 來源狀態: '正常' },
  { 資產編號: '0300000002', 增值次數: '0', 資產名稱: '顯示器', 產品序號: 'N/A', 請購案號: 'Q40AA00001', 部門代號: 'D100',
    存放位置: 'B室', 保管人代號: 'D000000002', 保管人姓名: '乙', 狀態: '停借', 來源狀態: '待確認', 經管人: '' },
  { 資產編號: '0300000003', 增值次數: '1', 資產名稱: '只有增值紀錄', 部門代號: 'D100', 狀態: '可借', 經管人: 'other@x' },
];
const codes = (list) => list.map((r) => r['資產編號'] + '#' + r['增值次數']);

test('產品序號空白或 N/A 時以請購案號代替', () => {
  assert.deepStrictEqual(displaySerial({ 產品序號: 'SN1', 請購案號: 'Q1' }), { text: 'SN1', isPurchaseNo: false });
  assert.deepStrictEqual(displaySerial({ 產品序號: 'n/a', 請購案號: 'Q1' }), { text: 'Q1', isPurchaseNo: true });
  assert.deepStrictEqual(displaySerial({ 產品序號: '', 請購案號: '' }), { text: '', isPurchaseNo: false });
});

test('鍵：固定資產用資產編號，保管品用保管品鍵', () => {
  assert.strictEqual(assetKey('FIXED', rows[1]), '0300000001');
  assert.strictEqual(assetKey('CUSTODY', { 保管品鍵: 'D000000001-A1' }), 'D000000001-A1');
});

test('增值紀錄併在主紀錄；沒有主紀錄的增值紀錄照樣列出', () => {
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, {})), ['0300000001#0', '0300000002#0', '0300000003#1']);
});

test('關鍵字可多個、不分大小寫，搜得到請購案號', () => {
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { q: 'acme 甲' })), ['0300000001#0']);
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { q: 'q40aa' })), ['0300000002#0']);
});

test('經管人：我經管的、未指定、指定某人', () => {
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { 經管人: 'me' }, 'me@X')), ['0300000001#0']);
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { 經管人: 'me' }, '')), []);
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { 經管人: 'none' })), ['0300000002#0']);
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { 經管人: 'other@x' })), ['0300000003#1']);
});

test('狀態、部門、待確認可組合', () => {
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { 部門代號: 'D100', 待確認: true })), ['0300000002#0']);
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { 狀態: '在庫', 部門代號: 'D100' })), ['0300000003#1']);
});

test('目前位置：有填就用，搜尋也找得到', () => {
  assert.strictEqual(currentLocation({ 存放位置: 'A室', 目前位置: '' }), 'A室');
  assert.strictEqual(currentLocation({ 存放位置: 'A室', 目前位置: 'C倉庫' }), 'C倉庫');
  const moved = rows.map((r, i) => (i === 2 ? Object.assign({}, r, { 目前位置: 'C倉庫' }) : r));
  assert.deepStrictEqual(codes(filterAssets('FIXED', moved, { q: 'c倉庫' })), ['0300000002#0']);
});

test('狀態：舊的「可借」視為在庫；能不能借看開放借用', () => {
  assert.strictEqual(assetStatus({ 狀態: '可借' }), '在庫');
  assert.strictEqual(assetStatus({ 狀態: '' }), '在庫');
  assert.strictEqual(assetStatus({ 狀態: '借出' }), '借出');
  assert.ok(!isLendable({ 狀態: '可借', 開放借用: '否' }));
  assert.ok(isLendable({ 狀態: '在庫', 開放借用: '是' }));
  assert.ok(!isLendable({ 狀態: '借出', 開放借用: '是' }));
});

test('位置篩選用實際位置；可只看已移位', () => {
  const moved = rows.map((r, i) => (i === 2 ? Object.assign({}, r, { 目前位置: 'C倉庫' }) : i === 0 ? Object.assign({}, r, { 目前位置: 'A室' }) : r));
  assert.ok(isMoved(moved[2]));
  assert.ok(!isMoved(moved[0]));
  assert.deepStrictEqual(codes(filterAssets('FIXED', moved, { 位置: 'C倉庫' })), ['0300000002#0']);
  assert.deepStrictEqual(codes(filterAssets('FIXED', moved, { 已移位: true })), ['0300000002#0']);
  assert.deepStrictEqual(distinctValues(moved, '位置').map((v) => v.value), ['A室', 'C倉庫']);
});

test('開放借用篩選：是、否、現在可借', () => {
  const list = [
    Object.assign({}, rows[0], { 開放借用: '是', 狀態: '可借' }),
    Object.assign({}, rows[2], { 開放借用: '是', 狀態: '停借' }),
    Object.assign({}, rows[3], { 開放借用: '' }),
  ];
  assert.deepStrictEqual(codes(filterAssets('FIXED', list, { 開放借用: '是' })), ['0300000001#0', '0300000002#0']);
  assert.deepStrictEqual(codes(filterAssets('FIXED', list, { 開放借用: '可借' })), ['0300000001#0']);
  assert.deepStrictEqual(codes(filterAssets('FIXED', list, { 開放借用: '否' })), ['0300000003#1']);
});

test('建檔照片：有、缺', () => {
  const counts = { 'FIXED:0300000001': { 建檔: 2 }, 'FIXED:0300000002': { 盤點: 3 } };
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { 建檔照片: '有' }, '', counts)), ['0300000001#0']);
  assert.deepStrictEqual(codes(filterAssets('FIXED', rows, { 建檔照片: '缺' }, '', counts)), ['0300000002#0', '0300000003#1']);
});

test('篩選選單的值', () => {
  assert.deepStrictEqual(distinctValues(rows, '部門代號').map((v) => v.value), ['D000', 'D100']);
  assert.deepStrictEqual(distinctValues(rows, '保管人代號').map((v) => v.label), ['D000000001 甲', 'D000000002 乙']);
});
