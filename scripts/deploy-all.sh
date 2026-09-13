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

echo ""
echo "══════════════════════════════════════════════"
echo "📊 部署结果汇总"
echo "══════════════════════════════════════════════"
total=${#functions[@]}
success=$((total - ${#failed[@]}))
echo "Edge Functions: 成功 $success / $total"
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "失败: ${failed[*]}"
  exit 1
fi
echo ""
echo "🎉 Supabase 完整部署成功！"
echo ""
echo "   项目:   $PROJECT_REF"
echo "   DB:     ✅ migration 已同步"
echo "   Funcs:  ✅ $total 个函数已部署"