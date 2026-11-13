const test = require('node:test');
const assert = require('node:assert');
const {
  resolveRole, can, normalizeLevel, parseCustodianCodes, ROLE_GUEST, ROLE_USER, ROLE_ADMIN, ROLE_SUPER,
} = require('./auth.js');

const accounts = [
  { Email: 'Boss@Gmail.com', 等級: 'Super', 狀態: '啟用' },
  { Email: 'staff@gmail.com', 等級: 'Admin', 狀態: '啟用' },
  { Email: 'old1@gmail.com', 等級: '一等', 狀態: '啟用' },
  { Email: 'old2@gmail.com', 等級: '二等', 狀態: '啟用' },
  { Email: 'prof@gmail.com', 等級: 'User', 狀態: '啟用', 保管人代號: 'D000000001' },
  { Email: 'left@gmail.com', 等級: 'Admin', 狀態: '停用' },
  { Email: 'odd@gmail.com', 等級: '亂填', 狀態: '啟用' },
];

test('依名單判斷角色，Email 不分大小寫、忽略前後空白', () => {
  assert.strictEqual(resolveRole(' boss@gmail.com ', accounts), ROLE_SUPER);
  assert.strictEqual(resolveRole('staff@gmail.com', accounts), ROLE_ADMIN);
  assert.strictEqual(resolveRole('prof@gmail.com', accounts), ROLE_USER);
});

test('舊名稱一等、二等自動對應 Super、Admin', () => {
  assert.strictEqual(resolveRole('old1@gmail.com', accounts), ROLE_SUPER);
  assert.strictEqual(resolveRole('old2@gmail.com', accounts), ROLE_ADMIN);
  assert.strictEqual(normalizeLevel(' admin '), ROLE_ADMIN);
});

test('停用、不在名單、等級認不得、未登入都是 Guest', () => {
  assert.strictEqual(resolveRole('left@gmail.com', accounts), ROLE_GUEST);
  assert.strictEqual(resolveRole('odd@gmail.com', accounts), ROLE_GUEST);
  assert.strictEqual(resolveRole('stranger@gmail.com', accounts), ROLE_GUEST);
  assert.strictEqual(resolveRole('', accounts), ROLE_GUEST);
  assert.strictEqual(resolveRole(null, []), ROLE_GUEST);
});

test('保管人代號可填多個', () => {
  assert.deepStrictEqual(parseCustodianCodes(' d000000001, D000000002、D000000001 '), ['D000000001', 'D000000002']);
  assert.deepStrictEqual(parseCustodianCodes(''), []);
});

test('Guest 只能看公開資料與申請借用', () => {
  assert.ok(can(ROLE_GUEST, 'public.view'));
  assert.ok(can(ROLE_GUEST, 'loan.apply'));
  ['self.view', 'asset.view', 'asset.edit'].forEach((p) => assert.ok(!can(ROLE_GUEST, p), p));
});

test('User 只能看自己名下、自行盤點，不能看全部資產或管理', () => {
  ['public.view', 'loan.apply', 'self.view', 'inventory.self'].forEach((p) => assert.ok(can(ROLE_USER, p), p));
  ['asset.view', 'asset.edit', 'asset.import', 'inventory.record', 'user.manage', 'admin.manage'].forEach((p) =>
    assert.ok(!can(ROLE_USER, p), p));
});

test('Admin 可以處理流程與 User 帳號，但不能結案、管理 Admin／Super、看 LOG', () => {
  ['asset.edit', 'asset.import', 'inventory.record', 'loan.manage', 'case.open', 'photo.upload', 'user.manage', 'self.view']
    .forEach((p) => assert.ok(can(ROLE_ADMIN, p), p));
  ['case.close', 'admin.manage', 'log.view', 'system.manage'].forEach((p) => assert.ok(!can(ROLE_ADMIN, p), p));
});

test('Super 可以做所有事', () => {
  ['asset.edit', 'case.close', 'admin.manage', 'user.manage', 'log.view', 'system.manage'].forEach((p) =>
    assert.ok(can(ROLE_SUPER, p), p));
});

test('未登記的權限一律拒絕', () => {
  assert.ok(!can(ROLE_SUPER, 'no.such.permission'));
});
