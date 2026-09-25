#!/usr/bin/env bash
set -euo pipefail

# ── 配置 ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FUNCTIONS_DIR="$PROJECT_ROOT/supabase/functions"
# ──────────────────────────────────────────────────────

cd "$PROJECT_ROOT"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     Supabase 完整部署（DB + Functions）       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Step 1: 检查项目链接状态 ──────────────────────────
echo "━━━ Step 1/3: 检查项目链接 ━━━"
LINK_FILE="$PROJECT_ROOT/supabase/.temp/project-ref"
if [[ ! -f "$LINK_FILE" ]]; then
  echo "❌ 未找到 linked project，请先执行: supabase link --project-ref <ref>"
  exit 1
fi
PROJECT_REF="$(cat "$LINK_FILE" | tr -d '[:space:]')"
echo "✅ 已链接项目: $PROJECT_REF"
echo ""

# ── Step 2: 推送数据库 Migration ─────────────────────
echo "━━━ Step 2/3: 推送数据库 Migration ━━━"
echo "⏳ 执行 supabase db push ..."
if supabase db push --yes 2>&1; then
  echo "✅ 数据库 migration 推送完成"
else
  echo "❌ 数据库 migration 推送失败"
  exit 1
fi
echo ""

# ── Step 3: 部署所有 Edge Functions ──────────────────
echo "━━━ Step 3/3: 部署 Edge Functions ━━━"

# 收集所有包含 index.ts 的 Edge Function 目录名
functions=()
for dir in "$FUNCTIONS_DIR"/*/; do
  name="$(basename "$dir")"
  [[ "$name" == "_shared" ]] && continue
  if [[ -f "$dir/index.ts" ]]; then
    functions+=("$name")
  fi
done

if [[ ${#functions[@]} -eq 0 ]]; then
  echo "⚠️  未找到任何 Edge Function"
  exit 1
fi

echo "📋 发现 ${#functions[@]} 个 Edge Function："
for f in "${functions[@]}"; do
  echo "   • $f"
done
echo ""

failed=()
for f in "${functions[@]}"; do
  echo "────────────────────────────────────────"
  echo "🚀 部署 $f ..."
  if supabase functions deploy "$f" --no-verify-jwt 2>&1; then
    echo "✅ $f 部署成功"
  else
    echo "❌ $f 部署失败"
    failed+=("$f")
  fi
done

# ── Step 3.5: 替浏览器打一次 OPTIONS 预检 ──────────────
# Edge Functions 没有项目级 CORS 开关；未部署(404)或未关 verify_jwt(401) 时，
# 网关回的是非 2xx 且**不带 CORS 头**的响应，浏览器只会报
# 「Response to preflight request doesn't pass access control check」，
# 把真正的 404/401 盖住。这里把状态码直接摊开，免得再靠猜。
# 需要跳过时：SKIP_PREFLIGHT=1 ./scripts/deploy-all.sh
preflight_failed=()
if [[ "${SKIP_PREFLIGHT:-}" == "1" ]]; then
  echo ""
  echo "⏭️  跳过预检自检（SKIP_PREFLIGHT=1）"
else
  echo ""
  echo "━━━ 附加校验：浏览器预检（CORS） ━━━"
  API_URL="https://${PROJECT_REF}.supabase.co"
  for f in "${functions[@]}"; do
    status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X OPTIONS \
      "$API_URL/functions/v1/$f" \
      -H 'Origin: http://localhost:3000' \
      -H 'Access-Control-Request-Method: POST' \
      -H 'Access-Control-Request-Headers: apikey,authorization,content-type' || true)"
    # 连不上时 curl 已通过 -w 输出 000，这里只兜底空串，避免重复拼接成 000000。
    status="${status:-000}"
    if [[ "$status" == "200" ]]; then
      echo "  ✅ $f 预检 200"
      continue
    fi
    case "$status" in
      401) hint="verify_jwt 没关：重发时带 --no-verify-jwt" ;;
      404) hint="函数未部署（网关找不到该函数）" ;;
      000) hint="请求发不出去（网络 / DNS / 代理）" ;;
      5*)  hint="函数启动或执行失败：看 Dashboard → Edge Functions → $f → Logs" ;;
      *)   hint="函数未处理 OPTIONS 预检" ;;
    esac
    echo "  ❌ $f 预检 HTTP $status —— $hint"
    preflight_failed+=("$f")
  done
fi

echo ""
echo "══════════════════════════════════════════════"
echo "📊 部署结果汇总"
echo "══════════════════════════════════════════════"
total=${#functions[@]}
success=$((total - ${#failed[@]}))
echo "Edge Functions: 成功 $success / $total"
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "部署失败: ${failed[*]}"
fi
if [[ ${#preflight_failed[@]} -gt 0 ]]; then
  echo "预检未通过: ${preflight_failed[*]}"
fi
if [[ ${#failed[@]} -gt 0 || ${#preflight_failed[@]} -gt 0 ]]; then
  exit 1
fi
echo ""
echo "🎉 Supabase 完整部署成功！"
echo ""
echo "   项目:   $PROJECT_REF"
echo "   DB:     ✅ migration 已同步"
echo "   Funcs:  ✅ $total 个函数已部署"