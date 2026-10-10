#!/usr/bin/env bash
# 将本地数据库 migration + Edge Functions 迁移（部署）到【生产环境】。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

require_supabase

cd "$PROJECT_ROOT"
REF="$SUPABASE_PROD_REF"

log "目标环境：生产  $REF"
if ! confirm "⚠️  即将向【生产环境】推送数据库 migration 并部署 Edge Functions，输入 yes 继续："; then
  die "已取消"
fi

# 1) 获取生产数据库凭证（避免手动输入密码）
load_remote_pg "$REF"
DB_URL="$(remote_db_url)"

# 2) 推送 migration
log "推送数据库 migration ..."
supabase db push --db-url "$DB_URL" --yes

# 3) 部署 Edge Functions
log "部署 Edge Functions ..."
deploy_functions "$REF"

log "🎉 生产环境迁移完成：$REF"
