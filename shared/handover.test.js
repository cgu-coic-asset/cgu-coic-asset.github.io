const test = require('node:test');
const assert = require('node:assert');
const H = require('./handover.js');

const backup = {
  app: '資產管理系統', version: '0.22.0', time: '2026-12-01 04:00:00', rows: 3, photos: 1,
  books: {
    SYSTEM: { name: '系統設定', sheets: { 管理者: [['Email', '等級', '狀態'], ['a@x.tw', 'Super', '啟用']] } },
    OPS: { name: '作業', sheets: { 照片: [['照片編號', '狀態'], ['P1', '有效']], 借用單: [['借用單號']] } },
  },
};

test('讀備份包', () => {
  const s = H.parseBackup(backup);
  assert.strictEqual(s.version, '0.22.0');
  assert.deepStrictEqual(s.books.map((b) => b.key), ['OPS', 'SYSTEM']);
  assert.deepStrictEqual(s.books[0].sheets, [{ title: '照片', rows: 1 }, { title: '借用單', rows: 0 }]);
  assert.throws(() => H.parseBackup({ app: 'x' }), /不是本系統/);
  assert.throws(() => H.parseBackup({ app: '資產管理系統', books: { OPS: { sheets: {} } } }), /缺少系統設定/);
  assert.throws(() => H.parseBackup({ app: '資產管理系統', books: { SYSTEM: { sheets: { a: 'x' } } } }), /損壞/);
});

test('只能還原到空系統', () => {
  assert.deepStrictEqual(H.restoreBlockers({ 'SYSTEM/管理者': 1, 'LOG_2026/LOG': 5, 'FIXED/資產': 0, 'OPS/照片': 2 }), ['OPS/照片']);
  assert.deepStrictEqual(H.restoreBlockers({ 'FIXED/資產': 0 }), []);
});

test('欄位對應：舊版少欄、多欄、空白列', () => {
  const r = H.remapSheetValues([['B', 'A', 'OLD'], ['b1', 'a1', 'o1'], ['', '', ''], ['b2', null, '']], ['A', 'B', 'NEW']);
  assert.deepStrictEqual(r.headers, ['A', 'B', 'NEW', 'OLD']);
  assert.deepStrictEqual(r.rows, [['a1', 'b1', '', 'o1'], ['', 'b2', '', '']]);
  assert.deepStrictEqual(H.remapSheetValues([['X'], ['1']], []).headers, ['X']);
});

test('帳號與設定合併', () => {
  const rows = [{ Email: 'Old@x.tw', 等級: 'Super', 狀態: '啟用' }, { Email: 'new@x.tw', 等級: 'Admin', 狀態: '停用', 停用時間: 't' }];
  const m = H.mergeAdminRows(rows, 'NEW@x.tw');
  assert.deepStrictEqual([m[1]['等級'], m[1]['狀態'], m[1]['停用時間']], ['Super', '啟用', '']);
  assert.strictEqual(m.length, 2);
  assert.strictEqual(rows[1]['等級'], 'Admin', '不改原陣列');
  assert.strictEqual(H.mergeAdminRows(rows, 'z@x.tw', 't').length, 3);
  const s = H.mergeSettingRows([{ 鍵: 'A', 值: '1' }], [{ 鍵: 'A', 值: '9' }, { 鍵: 'NEW', 值: '2' }]);
  assert.deepStrictEqual(s.map((r) => r['鍵'] + '=' + r['值']), ['A=1', 'NEW=2']);
});

test('照片路徑與核對報告', () => {
  assert.deepStrictEqual(H.photoRelinkPath({ 狀態: '有效', 雲端路徑: '照片/固定資產/0343360037', 檔名: '建檔_20261112_1.jpg' }),
    { folders: ['固定資產', '0343360037'], name: '建檔_20261112_1.jpg' });
  assert.strictEqual(H.photoRelinkPath({ 狀態: '已清理', 雲端路徑: '照片/x', 檔名: 'a' }), null);
  const r = H.handoverReportRows({ date: '2026-12-01', newSuper: 'n@x', sheets: [{ name: '作業／照片', expected: 2, actual: 2 }, { name: '作業／借用單', expected: 3, actual: 2 }],
    photos: { total: 2, linked: 1, missing: ['P2'] }, scans: { loans: 1, files: 2 } });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.rows.map((x) => x[4]), ['符合 備份 2／還原 2', '不符 備份 3／還原 2', '不符 有效 2／已連結 1', '符合 1 張借用單、2 個檔案']);
  assert.strictEqual(r.rows[2][5], '找不到：P2');
});
