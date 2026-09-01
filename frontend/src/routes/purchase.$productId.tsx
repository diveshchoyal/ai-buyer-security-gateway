import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2, ShieldX, XCircle } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/AppShell";
import { BackendNotice } from "@/components/common/BackendNotice";
import { ErrorState, Panel, TableSkeleton } from "@/components/common/DataState";
import { PolicyCheck } from "@/components/common/PolicyCheck";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mandatesQuery, productsQuery, reservationsQuery, transactionsQuery } from "@/lib/queries";
import { budgetFor, evaluatePolicy, type PolicyCheckItem } from "@/lib/policy";
import { formatINR } from "@/lib/format";
import { isMandateActive } from "@/lib/types";
import { isRazorpayConfigured, isSupabaseConfigured } from "@/lib/supabase";
import { newIdempotencyKey, requestAuthorization, verifyPayment } from "@/lib/purchase";
import { openCheckout } from "@/lib/razorpay";

export const Route = createFileRoute("/purchase/$productId")({
  head: () => ({
    meta: [
      { title: "Authorize purchase — AI Buyer Security Gateway" },
      {
        name: "description",
        content:
          "Run mandate, category, limit and budget checks, then settle an authorized agent purchase in test mode.",
      },
      { property: "og:title", content: "Authorize purchase — AI Buyer Security Gateway" },
      {
        property: "og:description",
        content: "Policy checks and settlement for a single agent purchase.",
      },
    ],
  }),
  component: PurchasePage,
});

type Phase =
  | { kind: "idle" }
  | { kind: "authorizing" }
  | { kind: "blocked"; reason: string; checks?: PolicyCheckItem[] }
  | { kind: "paying" }
  | { kind: "verifying" }
  | { kind: "success"; message: string }
  | {
      kind: "failed";
      reason: string;
      policyApproved?: boolean;
      budgetReleased?: boolean;
      amount?: number;
    };

