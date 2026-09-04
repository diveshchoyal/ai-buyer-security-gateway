import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck, ShieldX, Wallet, Activity } from "lucide-react";

import { PageHeader } from "@/components/layout/AppShell";
import { BackendNotice } from "@/components/common/BackendNotice";
import { EmptyState, ErrorState, Panel, TableSkeleton } from "@/components/common/DataState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { auditQuery, mandatesQuery, reservationsQuery, transactionsQuery } from "@/lib/queries";
import { budgetFor } from "@/lib/policy";
import { formatDateTime, formatINR, humanize } from "@/lib/format";
import { isMandateActive } from "@/lib/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — AegisBuy" },
      {
        name: "description",
        content:
          "Live view of agent mandates, budget consumption, authorization decisions and payment outcomes.",
      },
      { property: "og:title", content: "Overview — AegisBuy" },
      {
        property: "og:description",
        content: "Live view of agent mandates, budgets and authorization decisions.",
      },
    ],
  }),
  component: Overview,
});

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Wallet;
  tone?: "approved" | "rejected";
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        <Icon
          className={cn(
            "size-4",
            tone === "approved" && "text-emerald-600",
            tone === "rejected" && "text-red-600",
            !tone && "text-muted-foreground",
          )}
          aria-hidden="true"
        />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Overview() {
  const enabled = isSupabaseConfigured;
  const mandates = useQuery({ ...mandatesQuery, enabled });
  const transactions = useQuery({ ...transactionsQuery, enabled });
  const reservations = useQuery({ ...reservationsQuery, enabled });
  const audit = useQuery({ ...auditQuery, enabled });

  const mandateList = mandates.data ?? [];
  const txns = transactions.data ?? [];
  const events = audit.data ?? [];

  const activeMandates = mandateList.filter(isMandateActive);
  const approved = events.filter((e) =>
    /approv|authoriz|success/i.test(e.decision ?? e.action ?? ""),
  );
  const blocked = events.filter((e) =>
    /reject|block|denied|declin/i.test(e.decision ?? e.action ?? ""),
  );
  const settled = txns.filter((t) => /success|captur|paid|complete/i.test(t.status ?? ""));
  const settledTotal = settled.reduce((sum, t) => sum + (t.amount ?? 0), 0);

  const loading = mandates.isPending || transactions.isPending;
  const error = mandates.error ?? transactions.error ?? reservations.error;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every autonomous purchase passes through mandate, category, limit and budget checks before payment."
        actions={
          <Button asChild size="sm">
            <Link to="/products">
              Start a purchase
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <div className="space-y-6">
        <BackendNotice />

        {error ? (
          <Panel>
            <ErrorState error={error} />
          </Panel>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Active mandates"
            value={enabled && !loading ? String(activeMandates.length) : "—"}
            hint={`${mandateList.length} total on record`}
            icon={ShieldCheck}
          />
          <Metric
            label="Approved decisions"
            value={enabled && !audit.isPending ? String(approved.length) : "—"}
            hint="Authorized by policy engine"
            icon={ShieldCheck}
            tone="approved"
          />
          <Metric
            label="Blocked decisions"
            value={enabled && !audit.isPending ? String(blocked.length) : "—"}
            hint="Stopped before payment"
            icon={ShieldX}
            tone="rejected"
          />
          <Metric
            label="Settled spend"
            value={enabled && !loading ? formatINR(settledTotal) : "—"}
            hint={`${settled.length} successful payments`}
            icon={Wallet}
          />
        </div>

        <Panel
          title="Mandate budgets"
          description="Spend and holds are derived from live transaction and reservation rows."
          bodyClassName="divide-y divide-border"
        >
          {!enabled ? (
            <EmptyState title="Connect the backend to load mandates" />
          ) : mandates.isPending ? (
            <TableSkeleton rows={2} />
          ) : mandateList.length === 0 ? (
            <EmptyState
              title="No mandates yet"
              description="Mandates issued to agents appear here."
            />
          ) : (
            mandateList.slice(0, 4).map((mandate) => {
              const budget = budgetFor(mandate, txns, reservations.data ?? []);
              const used = budget.spent + budget.reserved;
              const pct =
                budget.total && budget.total > 0 ? Math.min((used / budget.total) * 100, 100) : 0;
              return (
                <div key={mandate.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {mandate.agent ?? "Agent mandate"}
                      </p>
                      <StatusBadge value={mandate.status ?? "active"} />
                    </div>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {formatINR(used)} of {formatINR(budget.total)}
                    </p>
                  </div>
                  <Progress value={pct} className="mt-3 h-1.5" />
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span>Spent {formatINR(budget.spent)}</span>
                    <span>Reserved {formatINR(budget.reserved)}</span>
                    <span>Remaining {formatINR(budget.remaining)}</span>
                    {mandate.perTransactionLimit !== undefined ? (
                      <span>Per-transaction cap {formatINR(mandate.perTransactionLimit)}</span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </Panel>

        <Panel
          title="Recent security activity"
          description="Immutable decisions recorded by the gateway."
          actions={
            <Button asChild size="sm" variant="ghost">
              <Link to="/audit">
                View audit trail
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          }
        >
          {!enabled ? (
            <EmptyState title="Connect the backend to load activity" />
          ) : audit.isPending ? (
            <TableSkeleton rows={4} />
          ) : audit.error ? (
            <ErrorState error={audit.error} />
          ) : events.length === 0 ? (
            <EmptyState
              title="No activity recorded"
              description="Authorization decisions will stream in here in real time."
            />
          ) : (
            <ul className="divide-y divide-border">
              {events.slice(0, 6).map((event) => (
                <li key={event.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <Activity
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {humanize(event.action) === "—" ? "Event" : humanize(event.action)}
                      </p>
                      <StatusBadge value={event.decision ?? event.action} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {event.reason ?? event.actor ?? "—"}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(event.timestamp)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
