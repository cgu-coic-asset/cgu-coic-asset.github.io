const test = require('node:test');
const assert = require('node:assert');
const {
  photoAssetKey, photoFolderPath, nextPhotoSeq, photoFileName, normalizeExifDate, photoCounts,
} = require('./photo.js');

test('資料夾：類型／資產編號或保管品鍵；增值紀錄共用資產編號', () => {
  assert.deepStrictEqual(photoFolderPath('FIXED', '0351360284'), ['固定資產', '0351360284']);
  assert.deepStrictEqual(photoFolderPath('CUSTODY', 'D000000256-CMPPEE3-0A'), ['保管品', 'D000000256-CMPPEE3-0A']);
  assert.strictEqual(photoAssetKey('FIXED', { 資產編號: '0351360284', 增值次數: '1' }), '0351360284');
  assert.strictEqual(photoAssetKey('CUSTODY', { 保管品鍵: 'D000000256-A1' }), 'D000000256-A1');
});

test('檔名：用途_日期_序號.jpg，序號接續同用途同日期的最大值', () => {
  assert.strictEqual(photoFileName('建檔', '20261113', 1), '建檔_20261113_1.jpg');
  const names = ['建檔_20261113_1.jpg', '建檔_20261113_3.jpg', '盤點_20261113_7.jpg', '建檔_20261112_9.jpg'];
  assert.strictEqual(nextPhotoSeq(names, '建檔', '20261113'), 4);
  assert.strictEqual(nextPhotoSeq(names, '盤點', '20261113'), 8);
  assert.strictEqual(nextPhotoSeq(names, '借出', '20261113'), 1);
  assert.strictEqual(nextPhotoSeq([], '建檔', '20261113'), 1);
  assert.strictEqual(nextPhotoSeq(['建檔_20261113_10.jpg', '建檔_20261113_9.jpg'], '建檔', '20261113'), 11);
});

test('拍攝時間：EXIF 格式轉成一般格式，讀不到或全 0 回傳空白', () => {
  assert.strictEqual(normalizeExifDate('2023:09:19 14:03:22'), '2023-09-19 14:03:22');
  assert.strictEqual(normalizeExifDate('2023-09-19T14:03:22'), '2023-09-19 14:03:22');
  assert.strictEqual(normalizeExifDate('0000:00:00 00:00:00'), '');
  assert.strictEqual(normalizeExifDate(null), '');
});

test('統計：只算有效照片，依類型與鍵分開', () => {
  const c = photoCounts([
    { 類型: 'FIXED', 資產鍵: 'A', 用途: '建檔', 狀態: '有效' },
    { 類型: 'FIXED', 資產鍵: 'A', 用途: '建檔', 狀態: '有效' },
    { 類型: 'FIXED', 資產鍵: 'A', 用途: '盤點', 狀態: '有效' },
    { 類型: 'FIXED', 資產鍵: 'A', 用途: '建檔', 狀態: '作廢' },
    { 類型: 'CUSTODY', 資產鍵: 'A', 用途: '建檔', 狀態: '有效' },
  ]);
  assert.deepStrictEqual(c, { 'FIXED:A': { 建檔: 2, 盤點: 1 }, 'CUSTODY:A': { 建檔: 1 } });
});
