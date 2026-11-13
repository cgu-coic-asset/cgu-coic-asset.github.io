/**
 * 角色與權限判斷（純邏輯，前後端共用）。
 * 角色：Guest（訪客）、User（保管人：只看自己名下的帳）、Admin（管理者）、Super（系統管理）。
 * Super 可以做 Admin 的所有事；User 不是管理者，看不到別人的資料。
 * 舊名稱「一等」「二等」讀取時自動視為 Super、Admin。
 */

var ROLE_GUEST = 'Guest';
var ROLE_USER = 'User';
var ROLE_ADMIN = 'Admin';
var ROLE_SUPER = 'Super';

/** 畫面上顯示的名稱。 */
var ROLE_LABELS = {
  Guest: 'Guest（訪客）',
  User: 'User（保管人）',
  Admin: 'Admin（管理者）',
  Super: 'Super（系統管理）',
};

/** 帳號名單可設定的等級。 */
var ACCOUNT_LEVELS = [ROLE_SUPER, ROLE_ADMIN, ROLE_USER];

/** 每個權限允許的角色。新增動作時在這裡登記。 */
var PERMISSIONS = {
  'public.view': [ROLE_GUEST, ROLE_USER, ROLE_ADMIN, ROLE_SUPER],
  'loan.apply': [ROLE_GUEST, ROLE_USER, ROLE_ADMIN, ROLE_SUPER],
  'self.view': [ROLE_USER, ROLE_ADMIN, ROLE_SUPER],
  'inventory.self': [ROLE_USER, ROLE_ADMIN, ROLE_SUPER],
  'asset.view': [ROLE_ADMIN, ROLE_SUPER],
  'asset.edit': [ROLE_ADMIN, ROLE_SUPER],
  'asset.import': [ROLE_ADMIN, ROLE_SUPER],
  'photo.upload': [ROLE_ADMIN, ROLE_SUPER],
  'inventory.record': [ROLE_ADMIN, ROLE_SUPER],
  'loan.manage': [ROLE_ADMIN, ROLE_SUPER],
  'case.open': [ROLE_ADMIN, ROLE_SUPER],
  'user.manage': [ROLE_ADMIN, ROLE_SUPER],
  'case.close': [ROLE_SUPER],
  'admin.manage': [ROLE_SUPER],
  'log.view': [ROLE_SUPER],
  'system.manage': [ROLE_SUPER],
};

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** 等級欄的值轉成角色名稱（相容舊的一等、二等）；認不得的回傳空字串。 */
function normalizeLevel(level) {
  const v = String(level || '').trim();
  if (v === '一等' || v.toLowerCase() === 'super') return ROLE_SUPER;
  if (v === '二等' || v.toLowerCase() === 'admin') return ROLE_ADMIN;
  if (v.toLowerCase() === 'user') return ROLE_USER;
  return '';
}

/** 保管人代號欄可以填多個（逗號、頓號或空白分隔），回傳去重、轉大寫的陣列。 */
function parseCustodianCodes(text) {
  const out = [];
  String(text || '').toUpperCase().split(/[\s,，、;；]+/).forEach(function (c) {
    if (c && out.indexOf(c) === -1) out.push(c);
  });
  return out;
}

/**
 * 依帳號名單判斷角色。
 * accountRows：帳號名單的列（物件），需有 Email、等級、狀態。只有「啟用」的列算數。
 */
function resolveRole(email, accountRows) {
  const target = normalizeEmail(email);
  if (!target) return ROLE_GUEST;
  const row = (accountRows || []).find(function (r) {
    return normalizeEmail(r['Email']) === target && r['狀態'] === '啟用';
  });
  if (!row) return ROLE_GUEST;
  return normalizeLevel(row['等級']) || ROLE_GUEST;
}

function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  return !!allowed && allowed.indexOf(role) !== -1;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ROLE_GUEST, ROLE_USER, ROLE_ADMIN, ROLE_SUPER, ROLE_LABELS, ACCOUNT_LEVELS, PERMISSIONS,
    normalizeEmail, normalizeLevel, parseCustodianCodes, resolveRole, can,
  };
}
