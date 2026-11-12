/**
 * 角色與權限判斷（純邏輯，前後端共用）。
 * 角色：訪客、二等、一等。一等可以做二等的所有事。
 */

var ROLE_VISITOR = '訪客';
var ROLE_LEVEL2 = '二等';
var ROLE_LEVEL1 = '一等';

/** 每個權限允許的角色。新增動作時在這裡登記。 */
var PERMISSIONS = {
  'public.view': [ROLE_VISITOR, ROLE_LEVEL2, ROLE_LEVEL1],
  'loan.apply': [ROLE_VISITOR, ROLE_LEVEL2, ROLE_LEVEL1],
  'self.view': [ROLE_LEVEL2, ROLE_LEVEL1],
  'asset.view': [ROLE_LEVEL2, ROLE_LEVEL1],
  'asset.edit': [ROLE_LEVEL2, ROLE_LEVEL1],
  'asset.import': [ROLE_LEVEL2, ROLE_LEVEL1],
  'photo.upload': [ROLE_LEVEL2, ROLE_LEVEL1],
  'inventory.record': [ROLE_LEVEL2, ROLE_LEVEL1],
  'loan.manage': [ROLE_LEVEL2, ROLE_LEVEL1],
  'case.open': [ROLE_LEVEL2, ROLE_LEVEL1],
  'case.close': [ROLE_LEVEL1],
  'admin.manage': [ROLE_LEVEL1],
  'log.view': [ROLE_LEVEL1],
  'system.manage': [ROLE_LEVEL1],
};

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * 依管理者名單判斷角色。
 * adminRows：管理者分頁的列（物件），需有 Email、等級、狀態。只有「啟用」的列算數。
 */
function resolveRole(email, adminRows) {
  const target = normalizeEmail(email);
  if (!target) return ROLE_VISITOR;
  const row = (adminRows || []).find(function (r) {
    return normalizeEmail(r['Email']) === target && r['狀態'] === '啟用';
  });
  if (!row) return ROLE_VISITOR;
  return row['等級'] === ROLE_LEVEL1 ? ROLE_LEVEL1 : ROLE_LEVEL2;
}

function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  return !!allowed && allowed.indexOf(role) !== -1;
}

if (typeof module !== 'undefined') {
  module.exports = { ROLE_VISITOR, ROLE_LEVEL2, ROLE_LEVEL1, PERMISSIONS, normalizeEmail, resolveRole, can };
}
