/**
 * 動作路由：每個動作登記需要的權限、是否為寫入、處理函式。
 * 寫入動作一律取得指令碼鎖，避免同時寫入互相覆蓋。
 */

function actions_() {
  return {
    'version': { handler: function () { return { version: APP_VERSION }; } },
    'whoami': {
      handler: function (payload, actor) {
        return { email: actor.email, name: actor.name, role: actor.role, loggedIn: actor.loggedIn, codes: actor.codes };
      },
    },
    // 帳號：Super 管全部，Admin 只能管 User（細部檢查在 Admin.js）
    'admin.list': { perm: 'user.manage', handler: adminList_ },
    'admin.add': { perm: 'user.manage', write: true, handler: adminAdd_ },
    'admin.update': { perm: 'user.manage', write: true, handler: adminUpdate_ },
    'my.assets': { perm: 'self.view', handler: myAssets_ },
    'photo.upload': { perm: 'photo.upload', write: true, handler: photoUpload_ },
    'photo.list': { perm: 'asset.view', handler: photoList_ },
    'photo.get': { perm: 'asset.view', handler: photoGet_ },
    'photo.void': { perm: 'photo.upload', write: true, handler: photoVoid_ },
    'asset.list': { perm: 'asset.view', handler: assetList_ },
    'asset.get': { perm: 'asset.view', handler: assetGet_ },
    'asset.update': { perm: 'asset.edit', write: true, handler: assetUpdate_ },
    'asset.assign': { perm: 'asset.edit', write: true, handler: assetAssign_ },
    'import.current': { perm: 'asset.import', handler: importCurrent_ },
    'import.commit': { perm: 'asset.import', write: true, handler: importCommit_ },
  };
}

function handleRequest_(req) {
  const def = actions_()[req.action];
  if (!def) throw new AppError('UNKNOWN_ACTION', '未知的動作：' + req.action);

  const actor = getActor_(req);
  if (def.perm && !can(actor.role, def.perm)) {
    throw new AppError(actor.loggedIn ? 'FORBIDDEN' : 'UNAUTHENTICATED');
  }

  if (!def.write) return { ok: true, data: def.handler(req.payload || {}, actor) };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new AppError('LOCK_TIMEOUT');
  try {
    return { ok: true, data: def.handler(req.payload || {}, actor) };
  } finally {
    lock.releaseLock();
  }
}
