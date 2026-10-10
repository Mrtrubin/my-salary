#!/usr/bin/env bash
# 将【生产环境】可选模块拷贝到【开发环境】。支持部分克隆，通过参数选择或交互式多选。
# 可用模块：
#   db        —— 数据库结构（表/函数/触发器/RLS/索引/授权）+ 业务数据
#   auth      —— Auth 用户（含密码哈希，保留原密码登录）
#   storage   —— Storage bucket 元数据 + 文件
#   functions —— Edge Functions（源码从生产下载后部署到开发）
#   secrets   —— Edge Function Secrets（值无法从生产读取，需本地 .secrets.production 提供）
#
# 用法：
#   scripts/clone-prod-to-dev.sh                    # 交互式多选
#   scripts/clone-prod-to-dev.sh --all              # 全量克隆
#   scripts/clone-prod-to-dev.sh --db --auth        # 只克隆 db + auth
#
# ⚠️ 选中的模块会先清空并全量覆盖开发环境的对应部分。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

require_supabase
require_pg_tools
cd "$PROJECT_ROOT"

PROD="$SUPABASE_PROD_REF"
DEV="$SUPABASE_DEV_REF"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/clone-prod-to-dev.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

dump_clean() { # 去掉 pg_dump 18 的 \restrict 元命令，以及需要超权、且目标环境已由平台配置好的默认权限
  local f="$1" tmp="$1.tmp"
  grep -v -e '^\\restrict' -e '^\\unrestrict' -e '^ALTER DEFAULT PRIVILEGES ' "$f" > "$tmp" || true
  mv "$tmp" "$f"
}

psql_file() { # 以 postgres 角色执行 SQL 文件
  psql -v ON_ERROR_STOP=1 -q -c "SET ROLE postgres;" -f "$1"
}

psql_data() { # 导入数据：临时关闭触发器（replica 模式），避免业务触发器在导入时误触发
  local wrapped="$1.wrapped"
  { echo "SET session_replication_role = replica;"; cat "$1"; echo "SET session_replication_role = default;"; } > "$wrapped"
  psql -v ON_ERROR_STOP=1 -q -c "SET ROLE postgres;" -f "$wrapped"
}

# 可克隆模块
MODULES=(db auth storage functions secrets)
# 解析参数：默认走交互式多选
SELECTED=()
ASK_MODE=1
if [[ $# -gt 0 ]]; then
  ASK_MODE=0
  for arg in "$@"; do
    case "$arg" in
      --all) SELECTED=(db auth storage functions secrets) ;;
      --db)        SELECTED+=("db") ;;
      --auth)      SELECTED+=("auth") ;;
      --storage)   SELECTED+=("storage") ;;
      --functions) SELECTED+=("functions") ;;
      --secrets)   SELECTED+=("secrets") ;;
      -h|--help)
        sed -n '1,13p' "$0" | tail -n +3
        exit 0 ;;
      *) die "未知参数：$arg（可用 --all --db --auth --storage --functions --secrets）" ;;
    esac
  done
fi

if [[ "$ASK_MODE" == 1 ]]; then
  log "选择要同步到开发环境的模块："
  SELECTED=()
  for m in "${MODULES[@]}"; do
    if confirm "  同步 $m？（y/n）"; then
      SELECTED+=("$m")
    fi
  done
  if [[ ${#SELECTED[@]} -eq 0 ]]; then
    die "未选择任何模块，已取消"
  fi
fi

log "════════ 生产 $PROD  →  开发 $DEV ════════"
log "将同步模块：${SELECTED[*]}"

# 各模块覆盖方式不同，清空确认需按选中模块提示范围
scope_desc=""
for m in "${SELECTED[@]}"; do
  case "$m" in
    db)       scope_desc+="数据库 / " ;;
    auth)     scope_desc+="Auth 用户 / " ;;
    storage)  scope_desc+="Storage / " ;;
    functions) scope_desc+="Edge Functions / " ;;
    secrets)  scope_desc+="Secrets / " ;;
  esac
done
scope_desc="${scope_desc%/ }"
if ! confirm "⚠️  将【清空并全量覆盖】开发环境的 ${scope_desc}，输入 yes 继续："; then
  die "已取消"
fi

do_db() {
  [[ " ${SELECTED[*]} " =~ " db " ]] || return 0
  log "▸ 同步数据库..."
  load_remote_pg "$PROD"
  pg_dump --schema-only --quote-all-identifier --role postgres -n public -f "$WORK/public_schema.sql"
  pg_dump --data-only   --quote-all-identifier --role postgres -n public -f "$WORK/public_data.sql"
  dump_clean "$WORK/public_schema.sql"
  # 迁移历史，使开发环境与生产一致（避免后续 db push 重复执行）
  pg_dump --data-only --quote-all-identifier --role postgres \
    -t supabase_migrations.schema_migrations -f "$WORK/migrations_data.sql" || true
  if [[ -f "$WORK/migrations_data.sql" ]]; then dump_clean "$WORK/migrations_data.sql"; fi

  load_remote_pg "$DEV"
  log "  重建开发环境 public schema ..."
  psql -v ON_ERROR_STOP=1 -q -c "SET ROLE postgres;" -c "DROP SCHEMA IF EXISTS public CASCADE;"
  psql_file "$WORK/public_schema.sql"
  log "  恢复业务数据 ..."
  psql_data "$WORK/public_data.sql"

  if [[ -s "$WORK/migrations_data.sql" ]]; then
    log "  同步迁移历史记录 ..."
    psql -v ON_ERROR_STOP=1 -q -c "SET ROLE postgres;" \
      -c "TRUNCATE supabase_migrations.schema_migrations;"
    psql_data "$WORK/migrations_data.sql"
  fi
  log "✔ 数据库同步完成"
}

