#!/bin/sh
# 推送後端程式並更新「同一個」部署，/exec 網址維持不變。
# 用法：./deploy.sh "這次改了什麼"
set -e
cd "$(dirname "$0")"
DEPLOYMENT_ID=AKfycbwatvrslzHPHJJWMFtiLkP7P-10L1vNJM2nIj2kcTC9Gj5wl5AcsRDTFJwbscYflP2M0w

# 1. 共用邏輯先跑單元測試
node --test shared/*.test.js

# 2. 把 shared/ 複製進 gas/（檔名加 shared_ 前綴，不進 git）
rm -f gas/shared_*.js
for f in shared/*.js; do
  case "$f" in *.test.js) continue ;; esac
  cp "$f" "gas/shared_$(basename "$f")"
done

# 3. 推送並更新部署
clasp push --force
clasp update-deployment "$DEPLOYMENT_ID" --description "${1:-更新}"
