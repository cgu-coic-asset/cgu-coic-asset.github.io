const test = require('node:test');
const assert = require('node:assert');
const { resolveRole, can, ROLE_VISITOR, ROLE_LEVEL1, ROLE_LEVEL2 } = require('./auth.js');

const admins = [
  { Email: 'Boss@Gmail.com', 等級: '一等', 狀態: '啟用' },
  { Email: 'staff@gmail.com', 等級: '二等', 狀態: '啟用' },
  { Email: 'left@gmail.com', 等級: '二等', 狀態: '停用' },
];

test('依名單判斷角色，Email 不分大小寫、忽略前後空白', () => {
  assert.strictEqual(resolveRole(' boss@gmail.com ', admins), ROLE_LEVEL1);
  assert.strictEqual(resolveRole('staff@gmail.com', admins), ROLE_LEVEL2);
});

test('停用、不在名單、未登入都是訪客', () => {
  assert.strictEqual(resolveRole('left@gmail.com', admins), ROLE_VISITOR);
  assert.strictEqual(resolveRole('stranger@gmail.com', admins), ROLE_VISITOR);
  assert.strictEqual(resolveRole('', admins), ROLE_VISITOR);
  assert.strictEqual(resolveRole(null, []), ROLE_VISITOR);
});

test('訪客只能看公開資料與申請借用', () => {
  assert.ok(can(ROLE_VISITOR, 'public.view'));
  assert.ok(can(ROLE_VISITOR, 'loan.apply'));
  assert.ok(!can(ROLE_VISITOR, 'asset.view'));
  assert.ok(!can(ROLE_VISITOR, 'asset.edit'));
});

test('二等可以處理流程，但不能結案、管理管理者、看 LOG', () => {
  ['asset.edit', 'asset.import', 'inventory.record', 'loan.manage', 'case.open', 'photo.upload'].forEach((p) =>
    assert.ok(can(ROLE_LEVEL2, p), p));
  ['case.close', 'admin.manage', 'log.view', 'system.manage'].forEach((p) =>
    assert.ok(!can(ROLE_LEVEL2, p), p));
});

test('一等可以做所有事', () => {
  ['asset.edit', 'case.close', 'admin.manage', 'log.view', 'system.manage'].forEach((p) =>
    assert.ok(can(ROLE_LEVEL1, p), p));
});

test('未登記的權限一律拒絕', () => {
  assert.ok(!can(ROLE_LEVEL1, 'no.such.permission'));
});