do_auth() {
  [[ " ${SELECTED[*]} " =~ " auth " ]] || return 0
  log "▸ 同步 Auth 用户..."
  load_remote_pg "$PROD"
  pg_dump --data-only --quote-all-identifier --role postgres \
    -t auth.users -t auth.identities -f "$WORK/auth_data.sql"
  dump_clean "$WORK/auth_data.sql"

  load_remote_pg "$DEV"
  log "  清空开发环境 Auth 用户 ..."
  psql -v ON_ERROR_STOP=1 -q -c "SET ROLE postgres;" -c "TRUNCATE auth.users CASCADE;"
  psql_data "$WORK/auth_data.sql"
  log "✔ Auth 用户同步完成"
}

do_storage() {
  [[ " ${SELECTED[*]} " =~ " storage " ]] || return 0
  log "▸ 同步 Storage..."
  load_remote_pg "$PROD"
  pg_dump --data-only --quote-all-identifier --role postgres \
    -t storage.buckets -f "$WORK/buckets_data.sql" || true
  if [[ -f "$WORK/buckets_data.sql" ]]; then dump_clean "$WORK/buckets_data.sql"; fi
  psql -v ON_ERROR_STOP=1 -A -t -c "SET ROLE postgres;" \
    -c "select id from storage.buckets order by id;" > "$WORK/buckets.txt"

  if [[ -s "$WORK/buckets.txt" ]]; then
    load_remote_pg "$DEV"
    log "  清空并恢复开发环境 Storage ..."
    psql -v ON_ERROR_STOP=1 -q -c "SET ROLE postgres;" \
      -c "TRUNCATE storage.objects, storage.buckets CASCADE;" || warn "清空开发环境 storage 失败，继续"
    psql_data "$WORK/buckets_data.sql" || warn "恢复 bucket 元数据失败，继续"
    mkdir -p "$WORK/storage"
    while IFS= read -r bucket; do
      [[ -z "$bucket" ]] && continue
      log "  同步 bucket 文件：$bucket ..."
      supabase storage cp -r "ss:///$bucket" "$WORK/storage/$bucket" --project-ref "$PROD" \
        || { warn "  下载 $bucket 失败，跳过"; continue; }
      supabase storage cp -r "$WORK/storage/$bucket" "ss:///$bucket" --project-ref "$DEV" \
        || warn "  上传 $bucket 失败"
    done < "$WORK/buckets.txt"
    log "✔ Storage 同步完成"
  else
    log "  生产环境没有 Storage bucket，跳过。"
  fi
}

do_functions() {
  [[ " ${SELECTED[*]} " =~ " functions " ]] || return 0
  log "▸ 同步 Edge Functions（下载生产 → 部署开发）..."
  FUNCS="$PROJECT_ROOT/supabase/functions"
  BK="$WORK/functions-backup"
  cp -R "$FUNCS" "$BK"
  if supabase functions download --project-ref "$PROD" --use-api; then
    deploy_functions "$DEV" || warn "部分 Edge Function 部署失败"
  else
    warn "从生产下载函数失败，跳过函数同步"
  fi
  rm -rf "$FUNCS"
  mv "$BK" "$FUNCS"
  log "✔ Edge Functions 同步完成"
}

do_secrets() {
  [[ " ${SELECTED[*]} " =~ " secrets " ]] || return 0
  log "▸ 同步 Edge Function Secrets..."
  PROD_SECRETS="$(supabase secrets list --project-ref "$PROD" 2>/dev/null \
    | grep -oE '[A-Z][A-Z0-9_]{2,}' \
    | grep -vE '^(NAME|DIGEST|SUPABASE_)' \
    | sort -u || true)"
  if [[ -n "$PROD_SECRETS" ]]; then
    SECRETS_FILE="$SCRIPT_DIR/.secrets.production"
    if [[ -f "$SECRETS_FILE" ]]; then
      log "  使用 $SECRETS_FILE 写入开发环境 secrets ..."
      supabase secrets set --project-ref "$DEV" --env-file "$SECRETS_FILE" || warn "secrets 写入失败"
    else
      warn "  生产环境存在自定义 secrets（值无法通过 API 读取），需手动同步："
      echo "$PROD_SECRETS" | sed 's/^/     - /'
      warn "  可创建 $SECRETS_FILE（每行 KEY=VALUE）后重跑，或执行："
      warn "      supabase secrets set --project-ref $DEV KEY=VALUE"
    fi
  else
    log "  生产环境没有自定义 secrets，跳过。"
  fi
  log "✔ Secrets 同步完成"
}

# 按固定顺序执行各模块
for m in "${MODULES[@]}"; do
  case "$m" in
    db)       do_db ;;
    auth)     do_auth ;;
    storage)  do_storage ;;
    functions) do_functions ;;
    secrets)  do_secrets ;;
  esac
done

log "🎉 同步完成：$PROD → $DEV"
log "已同步模块：${SELECTED[*]}"
log "建议在开发环境执行：pnpm typecheck && pnpm test"