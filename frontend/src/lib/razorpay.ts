import { razorpayKeyId } from "./supabase";

/** Only the public test key ever reaches the browser. */
export interface CheckoutOptions {
  orderId: string;
  amount?: number | undefined;
  currency?: string | undefined;
  productName: string;
  onSuccess: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  onFailure: (reason: string) => void;
  onDismiss: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (payload: unknown) => void) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout requires a browser."));
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://checkout.razorpay.com/v1/checkout.js";
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the payment checkout script."));
    };
    document.body.appendChild(el);
  });

  return scriptPromise;
}

export async function openCheckout(options: CheckoutOptions): Promise<void> {
  if (!razorpayKeyId) {
    throw new Error("Payment checkout is not configured. Missing VITE_RAZORPAY_KEY_ID.");
  }
  await loadScript();
  if (!window.Razorpay) throw new Error("Payment checkout is unavailable.");

  const checkout = new window.Razorpay({
    key: razorpayKeyId,
    order_id: options.orderId,
    // Amount and currency come from the server-created order; they are
    // passed only for display consistency.
    ...(options.amount !== undefined ? { amount: Math.round(options.amount * 100) } : {}),
    currency: options.currency ?? "INR",
    name: "AI Buyer Security Gateway",
    description: options.productName,
    handler: (response: unknown) => {
      options.onSuccess(
        response as {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        },
      );
    },
    modal: { ondismiss: () => options.onDismiss() },
    theme: { color: "#1f2937" },
  });

  checkout.on("payment.failed", (payload: unknown) => {
    const error = (payload as { error?: { description?: string; reason?: string } })?.error;
    options.onFailure(error?.description ?? error?.reason ?? "Payment failed at the provider.");
  });

  checkout.open();
}
