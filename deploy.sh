#!/bin/sh
# 推送後端程式並更新「同一個」部署，/exec 網址維持不變。
# 用法：./deploy.sh "這次改了什麼"
set -e
cd "$(dirname "$0")"
DEPLOYMENT_ID=AKfycbwatvrslzHPHJJWMFtiLkP7P-10L1vNJM2nIj2kcTC9Gj5wl5AcsRDTFJwbscYflP2M0w
clasp push --force
clasp update-deployment "$DEPLOYMENT_ID" --description "${1:-更新}"
