import { getSupabase } from "./supabase";

/**
 * Edge Function integration points.
 *
 * SECURITY: the client never sends an amount, price or total. The backend
 * derives the authoritative price from the products table.
 */
export interface PurchaseRequest {
  mandate_id: string;
  product_id: string;
  idempotency_key: string;
}

export interface AuthorizationResult {
  authorized: boolean;
  transaction_id?: string | undefined;
  razorpay_order_id?: string | undefined;
  amount?: number | undefined;
  currency?: string | undefined;
  reason?: string | undefined;
  checks?: { label: string; passed: boolean; detail?: string }[] | undefined;
  raw: unknown;
}

export class FunctionUnavailableError extends Error {
  constructor(public functionName: string) {
    super(
      `The "${functionName}" function is not available yet. The purchase flow is wired and will work as soon as it is deployed.`,
    );
    this.name = "FunctionUnavailableError";
  }
}

function isUnavailable(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /not found|404|failed to fetch|failed to send|non-2xx|network|does not exist|fetchError/i.test(
    message,
  );
}

export async function requestAuthorization(input: PurchaseRequest): Promise<AuthorizationResult> {
  const { data, error } = await getSupabase().functions.invoke("purchase-agent", { body: input });

  if (error) {
    console.error("[purchase-agent]", error);
    let payload: Record<string, unknown> | null = null;
    try {
      if (
        "context" in error &&
        typeof (error as { context?: { json: () => Promise<unknown> } }).context?.json ===
          "function"
      ) {
        payload = (await (
          error as { context: { json: () => Promise<unknown> } }
        ).context.json()) as Record<string, unknown>;
      }
    } catch {
      // ignore
    }

    if (payload && (payload["authorized"] === false || payload["success"] === false)) {
      const reason = (payload["message"] || payload["error_code"] || payload["reason"]) as string;
      const errorCode = payload["error_code"] as string | undefined;

      const checks: AuthorizationResult["checks"] = [
        {
          label: "Mandate active",
          passed: !["MANDATE_INACTIVE", "MANDATE_EXPIRED"].includes(errorCode ?? ""),
          detail: ["MANDATE_INACTIVE", "MANDATE_EXPIRED"].includes(errorCode ?? "")
            ? ((payload["message"] as string) ?? "Mandate inactive or expired")
            : "Passed",
        },
        {
          label: "Category allowed",
          passed: errorCode !== "CATEGORY_NOT_ALLOWED",
          detail:
            errorCode === "CATEGORY_NOT_ALLOWED"
              ? ((payload["message"] as string) ?? "Category not permitted")
              : "Passed",
        },
        {
          label: "Transaction limit",
          passed: errorCode !== "PER_TRANSACTION_LIMIT_EXCEEDED",
          detail:
            errorCode === "PER_TRANSACTION_LIMIT_EXCEEDED"
              ? ((payload["message"] as string) ?? "Price exceeds single transaction limit")
              : "Passed",
        },
        {
          label: "Budget available",
          passed: !["TOTAL_BUDGET_EXCEEDED", "INSUFFICIENT_BUDGET"].includes(errorCode ?? ""),
          detail: ["TOTAL_BUDGET_EXCEEDED", "INSUFFICIENT_BUDGET"].includes(errorCode ?? "")
            ? ((payload["message"] as string) ?? "Total budget exceeded")
            : "Passed",
        },
      ];

      return {
        authorized: false,
        reason,
        checks,
        raw: payload,
      };
    }

    if (isUnavailable(error)) throw new FunctionUnavailableError("purchase-agent");
    throw new Error("The authorization service rejected this request. Please try again.");
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const authorized = Boolean(
    payload["authorized"] ??
    payload["approved"] ??
    (typeof payload["status"] === "string" && /author|approv/i.test(payload["status"] as string)),
  );

  return {
    authorized,
    transaction_id: (payload["transaction_id"] ?? payload["transactionId"]) as string | undefined,
    razorpay_order_id: (payload["razorpay_order_id"] ??
      payload["order_id"] ??
      payload["orderId"]) as string | undefined,
    amount: payload["amount_paise"]
      ? Number(payload["amount_paise"]) / 100
      : (payload["amount"] as number | undefined),
    currency: (payload["currency"] as string | undefined) ?? "INR",
    reason: (payload["reason"] ?? payload["message"] ?? payload["error"]) as string | undefined,
    checks: payload["checks"] as AuthorizationResult["checks"],
    raw: data,
  };
}

export interface VerifyPaymentInput {
  transaction_id?: string | undefined;
  razorpay_order_id?: string | undefined;
  razorpay_payment_id?: string | undefined;
  razorpay_signature?: string | undefined;
  payment_failed?: boolean | undefined;
  failure_reason?: string | undefined;
  failed?: boolean | undefined;
  idempotency_key?: string | undefined;
}

export interface VerificationResult {
  success: boolean;
  status?: string | undefined;
  reason?: string | undefined;
  budget_released?: boolean | undefined;
  raw: unknown;
}

export async function verifyPayment(input: VerifyPaymentInput): Promise<VerificationResult> {
  const body = {
    ...input,
    payment_failed: Boolean(input.failed || input.payment_failed),
  };
  const { data, error } = await getSupabase().functions.invoke("verify-payment", { body });

  if (error) {
    console.error("[verify-payment]", error);
    let payload: Record<string, unknown> | null = null;
    try {
      if (
        "context" in error &&
        typeof (error as { context?: { json: () => Promise<unknown> } }).context?.json ===
          "function"
      ) {
        payload = (await (
          error as { context: { json: () => Promise<unknown> } }
        ).context.json()) as Record<string, unknown>;
      }
    } catch {
      // ignore
    }

    if (payload) {
      return {
        success: false,
        status: (payload["status"] as string) ?? "failed",
        reason: (payload["message"] ?? payload["error_code"] ?? payload["reason"]) as
          string | undefined,
        budget_released: Boolean(payload["budget_released"]),
        raw: payload,
      };
    }

    if (isUnavailable(error)) throw new FunctionUnavailableError("verify-payment");
    throw new Error("Payment verification failed on the server.");
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const status = payload["status"] as string | undefined;
  return {
    success: Boolean(
      payload["success"] ?? payload["verified"] ?? /success|captur|paid/i.test(status ?? ""),
    ),
    status,
    reason: (payload["reason"] ?? payload["message"]) as string | undefined,
    budget_released: Boolean(payload["budget_released"]),
    raw: data,
  };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
