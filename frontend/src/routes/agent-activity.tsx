import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Radio,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  XCircle,
  FlaskConical,
  Receipt,
  ArrowRight,
  Clock,
  ExternalLink,
} from "lucide-react";

import { PageHeader } from "@/components/layout/AppShell";
import { BackendNotice } from "@/components/common/BackendNotice";
import { EmptyState, ErrorState, Panel, TableSkeleton } from "@/components/common/DataState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Input } from "@/components/ui/input";
import { auditQuery, productsQuery, mandatesQuery } from "@/lib/queries";
import { formatDateTime, formatINR, humanize, shortId } from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSecurityRealtime } from "@/hooks/useRealtime";
import type { AuditEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agent-activity")({
  head: () => ({
    meta: [
      { title: "Agent Activity — AegisBuy" },
      {
        name: "description",
        content:
          "Trace every autonomous shopping decision from agent reasoning to gate authorization and settlement outcomes in real time.",
      },
      { property: "og:title", content: "Agent Activity — AegisBuy" },
      {
        property: "og:description",
        content: "Lifecycle of AI shopper decisions, updated in real time.",
      },
    ],
  }),
  component: AgentActivityPage,
});

type ActivityFilter = "All" | "Simulated" | "Verified Real" | "Declined" | "Gate Blocked";
const filters: readonly ActivityFilter[] = [
  "All",
  "Simulated",
  "Verified Real",
  "Declined",
  "Gate Blocked",
];

interface GroupedActivity {
  id: string;
  transactionId?: string | undefined;
  mandateId?: string | undefined;
  productId?: string | undefined;
  productName?: string | undefined;
  timestamp: string;
  goal?: string | undefined;
  // Step 1: Agent Decision
  agentEvent?: AuditEvent | undefined;
  agentReason?: string | undefined;
  agentAction?: "agent_reasoning" | "agent_declined" | string | undefined;
  // Step 2: Gate Security Evaluation
  gateEvent?: AuditEvent | undefined;
  gateAuthorized?: boolean | undefined;
  gateReason?: string | undefined;
  amount?: number | undefined;
  // Step 3: Settlement
  settlementEvent?: AuditEvent | undefined;
  settlementOutcome?: "simulated_success" | "real_success" | "failed" | "pending" | undefined;
  isSimulated?: boolean | undefined;
  razorpayOrderId?: string | undefined;
  razorpayPaymentId?: string | undefined;
  failureReason?: string | undefined;
  allEvents: AuditEvent[];
}

function isSimulatedEvent(event?: AuditEvent): boolean {
  if (!event) return false;
  if (event.action === "simulation_payment_succeeded" || event.action === "simulation_settled") {
    return true;
  }
  const meta = event.raw?.["metadata"] as Record<string, unknown> | undefined;
  if (meta?.["simulated"] === true || meta?.["is_simulated"] === true) {
    return true;
  }
  const reason = (event.reason ?? "").toLowerCase();
  return reason.includes("simulated") || reason.includes("demo-only");
}

