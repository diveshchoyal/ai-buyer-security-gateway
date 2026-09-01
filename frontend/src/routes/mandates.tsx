import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/layout/AppShell";
import { BackendNotice } from "@/components/common/BackendNotice";
import { EmptyState, ErrorState, Panel, TableSkeleton } from "@/components/common/DataState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Progress } from "@/components/ui/progress";
import { mandatesQuery, reservationsQuery, transactionsQuery } from "@/lib/queries";
import { budgetFor } from "@/lib/policy";
import { formatDateTime, formatINR, shortId } from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/supabase";

export const Route = createFileRoute("/mandates")({
  head: () => ({
    meta: [
      { title: "Mandates — AI Buyer Security Gateway" },
      {
        name: "description",
        content:
          "Spending mandates issued to AI agents: budget ceilings, per-transaction caps, allowed categories and expiry.",
      },
      { property: "og:title", content: "Mandates — AI Buyer Security Gateway" },
      {
        property: "og:description",
        content: "Budget ceilings, per-transaction caps and category rules for each agent.",
      },
    ],
  }),
  component: MandatesPage,
});

function MandatesPage() {
  const enabled = isSupabaseConfigured;
  const mandates = useQuery({ ...mandatesQuery, enabled });
  const transactions = useQuery({ ...transactionsQuery, enabled });
  const reservations = useQuery({ ...reservationsQuery, enabled });

  return (
    <>
      <PageHeader
        title="Mandates"
        description="Each mandate is the authority an agent holds. The gateway refuses anything outside it."
      />

      <div className="space-y-4">
        <BackendNotice />

        {!enabled ? (
          <Panel>
            <EmptyState title="Connect the backend to load mandates" />
          </Panel>
        ) : mandates.isPending ? (
          <Panel>
            <TableSkeleton rows={3} />
          </Panel>
        ) : mandates.error ? (
          <Panel>
            <ErrorState error={mandates.error} />
          </Panel>
        ) : (mandates.data ?? []).length === 0 ? (
          <Panel>
            <EmptyState
              title="No mandates issued"
              description="Mandates created in the database appear here."
            />
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {(mandates.data ?? []).map((mandate) => {
              const budget = budgetFor(mandate, transactions.data ?? [], reservations.data ?? []);
              const used = budget.spent + budget.reserved;
              const pct =
                budget.total && budget.total > 0 ? Math.min((used / budget.total) * 100, 100) : 0;
              return (
                <section
                  key={mandate.id}
                  className="rounded-lg border border-border bg-card px-4 py-4 sm:px-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">
                        {mandate.agent ?? "Agent mandate"}
                      </h2>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {shortId(mandate.id)}
                      </p>
                    </div>
                    <StatusBadge value={mandate.status ?? "active"} />
                  </div>

                  <Progress value={pct} className="mt-4 h-1.5" />
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                    {[
                      ["Budget", formatINR(budget.total)],
                      ["Spent", formatINR(budget.spent)],
                      ["Reserved", formatINR(budget.reserved)],
                      ["Remaining", formatINR(budget.remaining)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="mt-0.5 font-medium tabular-nums text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Per-transaction cap</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {mandate.perTransactionLimit === undefined
                          ? "Not set"
                          : formatINR(mandate.perTransactionLimit)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Expires</span>
                      <span className="font-medium text-foreground">
                        {mandate.expiresAt ? formatDateTime(mandate.expiresAt) : "No expiry"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-muted-foreground">Allowed categories</span>
                      <span className="flex flex-wrap justify-end gap-1">
                        {mandate.categories.length === 0 ? (
                          <span className="font-medium text-foreground">Unrestricted</span>
                        ) : (
                          mandate.categories.map((category) => (
                            <span
                              key={category}
                              className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {category}
                            </span>
                          ))
                        )}
                      </span>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
