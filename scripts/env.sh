#!/usr/bin/env bash
# 共享配置与工具函数。由 migrate-to-*.sh / clone-prod-to-dev.sh source 引入。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 环境项目 ref（可用同名环境变量覆盖） ─────────────────
SUPABASE_DEV_REF="${SUPABASE_DEV_REF:-ersgshpgjtjupaweloei}"    # my-salary-development
SUPABASE_PROD_REF="${SUPABASE_PROD_REF:-cypkhtamgblyigurjjuo}"  # my-salary-production

# ── 依赖：Supabase CLI + PostgreSQL 客户端 ───────────────
# brew 安装的 libpq 是 keg-only，不在 PATH 中，这里自动加入。
if [[ -d /opt/homebrew/opt/libpq/bin ]]; then
  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
elif [[ -d /usr/local/opt/libpq/bin ]]; then
  export PATH="/usr/local/opt/libpq/bin:$PATH"
fi

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

require_supabase() {
  command -v supabase >/dev/null 2>&1 || die "缺少 supabase CLI，请先安装并 supabase login"
}

require_pg_tools() {
  if ! command -v pg_dump >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
    die "缺少 pg_dump/psql。请执行：brew install libpq（脚本会自动把 /opt/homebrew/opt/libpq/bin 加入 PATH）"
  fi
}

# URL 编码（用于拼接连接串账号/密码）
urlencode() {
  python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"
}

# 解析某个项目的运行时数据库凭证，导出 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE。
# 原理：supabase db dump --dry-run 会临时创建一个 cli_login 角色并打印连接凭证。
load_remote_pg() {
  local ref="$1" creds
  creds="$(supabase db dump --project-ref "$ref" --dry-run 2>/dev/null | grep -E '^export PG' || true)"
  [[ -n "$creds" ]] || die "无法获取 $ref 的数据库凭证（请确认已 supabase login 且项目可访问）"
  eval "$creds"
  export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"
}

# 当前 PG* 环境变量拼出的连接串（用于 supabase db push --db-url）。
remote_db_url() {
  printf 'postgresql://%s:%s@%s:%s/%s' \
    "$(urlencode "$PGUSER")" "$(urlencode "$PGPASSWORD")" "$PGHOST" "$PGPORT" "$PGDATABASE"
}

# 交互确认；仅当输入 yes/y 返回 0。
confirm() {
  local prompt="$1" ans
  read -r -p "$prompt " ans
  [[ "$ans" == "yes" || "$ans" == "y" ]]
}

# 把本仓库 supabase/functions 下所有 Edge Function 部署到指定项目。
deploy_functions() {
  local ref="$1" name dir failed=0
  local funcs_dir="$PROJECT_ROOT/supabase/functions"
  for dir in "$funcs_dir"/*/; do
    name="$(basename "$dir")"
    [[ "$name" == "_shared" ]] && continue
    [[ -f "$dir/index.ts" ]] || continue
    log "部署 Edge Function：$name"
    if supabase functions deploy "$name" --project-ref "$ref" --use-api --no-verify-jwt; then
      log "✅ $name"
    else
      warn "❌ $name 部署失败"
      failed=1
    fi
  done
  return "$failed"
}
