// Supabase Edge Function Razorpay Integration (Test Mode & Simulation Support)

export async function computeHmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface RazorpayOrderResult {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  is_simulated: boolean;
}

/**
 * Creates an order in Razorpay using server-side credentials.
 * Falls back to test-mode simulation if keys are mock or if live test gateway returns 401.
 */
export async function createRazorpayOrder(
  amountPaise: number,
  currency: string = "INR",
  receipt: string,
  notes: Record<string, string> = {}
): Promise<RazorpayOrderResult> {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID") || "rzp_test_simulation";
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "simulated_secret_key";

  // Check if live test keys are configured (standard Razorpay test key format)
  const isLiveTestKey = keyId.startsWith("rzp_test_") && keyId !== "rzp_test_simulation" && keySecret !== "simulated_secret_key";

  if (isLiveTestKey) {
    try {
      const basicAuth = btoa(`${keyId}:${keySecret}`);
      const response = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency,
          receipt,
          notes,
        }),
      });

      if (response.ok) {
        const orderData = await response.json();
        return {
          id: orderData.id,
          amount: orderData.amount,
          currency: orderData.currency,
          receipt: orderData.receipt,
          is_simulated: false,
        };
      }
      console.warn(`Razorpay API returned HTTP ${response.status}. Falling back to test simulation mode.`);
    } catch (err) {
      console.warn(`Razorpay API request error: ${err}. Falling back to test simulation mode.`);
    }
  }

  // Automated Test Mode Simulation
  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const simulatedOrderId = `order_test_${randomSuffix}`;

  return {
    id: simulatedOrderId,
    amount: amountPaise,
    currency,
    receipt,
    is_simulated: true,
  };
}

/**
 * Verifies Razorpay payment signature server-side using the database-stored order ID.
 * Never trusts a client-supplied order ID.
 */
export async function verifyRazorpaySignature(
  storedOrderId: string,
  paymentId: string,
  clientSignature: string,
  secretOverride?: string
): Promise<{ valid: boolean; reason?: string }> {
  if (!storedOrderId) {
    return { valid: false, reason: "Stored order ID is missing from transaction" };
  }
  if (!paymentId) {
    return { valid: false, reason: "Payment ID is missing" };
  }
  if (!clientSignature) {
    return { valid: false, reason: "Client signature is missing" };
  }

  const keySecret = secretOverride || Deno.env.get("RAZORPAY_KEY_SECRET") || "simulated_secret_key";
  const payload = `${storedOrderId}|${paymentId}`;
  const expectedSignature = await computeHmacSha256(payload, keySecret);

  // Constant-time comparison
  const isValid = timingSafeEqual(expectedSignature, clientSignature);

  if (isValid) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: "Cryptographic signature mismatch",
  };
}
