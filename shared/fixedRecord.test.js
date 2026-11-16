const test = require('node:test');
const assert = require('node:assert');
const F = require('./fixedRecord.js');

const GOOD = { '事件': '借用', '借用部門或廠商': '資工系', '原因': '上課', '地點': '校內', '預計開始': '2026/11/20', '預計結束': '2026-11-30', '借用人': '王', '經辦': '李' };

test('紀錄編號、事件狀態', () => {
  assert.strictEqual(F.nextRecordId(['H20261117-04'], '20261117'), 'H20261117-05');
  assert.strictEqual(F.statusForEvent('借用'), '借出');
  assert.strictEqual(F.statusForEvent('送修'), '送修中');
});

test('新紀錄檢查', () => {
  const r = F.validateFixedRecord(GOOD, true);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.data['預計開始'], '2026-11-20');
  const bad = F.validateFixedRecord({ '事件': '送修', '原因': 'x', '預計開始': '2026-11-20', '預計結束': '2026-11-01' }, true);
  ['請填維修廠商', '請選原因', '請選地點：校內或校外', '預計結束不能早於開始', '請填送修聯絡人', '請填經辦'].forEach((m) => assert.ok(bad.errors.indexOf(m) !== -1, m));
  assert.ok(F.validateFixedRecord(Object.assign({}, GOOD, { '事件': '借' }), true).errors.indexOf('請選事件：借用或送修') !== -1);
  assert.strictEqual(F.validateFixedRecord(GOOD, false).data['事件'], undefined, '修改時不改事件');
});

test('歸還檢查', () => {
  assert.deepStrictEqual(F.validateFixedReturn({ '歸還日期': '2026-11-25', '歸還經辦': '李', '歸還狀況': '正常' }, '2026-11-20').errors, []);
  const e = F.validateFixedReturn({ '歸還日期': '2026-11-01', '歸還狀況': '故障' }, '2026-11-20').errors;
  assert.deepStrictEqual(e, ['歸還日期不能早於開始日', '請填歸還經辦', '故障請填說明']);
});

test('權限：User 只限自己名下', () => {
  assert.strictEqual(F.canEditFixedRecord('Admin', [], {}), true);
  assert.strictEqual(F.canEditFixedRecord('User', ['A01'], { '保管人代號': 'a01' }), true);
  assert.strictEqual(F.canEditFixedRecord('User', ['A01'], { '保管人代號': 'B02' }), false);
  assert.strictEqual(F.canEditFixedRecord('Guest', ['A01'], { '保管人代號': 'A01' }), false);
});
