const test = require('node:test');
const assert = require('node:assert');
const M = require('./maintenance.js');

test('日期、容量、備份保留、LOG 封存', () => {
  assert.strictEqual(M.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(M.addYears('2024-02-29 10:00:00', 1), '2025-02-28');
  assert.deepStrictEqual(M.capacityLevel(8, 10, '70,85,95'), { pct: 80, level: 70 });
  assert.deepStrictEqual(M.capacityLevel(9.6, 10), { pct: 96, level: 95 });
  assert.deepStrictEqual(M.capacityLevel(1, 10), { pct: 10, level: 0 });
  assert.deepStrictEqual(M.capacityLevel(1, 0), { pct: null, level: 0 });
  const names = Array.from({ length: 14 }, (_, i) => M.backupFileName('2026' + String(i + 1).padStart(2, '0') + '01-0400'));
  assert.deepStrictEqual(M.backupsToRemove(names), [names[1], names[0]]);
  assert.deepStrictEqual(M.backupsToRemove(names.slice(0, 3)), []);
  assert.deepStrictEqual(M.logYearsToArchive(['2026', '2024', '2025'], '2026', ['2024']), ['2025']);
});

test('照片清理：沒有 NAS 確認日就不清', () => {
  const r = M.cleanupCandidates({ today: '2027-12-01', nasDate: '', photos: [{ 照片編號: 'a', 用途: '盤點', 狀態: '有效', 上傳時間: '2025-01-01' }] });
  assert.ok(r.blocked);
  assert.strictEqual(r.inventory.length, 0);
});

test('照片清理：盤點照片滿一年、早於 NAS 確認日、不是最近一次盤點；建檔永久', () => {
  const photos = [
    { 照片編號: 'old', 用途: '盤點', 狀態: '有效', 上傳時間: '2025-11-01 10:00:00' },
    { 照片編號: 'latest', 用途: '盤點', 狀態: '有效', 上傳時間: '2025-10-01 10:00:00' },
    { 照片編號: 'young', 用途: '盤點', 狀態: '有效', 上傳時間: '2026-06-01 10:00:00' },
    { 照片編號: 'afterNas', 用途: '盤點', 狀態: '有效', 上傳時間: '2026-11-20 10:00:00' },
    { 照片編號: 'build', 用途: '建檔', 狀態: '有效', 上傳時間: '2020-01-01 10:00:00' },
    { 照片編號: 'void', 用途: '盤點', 狀態: '作廢', 上傳時間: '2020-01-01 10:00:00' },
  ];
  const results = [
    { 類型: 'FIXED', 資產鍵: 'X', 盤點時間: '2025-11-01', 照片編號: 'old', 狀態: '有效' },
    { 類型: 'FIXED', 資產鍵: 'X', 盤點時間: '2026-11-01', 照片編號: 'bad', 狀態: '退回' },
    { 類型: 'FIXED', 資產鍵: 'Y', 盤點時間: '2025-10-01', 照片編號: 'latest', 狀態: '有效' },
    { 類型: 'FIXED', 資產鍵: 'X', 盤點時間: '2026-10-01', 照片編號: 'young', 狀態: '有效' },
  ];
  const r = M.cleanupCandidates({ today: '2026-12-01', nasDate: '2026-11-15', photos, results });
  assert.deepStrictEqual(r.inventory.map((p) => p['照片編號']), ['old']);
});

test('照片清理：借還照片與簽核單在借用單結案滿年限後', () => {
  const loans = [
    { 借用單號: 'L1', 狀態: '已歸還', 結案時間: '2025-10-01 10:00:00', 簽核單: 'f1,f2' },
    { 借用單號: 'L2', 狀態: '借出中', 結案時間: '', 簽核單: 'f3' },
    { 借用單號: 'L3', 狀態: '已歸還', 結案時間: '2026-03-01 10:00:00', 簽核單: 'f4' },
  ];
  const details = [{ 明細編號: 'D1', 借用單號: 'L1' }, { 明細編號: 'D2', 借用單號: 'L2' }, { 明細編號: 'D3', 借用單號: 'L3' }];
  const photos = [
    { 照片編號: 'p1', 用途: '借出', 狀態: '有效', 上傳時間: '2025-09-01', 關聯編號: 'D1' },
    { 照片編號: 'p2', 用途: '歸還', 狀態: '有效', 上傳時間: '2025-10-01', 關聯編號: 'D1' },
    { 照片編號: 'p3', 用途: '借出', 狀態: '有效', 上傳時間: '2024-01-01', 關聯編號: 'D2' },
    { 照片編號: 'p4', 用途: '借出', 狀態: '有效', 上傳時間: '2026-02-01', 關聯編號: 'D3' },
  ];
  const r = M.cleanupCandidates({ today: '2026-11-17', nasDate: '2026-11-01', loanYears: '1', photos, details, loans });
  assert.deepStrictEqual(r.loan.map((p) => p['照片編號']), ['p1', 'p2']);
  assert.deepStrictEqual(r.scans, [{ loanId: 'L1', fileId: 'f1' }, { loanId: 'L1', fileId: 'f2' }]);
});

test('個資遮蔽', () => {
  assert.strictEqual(M.maskName('王小明'), '王○明');
  assert.strictEqual(M.maskName('王明'), '王○');
  assert.strictEqual(M.maskName('歐陽小明'), '歐○○明');
  assert.strictEqual(M.maskPhone('0912-345-678'), '09xx-xxx-678');
  assert.strictEqual(M.maskIdNo('B1234567'), 'B*****67');
  assert.strictEqual(M.maskEmail('abc@cgu.edu.tw'), 'a***@cgu.edu.tw');
  const f = M.maskedLoanFields({ 借用人姓名: '王小明', 學號或職號: 'B1234567', 手機: '0912345678', Email: 'a@b.c' });
  assert.deepStrictEqual(f, { 借用人姓名: '王○明', 學號或職號: 'B*****67', 手機: '09xx-xxx-678', Email: 'a***@b.c', 已遮蔽: '是' });
  const loans = [
    { 借用單號: 'L1', 狀態: '已歸還', 結案時間: '2024-11-17 10:00:00' },
    { 借用單號: 'L2', 狀態: '已歸還', 結案時間: '2024-11-18 10:00:00' },
    { 借用單號: 'L3', 狀態: '借出中', 結案時間: '' },
    { 借用單號: 'L4', 狀態: '已作廢', 結案時間: '2023-01-01 10:00:00' },
    { 借用單號: 'L5', 狀態: '已歸還', 結案時間: '2020-01-01 10:00:00', 已遮蔽: '是' },
  ];
  assert.deepStrictEqual(M.loansToMask(loans, '2026-11-17', '2').map((l) => l['借用單號']), ['L1', 'L4']);
});

test('月度提醒信', () => {
  const m = M.monthlyMailContent({
    unit: '智慧運算學院', today: '2026-12-01', url: 'https://x/', backup: { ok: true, name: '備份_20261201-0400.zip' },
    nasDate: '2026-10-01', capacity: { pct: 72, level: 70, usedText: '10.8 GB／15 GB' },
    overdue: [{ id: 'L1', name: '王○明', due: '2026-11-20', days: 11 }], cleanup: { inventory: 3, loan: 0, scans: 1 }, mask: 0,
  });
  assert.strictEqual(m.subject, '【資產系統】2026-12 月度提醒：NAS 待確認、容量 72%、逾期 1');
  assert.ok(m.body.indexOf('L1 王○明 應還 2026-11-20（逾期 11 天）') !== -1);
  assert.ok(m.body.indexOf('盤點照片 3、借還照片 0、簽核單 1') !== -1);
  const ok = M.monthlyMailContent({ today: '2026-12-01', backup: { ok: true, name: 'b' }, nasDate: '2026-11-20', capacity: { pct: 10, level: 0 }, cleanup: {} });
  assert.strictEqual(ok.subject, '【資產系統】2026-12 月度提醒');
});
