import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, XCircle } from "lucide-react";

import { PageHeader } from "@/components/layout/AppShell";
import { Panel } from "@/components/common/DataState";
import { isRazorpayConfigured, isSupabaseConfigured, razorpayKeyId } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — AegisBuy" },
      {
        name: "description",
        content:
          "Environment configuration, payment mode and the security model behind agent purchase authorization.",
      },
      { property: "og:title", content: "Settings — AegisBuy" },
      {
        property: "og:description",
        content: "Environment configuration and the gateway's security model.",
      },
    ],
  }),
  component: SettingsPage,
});

function ConfigRow({
  name,
  description,
  ok,
  value,
}: {
  name: string;
  description: string;
  ok: boolean;
  value?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <p className="font-mono text-xs text-foreground">{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium",
          ok ? "text-emerald-700" : "text-amber-700",
        )}
      >
        {ok ? (
          <CheckCircle2 className="size-4" aria-hidden="true" />
        ) : (
          <XCircle className="size-4" aria-hidden="true" />
        )}
        {ok ? (value ?? "Configured") : "Not set"}
      </span>
    </div>
  );
}

function SettingsPage() {
  const maskedKey = razorpayKeyId ? `${razorpayKeyId.slice(0, 8)}…` : undefined;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Read-only configuration for this environment. No credentials are stored in the app."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Environment"
          description="Public values only — secrets never reach the browser."
          bodyClassName="divide-y divide-border"
        >
          <ConfigRow
            name="VITE_SUPABASE_URL"
            description="Backend project endpoint used for data and function calls."
            ok={isSupabaseConfigured}
          />
          <ConfigRow
            name="VITE_SUPABASE_PUBLISHABLE_KEY"
            description="Publishable key; all access is constrained by row-level security."
            ok={isSupabaseConfigured}
          />
          <ConfigRow
            name="VITE_RAZORPAY_KEY_ID"
            description="Public checkout key. Test mode keys begin with rzp_test."
            ok={isRazorpayConfigured}
            {...(maskedKey ? { value: maskedKey } : {})}
          />
        </Panel>

        <Panel title="Payments" bodyClassName="space-y-3 px-4 py-4 text-sm sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Mode</span>
            <span className="font-medium text-foreground">
              {razorpayKeyId?.startsWith("rzp_test")
                ? "Test mode"
                : isRazorpayConfigured
                  ? "Live key detected"
                  : "Not configured"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Orders are created server-side and the payment signature is verified server-side before
            a transaction is marked successful. The browser only ever receives an order id.
          </p>
        </Panel>

        <Panel title="Security model" bodyClassName="px-4 py-4 sm:px-5" className="lg:col-span-2">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Server-side pricing.</span> The client
              never sends an amount. Prices are read from the products table by the backend.
            </li>
            <li>
              <span className="font-medium text-foreground">Atomic authorization.</span> Mandate
              status, category rules, per-transaction caps and remaining budget are checked in one
              database transaction that reserves the budget.
            </li>
            <li>
              <span className="font-medium text-foreground">Idempotency.</span> Each attempt carries
              a unique key so retries cannot double-charge or double-reserve.
            </li>
            <li>
              <span className="font-medium text-foreground">Immutable audit.</span> Every decision
              is appended to the audit log and streamed to this interface in real time.
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
