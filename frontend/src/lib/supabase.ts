import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env["VITE_SUPABASE_URL"] ?? import.meta.env["SUPABASE_URL"]) as
  string | undefined;
const publishableKey = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  import.meta.env["VITE_SUPABASE_ANON_KEY"] ??
  import.meta.env["SUPABASE_ANON_KEY"] ??
  import.meta.env["SUPABASE_PUBLISHABLE_KEY"]) as string | undefined;

/** True only when both public env vars are present. No keys are ever hardcoded. */
export const isSupabaseConfigured = Boolean(url && publishableKey);

export const missingSupabaseEnv = [
  url ? null : "VITE_SUPABASE_URL",
  publishableKey ? null : "VITE_SUPABASE_PUBLISHABLE_KEY",
].filter(Boolean) as string[];

let client: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  client = createClient(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Throws a readable error when the backend env vars are not configured. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    throw new Error(
      `Backend is not configured. Missing environment variable(s): ${missingSupabaseEnv.join(", ")}`,
    );
  }
  return client;
}

export const supabase = client;

export const razorpayKeyId = import.meta.env["VITE_RAZORPAY_KEY_ID"] as string | undefined;
export const isRazorpayConfigured = Boolean(razorpayKeyId);
