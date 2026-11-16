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
    // 公開資訊（訪客掃 QR）：只回傳 shared/publicView.js 定義的欄位
    'public.get': { perm: 'public.view', handler: publicGet_ },
    'public.photo': { perm: 'public.view', handler: publicPhoto_ },
    'public.list': { perm: 'public.view', handler: publicList_ },
    // 盤點：批次由 Admin 管；盤點一件與照片 User 也能（限自己名下，記為自行盤點）
    'inventory.batches': { perm: 'inventory.record', handler: inventoryBatches_ },
    'inventory.batch': { perm: 'inventory.record', handler: inventoryBatch_ },
    'inventory.createBatch': { perm: 'inventory.record', write: true, handler: inventoryCreateBatch_ },
    'inventory.closeBatch': { perm: 'inventory.record', write: true, handler: inventoryCloseBatch_ },
    'inventory.reject': { perm: 'inventory.record', write: true, handler: inventoryReject_ },
    'inventory.active': { perm: 'inventory.self', handler: inventoryActive_ },
    'inventory.photo': { perm: 'inventory.self', write: true, handler: inventoryPhoto_ },
    'inventory.record': { perm: 'inventory.self', write: true, handler: inventoryRecord_ },
    // 異常案件：Admin 登記（自動停借）；只有 Super 能結案
    'case.list': { perm: 'case.open', handler: caseList_ },
    'case.open': { perm: 'case.open', write: true, handler: caseOpen_ },
    'case.close': { perm: 'case.close', write: true, handler: caseClose_ },
    // 借用 A：公開申請、以單號＋手機查詢
    'loan.apply': { perm: 'loan.apply', write: true, handler: loanApply_ },
    'loan.lookup': { perm: 'loan.apply', handler: loanLookup_ },
    'loan.list': { perm: 'loan.manage', handler: loanList_ },
    'loan.reminders': { perm: 'loan.manage', handler: loanReminders_ },
    'loan.get': { perm: 'loan.manage', handler: loanGet_ },
    'loan.photo': { perm: 'loan.manage', write: true, handler: loanPhoto_ },
    'loan.checkout': { perm: 'loan.manage', write: true, handler: loanCheckout_ },
    'loan.return': { perm: 'loan.manage', write: true, handler: loanReturn_ },
    'managed.overview': { perm: 'asset.view', handler: managedOverview_ },
    'selfcheck.data': { perm: 'asset.view', handler: selfCheckData_ },
    // 借用 B：固定資產借用與送修紀錄（User 限自己名下）
    'fixed.records': { perm: 'fixed.record', handler: fixedRecords_ },
    'fixed.add': { perm: 'fixed.record', write: true, handler: fixedRecordAdd_ },
    'fixed.update': { perm: 'fixed.record', write: true, handler: fixedRecordUpdate_ },
    'fixed.return': { perm: 'fixed.record', write: true, handler: fixedRecordReturn_ },
    'loan.uploadScan': { perm: 'loan.manage', write: true, handler: loanUploadScan_ },
    'loan.scan': { perm: 'loan.manage', handler: loanScanGet_ },
    'item.create': { perm: 'asset.edit', write: true, handler: itemCreate_ },
    'item.fromCustody': { perm: 'asset.edit', write: true, handler: itemFromCustody_ },
    'item.fromFixed': { perm: 'asset.edit', write: true, handler: itemFromFixed_ },
    'item.number': { perm: 'asset.edit', write: true, handler: itemNumber_ },
    'photo.upload': { perm: 'photo.upload', write: true, handler: photoUpload_ },
    'photo.list': { perm: 'asset.view', handler: photoList_ },
    'photo.get': { perm: 'asset.view', handler: photoGet_ },
    'photo.void': { perm: 'photo.upload', write: true, handler: photoVoid_ },
    'asset.list': { perm: 'asset.view', handler: assetList_ },
    'asset.get': { perm: 'asset.view', handler: assetGet_ },
    'asset.update': { perm: 'asset.edit', write: true, handler: assetUpdate_ },
    'asset.replaceName': { perm: 'asset.edit', write: true, handler: assetReplaceName_ },
    'asset.ensureQr': { perm: 'asset.edit', write: true, handler: assetEnsureQr_ },
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
