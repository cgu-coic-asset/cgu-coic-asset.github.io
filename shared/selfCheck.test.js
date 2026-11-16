const test = require('node:test');
const assert = require('node:assert');
const S = require('./selfCheck.js');

test('民國日期', () => {
  assert.strictEqual(S.rocDate('2026-11-17 10:00:00'), '115/11/17');
  assert.strictEqual(S.rocDate('20261117'), '115/11/17');
  assert.strictEqual(S.rocDate(''), '');
  assert.strictEqual(S.photoDateText({ 拍攝時間: '', 上傳時間: '2025-11-03 09:00:00' }), '2025/11/03');
  assert.strictEqual(S.selfCheckFileName('2026-11-17', 'D000', 'B20261117-01'), '自主盤點_115_D000_B20261117-01');
});

const photo = (id, purpose, taken, uploaded) => ({ 照片編號: id, 用途: purpose, 拍攝時間: taken || '', 上傳時間: uploaded || '2026-01-01 00:00:00' });
const result = (id, batch, time, ids, state) => ({ 結果編號: id, 批次編號: batch, 盤點時間: time, 照片編號: ids, 狀態: state || '有效' });

test('本次盤點三張齊全', () => {
  const photos = [photo('a', '盤點', '2026-11-10 10:00:00'), photo('b', '盤點'), photo('c', '盤點')];
  const e = S.selfCheckEntry({ 狀態: '在庫' }, 'B2', [result('R1', 'B2', '2026-11-10 10:00:00', 'a,b,c')], photos);
  assert.strictEqual(e.state, '已盤');
  assert.strictEqual(e.date, '115/11/10');
  assert.deepStrictEqual(e.photos.map((p) => p.id), ['a', 'b', 'c']);
  assert.strictEqual(e.photos[0].label, '2026/11/10 本次盤點');
  assert.deepStrictEqual(e.photos.map((p) => p.slot), ['全貌', '編號貼紙', '廠牌型號']);
});

test('遞補：前次盤點、再建檔；退回的不算', () => {
  const photos = [
    photo('old1', '盤點', '2025-11-03 10:00:00'), photo('old2', '盤點'),
    photo('rej1', '盤點'), photo('rej2', '盤點'), photo('rej3', '盤點'),
    photo('b1', '建檔', '', '2024-01-01 00:00:00'), photo('b2', '建檔', '', '2024-02-01 00:00:00'),
  ];
  const results = [
    result('R0', 'B1', '2025-11-03 10:00:00', 'old1,old2'),
    result('R1', 'B2', '2026-11-10 10:00:00', 'rej1,rej2,rej3', '退回'),
  ];
  const e = S.selfCheckEntry({ 狀態: '在庫' }, 'B2', results, photos);
  assert.strictEqual(e.state, '未盤');
  assert.strictEqual(e.date, '');
  assert.deepStrictEqual(e.photos.map((p) => p.id + ':' + p.source), ['old1:前次盤點', 'old2:前次盤點', 'b2:建檔']);
  assert.strictEqual(e.photos[0].label, '2025/11/03 前次盤點');
});

test('作廢的照片不用、建檔不重複、沒有就空白', () => {
  const e = S.selfCheckEntry({ 狀態: '在庫' }, '', [result('R0', 'B1', '2025-11-03', 'gone,x')], [photo('x', '盤點'), photo('b1', '建檔')]);
  assert.deepStrictEqual(e.photos.map((p) => p.id), ['b1', 'x', '']);
  assert.strictEqual(e.photos[2].label, '');
});

test('借用中、送修中且本次未盤：待補盤', () => {
  assert.strictEqual(S.selfCheckEntry({ 狀態: '借出' }, 'B2', [], []).pending, '借用中，待補盤');
  assert.strictEqual(S.selfCheckEntry({ 狀態: '送修中' }, 'B2', [], []).state, '待補盤');
  const done = S.selfCheckEntry({ 狀態: '借出' }, 'B2', [result('R1', 'B2', '2026-11-10', 'a,b,c')], []);
  assert.strictEqual(done.state, '已盤');
  assert.strictEqual(done.pending, '');
});
