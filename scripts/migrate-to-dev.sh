#!/usr/bin/env bash
# 将本地数据库 migration + Edge Functions 迁移（部署）到【开发环境】。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

require_supabase

cd "$PROJECT_ROOT"
REF="$SUPABASE_DEV_REF"

log "目标环境：开发  $REF"

# 1) 获取开发数据库凭证（避免手动输入密码）
load_remote_pg "$REF"
DB_URL="$(remote_db_url)"

# 2) 推送 migration
log "推送数据库 migration ..."
supabase db push --db-url "$DB_URL" --yes

# 3) 部署 Edge Functions
log "部署 Edge Functions ..."
deploy_functions "$REF"

log "🎉 开发环境迁移完成：$REF"