function PurchasePage() {
  const { productId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const enabled = isSupabaseConfigured;

  const products = useQuery({ ...productsQuery, enabled });
  const mandates = useQuery({ ...mandatesQuery, enabled });
  const transactions = useQuery({ ...transactionsQuery, enabled });
  const reservations = useQuery({ ...reservationsQuery, enabled });

  const product = products.data?.find((p) => p.id === productId);
  const activeMandates = (mandates.data ?? []).filter(isMandateActive);
  const [mandateId, setMandateId] = useState<string | undefined>(undefined);
  const mandate =
    (mandates.data ?? []).find((m) => m.id === mandateId) ?? activeMandates[0] ?? mandates.data?.[0];

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const budget = useMemo(
    () => budgetFor(mandate, transactions.data ?? [], reservations.data ?? []),
    [mandate, transactions.data, reservations.data],
  );
  const preview = useMemo(
    () => evaluatePolicy(mandate, product, budget),
    [mandate, product, budget],
  );

  const busy =
    phase.kind === "authorizing" || phase.kind === "paying" || phase.kind === "verifying";

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["audit_log"] });
    void queryClient.invalidateQueries({ queryKey: ["mandates"] });
    void queryClient.invalidateQueries({ queryKey: ["budget_reservations"] });
  };

  async function handlePurchase() {
    if (!product || !mandate) return;
    const idempotencyKey = newIdempotencyKey();
    setPhase({ kind: "authorizing" });

    try {
      // The client sends identifiers only — never a price or amount.
      const authorization = await requestAuthorization({
        mandate_id: mandate.id,
        product_id: product.id,
        idempotency_key: idempotencyKey,
      });
      refresh();

      if (!authorization.authorized) {
        const reason = authorization.reason ?? "The policy engine refused this purchase.";
        setPhase({
          kind: "blocked",
          reason,
          ...(authorization.checks
            ? {
                checks: authorization.checks.map((check) => ({
                  label: check.label,
                  passed: check.passed,
                  detail: check.detail ?? (check.passed ? "Passed" : "Failed"),
                })),
              }
            : {}),
        });
        toast.error("Purchase blocked by policy", { description: reason });
        return;
      }

      if (!authorization.razorpay_order_id) {
        setPhase({
          kind: "failed",
          reason: "Authorization succeeded but no payment order was returned.",
        });
        return;
      }

      if (!isRazorpayConfigured) {
        setPhase({
          kind: "failed",
          reason: "Payment checkout is not configured. Set VITE_RAZORPAY_KEY_ID to settle payments.",
        });
        return;
      }

      setPhase({ kind: "paying" });

      await openCheckout({
        orderId: authorization.razorpay_order_id,
        amount: authorization.amount,
        currency: authorization.currency,
        productName: product.name,
        onSuccess: (response) => {
          setPhase({ kind: "verifying" });
          void (async () => {
            try {
              const result = await verifyPayment({
                transaction_id: authorization.transaction_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                idempotency_key: idempotencyKey,
              });
              refresh();
              if (result.success) {
                setPhase({ kind: "success", message: `${product.name} purchased and settled.` });
                toast.success("Payment verified", { description: product.name });
              } else {
                const reason = result.reason ?? "Signature verification failed.";
                setPhase({
                  kind: "failed",
                  reason,
                  policyApproved: true,
                  budgetReleased: result.budget_released ?? true,
                  amount: authorization.amount ?? product.price,
                });
                toast.error("Verification failed", { description: reason });
              }
            } catch (error) {
              const reason = error instanceof Error ? error.message : "Verification failed.";
              setPhase({
                kind: "failed",
                reason,
                policyApproved: true,
                budgetReleased: true,
                amount: authorization.amount ?? product.price,
              });
              toast.error("Verification failed", { description: reason });
            }
          })();
        },
        onFailure: (reason) => {
          void (async () => {
            try {
              await verifyPayment({
                transaction_id: authorization.transaction_id,
                razorpay_order_id: authorization.razorpay_order_id,
                payment_failed: true,
                failure_reason: reason || "Payment rail declined transaction",
                idempotency_key: idempotencyKey,
              });
            } catch (err) {
              console.error("[purchase] failure report", err);
            } finally {
              refresh();
              setPhase({
                kind: "failed",
                reason: reason || "Payment declined by provider.",
                policyApproved: true,
                budgetReleased: true,
                amount: authorization.amount ?? product.price,
              });
              toast.error("Payment failed", { description: reason });
            }
          })();
        },
        onDismiss: () => {
          void (async () => {
            try {
              await verifyPayment({
                transaction_id: authorization.transaction_id,
                razorpay_order_id: authorization.razorpay_order_id,
                payment_failed: true,
                failure_reason: "Checkout modal dismissed before payment completed",
                idempotency_key: idempotencyKey,
              });
            } catch (err) {
              console.error("[purchase] release reservation", err);
            } finally {
              refresh();
              setPhase({
                kind: "failed",
                reason: "Checkout was closed before payment completed. The budget hold has been released.",
                policyApproved: true,
                budgetReleased: true,
                amount: authorization.amount ?? product.price,
              });
              toast.info("Payment cancelled", { description: "Budget returned to mandate." });
            }
          })();
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The purchase could not be started.";
      setPhase({ kind: "failed", reason });
      toast.error("Purchase failed", { description: reason });
      refresh();
    }
  }

  const loading = products.isPending || mandates.isPending;
  const queryError = products.error ?? mandates.error;

  return (
    <>
      <PageHeader
        title="Authorize purchase"
        description="Checks run against the live mandate before any payment is created."
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link to="/products">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to products
            </Link>
          </Button>
        }
      />

      <div className="space-y-4">
        <BackendNotice />

        {!enabled ? null : loading ? (
          <Panel>
            <TableSkeleton rows={4} />
          </Panel>
        ) : queryError ? (
          <Panel>
            <ErrorState error={queryError} />
          </Panel>
        ) : !product ? (
          <Panel>
            <ErrorState error={new Error("This product is not in the catalog.")} />
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Panel title="Order" bodyClassName="px-4 py-4 sm:px-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-foreground">{product.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {product.category ?? "Uncategorized"}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {formatINR(product.price)}
                </p>
              </div>

              <div className="mt-5">
                <label
                  htmlFor="mandate"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                >
                  Purchasing mandate
                </label>
                <Select
                  value={mandate?.id ?? ""}
                  onValueChange={(value) => {
                    setMandateId(value);
                    setPhase({ kind: "idle" });
                  }}
                >
                  <SelectTrigger id="mandate" className="mt-1.5 w-full">
                    <SelectValue placeholder="Select a mandate" />
                  </SelectTrigger>
                  <SelectContent>
                    {(mandates.data ?? []).map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.agent ?? "Agent mandate"}
                        {isMandateActive(option) ? "" : " (inactive)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-2 text-xs text-muted-foreground">
                  The amount is never sent from this page — the gateway prices the order itself.
                </p>
              </div>

              <div className="mt-5 space-y-3">
                <Button
                  type="button"
                  className="w-full"
                  disabled={busy || !mandate || phase.kind === "success"}
                  onClick={() => void handlePurchase()}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {phase.kind === "authorizing"
                    ? "Running policy checks…"
                    : phase.kind === "paying"
                      ? "Awaiting payment…"
                      : phase.kind === "verifying"
                        ? "Verifying signature…"
                        : phase.kind === "success"
                          ? "Completed"
                          : "Authorize and pay"}
                </Button>

                {phase.kind === "success" ? (
                  <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-medium">Purchase settled</p>
                      <p className="text-emerald-700">{phase.message}</p>
                      <button
                        type="button"
                        className="mt-1 text-xs font-medium underline underline-offset-2"
                        onClick={() => void navigate({ to: "/transactions" })}
                      >
                        View transaction
                      </button>
                    </div>
                  </div>
                ) : null}

                {phase.kind === "blocked" ? (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                    <ShieldX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-medium">Blocked before payment</p>
                      <p className="text-red-700">{phase.reason}</p>
                    </div>
                  </div>
                ) : null}

                {phase.kind === "failed" ? (
                  phase.policyApproved ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50/90 p-3.5 text-xs text-amber-950">
                      <div className="flex items-center justify-between border-b border-amber-200/80 pb-2 mb-2.5">
                        <span className="font-semibold uppercase tracking-wider text-[11px] text-amber-900">Payment Outcome</span>
                        <span className="font-medium px-2 py-0.5 rounded bg-amber-200/80 text-amber-950">Resilient Recovery</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center mb-3">
                        <div className="rounded border border-emerald-200 bg-white/90 p-2 shadow-xs">
                          <span className="block text-[10px] font-semibold uppercase text-muted-foreground">Policy</span>
                          <span className="font-bold text-emerald-700 flex items-center justify-center gap-1 mt-0.5">
                            <CheckCircle2 className="size-3.5" /> Approved
                          </span>
                        </div>
                        <div className="rounded border border-red-200 bg-white/90 p-2 shadow-xs">
                          <span className="block text-[10px] font-semibold uppercase text-muted-foreground">Payment</span>
                          <span className="font-bold text-red-700 flex items-center justify-center gap-1 mt-0.5">
                            <XCircle className="size-3.5" /> Failed
                          </span>
                        </div>
                        <div className="rounded border border-emerald-200 bg-white/90 p-2 shadow-xs">
                          <span className="block text-[10px] font-semibold uppercase text-muted-foreground">Budget</span>
                          <span className="font-bold text-emerald-700 flex items-center justify-center gap-1 mt-0.5">
                            <CheckCircle2 className="size-3.5" /> Released
                          </span>
                        </div>
                      </div>
                      <div className="rounded border border-amber-200 bg-amber-100/70 p-2 text-amber-900">
                        <p className="font-semibold text-emerald-800 flex items-center gap-1">
                          <CheckCircle2 className="size-3.5 shrink-0" />
                          {formatINR(phase.amount ?? product.price)} returned to available mandate budget
                        </p>
                        <p className="text-amber-800 mt-1">{phase.reason}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-medium">Payment not completed</p>
                        <p className="text-amber-800">{phase.reason}</p>
                      </div>
                    </div>
                  )
                ) : null}
              </div>
            </Panel>

            <div className="space-y-4">
              <PolicyCheck
                title={phase.kind === "blocked" ? "Gateway decision" : "Pre-flight policy check"}
                checks={phase.kind === "blocked" && phase.checks ? phase.checks : preview.checks}
                approved={phase.kind === "blocked" ? false : phase.kind === "success" ? true : preview.approved}
                reason={
                  phase.kind === "blocked"
                    ? phase.reason
                    : "Indicative only. The database makes the binding decision atomically."
                }
                {...(phase.kind === "authorizing" ? { authorizationLabel: "EVALUATING" } : {})}
              />

              <Panel title="Budget impact" bodyClassName="divide-y divide-border text-sm">
                {[
                  ["Mandate budget", formatINR(budget.total)],
                  ["Already spent", formatINR(budget.spent)],
                  ["Currently reserved", formatINR(budget.reserved)],
                  ["Available now", formatINR(budget.remaining)],
                  ["This order", formatINR(product.price)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 px-4 py-2.5 sm:px-5">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium tabular-nums text-foreground">{value}</span>
                  </div>
                ))}
              </Panel>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
