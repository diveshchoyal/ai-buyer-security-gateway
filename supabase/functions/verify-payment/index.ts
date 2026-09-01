// Edge Function: verify-payment
// Server-side payment verification and settlement boundary

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { verifyRazorpaySignature } from "../_shared/razorpay.ts";

interface VerifyPaymentRequest {
  transaction_id: string;
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  payment_failed?: boolean;
  failure_reason?: string;
  actor?: string;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    let body: VerifyPaymentRequest;
    try {
      body = await req.json();
    } catch (_e) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "INVALID_JSON",
          message: "Malformed JSON request body.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      transaction_id,
      razorpay_order_id: clientOrderId,
      razorpay_payment_id,
      razorpay_signature,
      payment_failed = false,
      failure_reason,
      actor = "verify-payment-edge-func",
    } = body;

    if (!transaction_id || typeof transaction_id !== "string") {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "INVALID_TRANSACTION_ID",
          message: "transaction_id is required.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "SERVER_CONFIGURATION_ERROR",
          message: "Backend server configuration error.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1. Fetch transaction record from Supabase
    const { data: tx, error: txError } = await supabase
      .from("transactions")
      .select("*, budget_reservations(*)")
      .eq("id", transaction_id)
      .single();

    if (txError || !tx) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "TRANSACTION_NOT_FOUND",
          message: "The specified transaction was not found.",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Guard against duplicate settlement
    if (tx.status === "paid") {
      return new Response(
        JSON.stringify({
          success: true,
          status: "paid",
          transaction_id: tx.id,
          amount_paise: tx.amount_paise,
          already_settled: true,
          message: "Transaction is already paid.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. EXPLICIT PAYMENT FAILURE PATH (e.g. Bank card decline, modal dismissed, timeout)
    if (payment_failed) {
      const reason = failure_reason || "External payment rail reported failure";

      const { data: settleResult, error: settleError } = await supabase.rpc("record_payment_result", {
        p_transaction_id: transaction_id,
        p_payment_success: false,
        p_razorpay_order_id: tx.razorpay_order_id,
        p_razorpay_payment_id: razorpay_payment_id || null,
        p_failure_reason: reason,
        p_actor: actor,
      });

      if (settleError) {
        console.error("Error recording payment failure:", settleError);
        return new Response(
          JSON.stringify({
            success: false,
            error_code: "DATABASE_RPC_ERROR",
            message: settleError.message,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          status: "failed",
          transaction_id: tx.id,
          budget_released: true,
          message: "Payment failure recorded and budget reservation safely released back to mandate.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. PAYMENT SUCCESS PATH: Strict Server-Side Cryptographic Verification
    if (!razorpay_payment_id || !razorpay_signature) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "MISSING_PAYMENT_DETAILS",
          message: "razorpay_payment_id and razorpay_signature are required for payment verification.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SECURITY CHECK: Never trust client-supplied Razorpay order ID.
    // The database-stored razorpay_order_id is authoritative.
    const storedOrderId = tx.razorpay_order_id;
    if (!storedOrderId) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "TRANSACTION_HAS_NO_ORDER",
          message: "Transaction has no associated Razorpay order ID.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (clientOrderId && clientOrderId !== storedOrderId) {
      // Tampering attempt detected
      await supabase.from("audit_log").insert({
        mandate_id: tx.mandate_id,
        transaction_id: tx.id,
        actor,
        action: "payment_failed",
        reason: `Client provided order ID mismatch. Expected: ${storedOrderId}, Received: ${clientOrderId}`,
        decision: "rejected",
        amount_paise: tx.amount_paise,
        metadata: {
          stored_order_id: storedOrderId,
          client_order_id: clientOrderId,
          razorpay_payment_id,
        },
      });

      return new Response(
        JSON.stringify({
          success: false,
          error_code: "ORDER_ID_MISMATCH",
          message: "Client-supplied order ID does not match the database authoritative order ID.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Cryptographic HMAC-SHA256 Signature Verification
    const verification = await verifyRazorpaySignature(
      storedOrderId,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!verification.valid) {
      // Signature verification failed! Fail-closed.
      await supabase.from("audit_log").insert({
        mandate_id: tx.mandate_id,
        transaction_id: tx.id,
        actor,
        action: "payment_failed",
        reason: `Cryptographic signature verification failed: ${verification.reason}`,
        decision: "failed",
        amount_paise: tx.amount_paise,
        metadata: {
          stored_order_id: storedOrderId,
          razorpay_payment_id,
        },
      });

      return new Response(
        JSON.stringify({
          success: false,
          error_code: "PAYMENT_VERIFICATION_FAILED",
          message: "Razorpay signature verification failed. The transaction has not been marked paid.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Signature Valid: Settle Payment & Capture Budget Reservation
    const { data: settleResult, error: settleError } = await supabase.rpc("record_payment_result", {
      p_transaction_id: transaction_id,
      p_payment_success: true,
      p_razorpay_order_id: storedOrderId,
      p_razorpay_payment_id: razorpay_payment_id,
      p_failure_reason: null,
      p_actor: actor,
    });

    if (settleError) {
      console.error("Database RPC error in record_payment_result:", settleError);
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "DATABASE_RPC_ERROR",
          message: settleError.message,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: "paid",
        transaction_id: tx.id,
        amount_paise: tx.amount_paise,
        razorpay_order_id: storedOrderId,
        razorpay_payment_id,
        message: "Payment successfully verified and settlement finalized.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unhandled error in verify-payment Edge Function:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error_code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred verifying the payment.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