function AgentActivityPage() {
  // Ensure real-time updates are active for this route
  useSecurityRealtime();

  const enabled = isSupabaseConfigured;
  const {
    data: auditData,
    isPending: isAuditPending,
    error: auditError,
  } = useQuery({
    ...auditQuery,
    enabled,
  });
  const { data: products } = useQuery({ ...productsQuery, enabled });
  const { data: mandates } = useQuery({ ...mandatesQuery, enabled });

  const [filter, setFilter] = useState<ActivityFilter>("All");
  const [search, setSearch] = useState("");

  // Product ID to Name map
  const productMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products ?? []) {
      map.set(p.id, p.name);
    }
    return map;
  }, [products]);

  // Group audit events by purchase attempt / transaction
  const activities = useMemo(() => {
    if (!auditData || auditData.length === 0) return [];

    // Relevant actions for agent activity lifecycle
    const targetActions = new Set([
      "agent_reasoning",
      "agent_declined",
      "simulation_payment_succeeded",
      "simulation_settled",
      "payment_succeeded",
      "payment_failed",
      "purchase_authorized",
      "purchase_rejected",
      "payment_started",
    ]);

    const filtered = auditData.filter((e) => targetActions.has(e.action ?? ""));

    // 1. Group events by transaction_id when present
    const txGroups = new Map<string, AuditEvent[]>();
    const nonTxEvents: AuditEvent[] = [];

    for (const event of filtered) {
      if (event.transactionId) {
        const existing = txGroups.get(event.transactionId) ?? [];
        existing.push(event);
        txGroups.set(event.transactionId, existing);
      } else {
        nonTxEvents.push(event);
      }
    }

    const groups: GroupedActivity[] = [];

    // Build items for each transaction group
    for (const [txId, events] of txGroups.entries()) {
      // Sort oldest to newest within the transaction for clean sequence display
      const sortedEvents = [...events].sort((a, b) =>
        (a.timestamp ?? "").localeCompare(b.timestamp ?? ""),
      );

      const authEvent = sortedEvents.find((e) => e.action === "purchase_authorized");
      const rejectEvent = sortedEvents.find((e) => e.action === "purchase_rejected");
      const gateEvent = authEvent ?? rejectEvent;

      const simSuccess = sortedEvents.find(
        (e) => e.action === "simulation_payment_succeeded" || e.action === "simulation_settled",
      );
      const realSuccess = sortedEvents.find((e) => e.action === "payment_succeeded");
      const paymentFail = sortedEvents.find((e) => e.action === "payment_failed");
      const settlementEvent = simSuccess ?? realSuccess ?? paymentFail;

      const meta = (gateEvent?.raw?.["metadata"] ?? settlementEvent?.raw?.["metadata"]) as
        Record<string, unknown> | undefined;
      const productId = (meta?.["product_id"] as string) ?? undefined;
      const mandateId = gateEvent?.mandateId ?? sortedEvents[0]?.mandateId;
      const amount = gateEvent?.amount ?? settlementEvent?.amount;

      let settlementOutcome: GroupedActivity["settlementOutcome"] = undefined;
      if (simSuccess || isSimulatedEvent(settlementEvent)) {
        settlementOutcome = "simulated_success";
      } else if (realSuccess) {
        settlementOutcome = "real_success";
      } else if (paymentFail) {
        settlementOutcome = "failed";
      } else if (authEvent) {
        settlementOutcome = "pending";
      }

      const isSimulated =
        settlementOutcome === "simulated_success" || isSimulatedEvent(settlementEvent);

      const rzpOrderId = (
        settlementEvent?.raw?.["metadata"] as Record<string, unknown> | undefined
      )?.["razorpay_order_id"] as string | undefined;
      const rzpPaymentId = (
        settlementEvent?.raw?.["metadata"] as Record<string, unknown> | undefined
      )?.["razorpay_payment_id"] as string | undefined;

      groups.push({
        id: txId,
        transactionId: txId,
        mandateId,
        productId,
        productName:
          (meta?.["product_name"] as string) || (productId ? productMap.get(productId) : undefined),
        timestamp: sortedEvents[sortedEvents.length - 1]?.timestamp ?? "",
        gateEvent,
        gateAuthorized: Boolean(authEvent),
        gateReason: gateEvent?.reason,
        amount,
        settlementEvent,
        settlementOutcome,
        isSimulated,
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: rzpPaymentId,
        failureReason: paymentFail?.reason,
        allEvents: sortedEvents,
      });
    }

    // Process non-transaction events (agent_reasoning, agent_declined, standalone purchase_rejected)
    // Try to pair agent_reasoning rows with their corresponding transaction if they occurred right before it
    const unmatchedNonTx: AuditEvent[] = [];

    for (const event of nonTxEvents) {
      if (event.action === "agent_reasoning") {
        const meta = event.raw?.["metadata"] as Record<string, unknown> | undefined;
        const proposedProductId = meta?.["proposed_product_id"] as string | undefined;
        const eventTime = new Date(event.timestamp ?? 0).getTime();

        // Match against transaction group on the same mandate and product within 60s
        const match = groups.find((g) => {
          if (g.agentEvent) return false;
          if (g.mandateId !== event.mandateId) return false;
          if (proposedProductId && g.productId && proposedProductId !== g.productId) return false;
          const gTime = new Date(g.timestamp).getTime();
          return Math.abs(gTime - eventTime) < 60000;
        });

        if (match) {
          match.agentEvent = event;
          match.agentReason = event.reason;
          match.agentAction = "agent_reasoning";
          match.goal = meta?.["goal"] as string | undefined;
          if (!match.productId && proposedProductId) {
            match.productId = proposedProductId;
            match.productName = productMap.get(proposedProductId);
          }
        } else {
          unmatchedNonTx.push(event);
        }
      } else {
        unmatchedNonTx.push(event);
      }
    }

    // Convert remaining non-transaction events into standalone cards
    for (const event of unmatchedNonTx) {
      const meta = event.raw?.["metadata"] as Record<string, unknown> | undefined;
      const proposedProductId = meta?.["proposed_product_id"] as string | undefined;
      const productId = (meta?.["product_id"] as string) ?? proposedProductId;

      if (event.action === "agent_declined") {
        groups.push({
          id: event.id,
          mandateId: event.mandateId,
          productId,
          productName: productId ? productMap.get(productId) : undefined,
          timestamp: event.timestamp ?? "",
          goal: meta?.["goal"] as string | undefined,
          agentEvent: event,
          agentReason: event.reason,
          agentAction: "agent_declined",
          allEvents: [event],
        });
      } else if (event.action === "agent_reasoning") {
        groups.push({
          id: event.id,
          mandateId: event.mandateId,
          productId,
          productName: productId ? productMap.get(productId) : undefined,
          timestamp: event.timestamp ?? "",
          goal: meta?.["goal"] as string | undefined,
          agentEvent: event,
          agentReason: event.reason,
          agentAction: "agent_reasoning",
          allEvents: [event],
        });
      } else if (event.action === "purchase_rejected") {
        groups.push({
          id: event.id,
          mandateId: event.mandateId,
          productId,
          productName: productId ? productMap.get(productId) : undefined,
          timestamp: event.timestamp ?? "",
          gateEvent: event,
          gateAuthorized: false,
          gateReason: event.reason,
          amount: event.amount,
          allEvents: [event],
        });
      }
    }

    // Order newest first
    return groups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [auditData, productMap]);

  // Filter & Search
  const filteredActivities = useMemo(() => {
    const term = search.trim().toLowerCase();

    return activities.filter((item) => {
      // Filter tab check
      const matchesFilter =
        filter === "All" ||
        (filter === "Simulated" && item.isSimulated) ||
        (filter === "Verified Real" && item.settlementOutcome === "real_success") ||
        (filter === "Declined" && item.agentAction === "agent_declined") ||
        (filter === "Gate Blocked" &&
          (item.gateAuthorized === false || item.gateEvent?.action === "purchase_rejected"));

      if (!matchesFilter) return false;
      if (!term) return true;

      const haystack = [
        item.productName,
        item.goal,
        item.agentReason,
        item.gateReason,
        item.failureReason,
        item.transactionId,
        item.mandateId,
        item.razorpayOrderId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [activities, filter, search]);

  // Metrics summary
  const metrics = useMemo(() => {
    let simulatedCount = 0;
    let verifiedCount = 0;
    let declinedCount = 0;
    let blockedCount = 0;

    for (const act of activities) {
      if (act.isSimulated) simulatedCount++;
      if (act.settlementOutcome === "real_success") verifiedCount++;
      if (act.agentAction === "agent_declined") declinedCount++;
      if (act.gateAuthorized === false || act.gateEvent?.action === "purchase_rejected")
        blockedCount++;
    }

    return {
      total: activities.length,
      simulated: simulatedCount,
      verified: verifiedCount,
      declined: declinedCount,
      blocked: blockedCount,
    };
  }, [activities]);

  return (
    <>
      <PageHeader
        title="Agent Activity"
        description="Lifecycle of AI shopper decisions: agent reasoning → gate authorization → payment settlement."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
            <Bot className="size-3.5 text-foreground" aria-hidden="true" />
            Autonomous Shopper
          </span>
        }
      />

      <div className="space-y-4">
        <BackendNotice />

        {/* Quick Summary Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-3.5">
            <p className="text-xs font-medium text-muted-foreground">Total Activity</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
              {metrics.total}
            </p>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <FlaskConical className="size-3.5" /> Simulated Settlements
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-amber-900 dark:text-amber-200">
              {metrics.simulated}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" /> Verified Payments
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-900 dark:text-emerald-200">
              {metrics.verified}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3.5">
            <p className="text-xs font-medium text-muted-foreground">Declined or Blocked</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
              {metrics.declined + metrics.blocked}
            </p>
          </div>
        </div>

        <Panel
          title="Autonomous Purchase Attempts"
          description="Grouped end-to-end sequences showing agent reasoning, gate verification, and settlement."
          actions={
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Radio className="size-3.5 text-emerald-600" aria-hidden="true" />
              Live Realtime
            </span>
          }
        >
          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter agent activity">
              {filters.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  aria-pressed={filter === option}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    filter === option
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product, goal, reason or tx ID..."
              aria-label="Search agent activity"
              className="h-8 w-full max-w-xs text-sm sm:ml-auto"
            />
          </div>

          {!enabled ? (
            <EmptyState title="Connect the backend to view agent activity" />
          ) : isAuditPending ? (
            <TableSkeleton rows={4} />
          ) : auditError ? (
            <ErrorState error={auditError} />
          ) : filteredActivities.length === 0 ? (
            <EmptyState
              title="No matching agent activity"
              description="Agent shopper purchase attempts, decisions, and simulated settlements appear here."
            />
          ) : (
            <div className="divide-y divide-border">
              {filteredActivities.map((act) => (
                <ActivityCard key={act.id} activity={act} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function ActivityCard({ activity }: { activity: GroupedActivity }) {
  const isDeclined = activity.agentAction === "agent_declined";
  const isGateBlocked = activity.gateAuthorized === false;

  return (
    <article className="p-4 transition-colors hover:bg-muted/30 sm:p-5">
      {/* Top Card Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {activity.productName
                ? activity.productName
                : activity.goal
                  ? `Goal: ${activity.goal}`
                  : isDeclined
                    ? "Agent Shopping Evaluation (Declined)"
                    : activity.transactionId
                      ? `Transaction ${shortId(activity.transactionId)}`
                      : "Agent Security Evaluation"}
            </h3>

            {/* Badges */}
            {activity.isSimulated ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                <FlaskConical className="size-3" aria-hidden="true" />
                SIMULATED SETTLEMENT (DEMO)
              </span>
            ) : activity.settlementOutcome === "real_success" ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-3" aria-hidden="true" />
                VERIFIED PAYMENT
              </span>
            ) : activity.settlementOutcome === "failed" ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                <XCircle className="size-3" aria-hidden="true" />
                PAYMENT FAILED
              </span>
            ) : isGateBlocked ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300">
                <ShieldAlert className="size-3" aria-hidden="true" />
                GATE BLOCKED
              </span>
            ) : isDeclined ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                <Bot className="size-3" aria-hidden="true" />
                AGENT DECLINED
              </span>
            ) : null}

            {activity.amount !== undefined ? (
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {formatINR(activity.amount)}
              </span>
            ) : null}
          </div>

          <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-muted-foreground">
            {activity.transactionId ? <span>txn: {shortId(activity.transactionId)}</span> : null}
            {activity.mandateId ? <span>mandate: {shortId(activity.mandateId)}</span> : null}
            {activity.razorpayOrderId ? <span>order: {activity.razorpayOrderId}</span> : null}
          </p>
        </div>

        <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatDateTime(activity.timestamp)}
        </time>
      </div>

      {/* 3-Step Lifecycle Sequence */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* STEP 1: Agent Decision */}
        <div
          className={cn(
            "rounded-md border p-3 text-xs",
            isDeclined ? "border-muted bg-muted/20" : "border-border bg-card",
          )}
        >
          <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-border/60">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Bot className="size-3.5 text-primary" aria-hidden="true" />
              1. Agent Decision
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                isDeclined
                  ? "bg-muted text-muted-foreground"
                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              )}
            >
              {isDeclined ? "Declined" : "Purchase"}
            </span>
          </div>

          <div className="mt-2 space-y-1.5">
            {activity.goal ? (
              <p className="text-muted-foreground">
                <strong className="text-foreground font-medium">Goal: </strong>
                {activity.goal}
              </p>
            ) : null}

            <p className="text-foreground">
              <strong className="text-muted-foreground font-medium">Reason: </strong>
              {activity.agentReason ??
                (isDeclined
                  ? "Agent decided not to proceed."
                  : "Agent selected product for purchase.")}
            </p>
          </div>
        </div>

        {/* STEP 2: Mandate Gate */}
        <div
          className={cn(
            "rounded-md border p-3 text-xs",
            isDeclined
              ? "border-muted/40 bg-muted/10 opacity-50"
              : isGateBlocked
                ? "border-red-500/30 bg-red-500/5"
                : "border-border bg-card",
          )}
        >
          <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-border/60">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              {isGateBlocked ? (
                <ShieldAlert className="size-3.5 text-red-500" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden="true" />
              )}
              2. Security Gate
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                isDeclined
                  ? "bg-muted text-muted-foreground"
                  : isGateBlocked
                    ? "bg-red-500/10 text-red-700 dark:text-red-400"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              )}
            >
              {isDeclined ? "Skipped" : isGateBlocked ? "Rejected" : "Approved"}
            </span>
          </div>

          <div className="mt-2 space-y-1.5">
            {isDeclined ? (
              <p className="text-muted-foreground italic">
                Gate check skipped because agent declined purchase.
              </p>
            ) : (
              <>
                <p className="text-foreground">
                  <strong className="text-muted-foreground font-medium">Evaluation: </strong>
                  {activity.gateReason ??
                    (activity.gateAuthorized
                      ? "All policy boundaries & caps verified."
                      : "Rejected by spending gate.")}
                </p>
                {activity.amount !== undefined ? (
                  <p className="text-muted-foreground">
                    <strong className="text-foreground font-medium">Locked Price: </strong>
                    {formatINR(activity.amount)}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* STEP 3: Settlement Outcome */}
        <div
          className={cn(
            "rounded-md border p-3 text-xs",
            isDeclined || isGateBlocked
              ? "border-muted/40 bg-muted/10 opacity-50"
              : activity.isSimulated
                ? "border-amber-500/30 bg-amber-500/5"
                : activity.settlementOutcome === "failed"
                  ? "border-rose-500/30 bg-rose-500/5"
                  : activity.settlementOutcome === "real_success"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border bg-card",
          )}
        >
          <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-border/60">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              {activity.isSimulated ? (
                <FlaskConical
                  className="size-3.5 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
              ) : activity.settlementOutcome === "real_success" ? (
                <Receipt className="size-3.5 text-emerald-600" aria-hidden="true" />
              ) : activity.settlementOutcome === "failed" ? (
                <XCircle className="size-3.5 text-rose-600" aria-hidden="true" />
              ) : (
                <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
              )}
              3. Settlement
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                isDeclined || isGateBlocked
                  ? "bg-muted text-muted-foreground"
                  : activity.isSimulated
                    ? "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                    : activity.settlementOutcome === "real_success"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : activity.settlementOutcome === "failed"
                        ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                        : "bg-sky-500/10 text-sky-700 dark:text-sky-400",
              )}
            >
              {isDeclined || isGateBlocked
                ? "None"
                : activity.isSimulated
                  ? "Simulated"
                  : activity.settlementOutcome === "real_success"
                    ? "Paid"
                    : activity.settlementOutcome === "failed"
                      ? "Failed"
                      : "Pending"}
            </span>
          </div>

          <div className="mt-2 space-y-1.5">
            {isDeclined || isGateBlocked ? (
              <p className="text-muted-foreground italic">No payment initiated.</p>
            ) : activity.isSimulated ? (
              <>
                <p className="text-amber-900 dark:text-amber-300 font-medium">
                  ⚡ Demo Simulated Settlement
                </p>
                <p className="text-muted-foreground text-[11px]">
                  No funds moved. Demo settlement recorded via database simulation function.
                </p>
              </>
            ) : activity.settlementOutcome === "real_success" ? (
              <>
                <p className="text-emerald-900 dark:text-emerald-300 font-medium">
                  ✓ Verified Payment
                </p>
                <p className="text-muted-foreground text-[11px]">
                  Confirmed cryptographically with Razorpay HMAC-SHA256 signature.
                </p>
              </>
            ) : activity.settlementOutcome === "failed" ? (
              <>
                <p className="text-rose-900 dark:text-rose-300 font-medium">Payment Failed</p>
                <p className="text-muted-foreground text-[11px]">
                  {activity.failureReason ??
                    "Charge rejected on payment rail. Budget reservation released."}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground italic">
                Authorized by gate; awaiting payment checkout.
              </p>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
