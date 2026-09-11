import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// 保留停用响应，使已部署的旧调用方明确失败；不读取凭证、不访问数据库。
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return new Response(JSON.stringify({
    code: "AUTOMATIC_SETTLEMENT_DISABLED",
    message: "自动及按团队批量结算已停用，请由管理员在主播流水页手动结算。",
  }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});