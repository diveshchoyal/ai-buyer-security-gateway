import { KeyRound } from "lucide-react";

import { isSupabaseConfigured, missingSupabaseEnv } from "@/lib/supabase";

/** Shown when the public backend env vars are absent. No credentials in code. */
export function BackendNotice() {
  if (isSupabaseConfigured) return null;

  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4" aria-hidden="true" />
        Backend not configured
      </span>
      <p className="text-amber-800">
        Set {missingSupabaseEnv.join(" and ")} for this environment. Live data, policy checks and
        the purchase flow stay disabled until then — no sample data is shown.
      </p>
    </div>
  );
}
