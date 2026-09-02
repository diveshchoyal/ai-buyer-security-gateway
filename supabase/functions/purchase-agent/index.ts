// Edge Function: purchase-agent
// Secure purchase entry point for AI Agent purchasing system

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { createRazorpayOrder } from "../_shared/razorpay.ts";

interface PurchaseRequest { mandate_id: string; product_id: string; idempotency_key: string; actor?: string; }

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req); if (corsResponse) return corsResponse;
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    let body: PurchaseRequest;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ success: false, error_code: "INVALID_JSON", message: "Malformed JSON request body." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    const { mandate_id, product_id, idempotency_key, actor = "ai_agent" } = body;
    if (!mandate_id || typeof mandate_id !== "string") return new Response(JSON.stringify({ success: false, error_code: "INVALID_MANDATE_ID", message: "mandate_id is required and must be a string." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!product_id || typeof product_id !== "string") return new Response(JSON.stringify({ success: false, error_code: "INVALID_PRODUCT_ID", message: "product_id is required and must be a string." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!idempotency_key || typeof idempotency_key !== "string") return new Response(JSON.stringify({ success: false, error_code: "INVALID_IDEMPOTENCY_KEY", message: "idempotency_key is required and must be a string." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) return new Response(JSON.stringify({ success: false, error_code: "SERVER_CONFIGURATION_ERROR", message: "Backend server configuration error." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

    const { data: authResult, error: authError } = await supabase.rpc("authorize_purchase", { p_mandate_id: mandate_id, p_product_id: product_id, p_idempotency_key: idempotency_key, p_actor: actor });
    if (authError) return new Response(JSON.stringify({ success: false, authorized: false, error_code: "DATABASE_RPC_ERROR", message: authError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!authResult || !authResult.authorized) return new Response(JSON.stringify({ success: false, authorized: false, error_code: authResult?.error_code || "AUTHORIZATION_REJECTED", message: authResult?.message || "Purchase rejected by mandate spending gate.", price_paise: authResult?.price_paise, remaining_paise: authResult?.remaining_paise, committed_paise: authResult?.committed_paise, max_total_paise: authResult?.max_total_paise, max_transaction_paise: authResult?.max_transaction_paise }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { transaction_id, amount_paise, is_idempotent_replay, status: currentStatus, razorpay_order_id: existingOrderId } = authResult;
    if (is_idempotent_replay && existingOrderId) return new Response(JSON.stringify({ success: true, authorized: true, is_idempotent_replay: true, transaction_id, amount_paise, currency: "INR", status: currentStatus, razorpay_order_id: existingOrderId, is_simulated: String(existingOrderId).startsWith("order_test_"), razorpay_key_id: Deno.env.get("RAZORPAY_KEY_ID") || "rzp_test_simulation" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let razorpayOrder;
    try { razorpayOrder = await createRazorpayOrder(amount_paise, "INR", transaction_id, { mandate_id, transaction_id, product_id, actor }); }
    catch { return new Response(JSON.stringify({ success: false, authorized: true, error_code: "RAZORPAY_ORDER_CREATION_FAILED", message: "Failed to initiate payment order on external rail." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

    const { error: txUpdateError } = await supabase.from("transactions").update({ razorpay_order_id: razorpayOrder.id, status: "payment_pending" }).eq("id", transaction_id);
    if (txUpdateError) console.error("Failed to update transaction with order_id:", txUpdateError);
    await supabase.from("audit_log").insert({ mandate_id, transaction_id, actor, action: "payment_started", reason: "Razorpay order created; awaiting checkout completion", decision: "recorded", amount_paise, metadata: { razorpay_order_id: razorpayOrder.id, is_simulated: razorpayOrder.is_simulated } });

    return new Response(JSON.stringify({ success: true, authorized: true, is_idempotent_replay: false, transaction_id, amount_paise, currency: "INR", status: "payment_pending", razorpay_order_id: razorpayOrder.id, is_simulated: razorpayOrder.is_simulated, razorpay_key_id: Deno.env.get("RAZORPAY_KEY_ID") || "rzp_test_simulation" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Unhandled error in purchase-agent Edge Function:", error);
    return new Response(JSON.stringify({ success: false, error_code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred processing the purchase request." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
