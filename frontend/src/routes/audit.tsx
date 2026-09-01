import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Lock, Radio } from "lucide-react";

import { PageHeader } from "@/components/layout/AppShell";
import { BackendNotice } from "@/components/common/BackendNotice";
import { EmptyState, ErrorState, Panel, TableSkeleton } from "@/components/common/DataState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Input } from "@/components/ui/input";
import { auditQuery } from "@/lib/queries";
import { formatDateTime, formatINR, humanize, shortId } from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/supabase";
import { toneFor } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — AI Buyer Security Gateway" },
      {
        name: "description",
        content:
          "Append-only record of every authorization decision, budget reservation and payment outcome, streaming in real time.",
      },
      { property: "og:title", content: "Audit Trail — AI Buyer Security Gateway" },
      {
        property: "og:description",
        content: "Append-only record of every gateway decision, updated in real time.",
      },
    ],
  }),
  component: AuditPage,
});

const filters = ["All", "Approved", "Blocked", "Pending"] as const;

function AuditPage() {
  const enabled = isSupabaseConfigured;
  const { data, isPending, error } = useQuery({ ...auditQuery, enabled });
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [search, setSearch] = useState("");

  const events = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((event) => {
      const tone = toneFor(event.decision ?? event.action);
      const matchesFilter =
        filter === "All" ||
        (filter === "Approved" && tone === "approved") ||
        (filter === "Blocked" && tone === "rejected") ||
        (filter === "Pending" && tone === "pending");
      if (!matchesFilter) return false;
      if (!term) return true;
      return [event.action, event.actor, event.reason, event.decision, event.transactionId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [data, filter, search]);

  return (
    <>
      <PageHeader
        title="Audit Trail"
        description="Append-only. Every decision the gateway made, in the order it made them."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            Immutable
          </span>
        }
      />

      <div className="space-y-4">
        <BackendNotice />

        <Panel
          title="Decision log"
          description="Updates stream in live as agents transact."
          actions={
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Radio className="size-3.5 text-emerald-600" aria-hidden="true" />
              Live
            </span>
          }
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter decisions">
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
              placeholder="Search actor, action or reason"
              aria-label="Search the audit trail"
              className="h-8 w-full max-w-xs text-sm sm:ml-auto"
            />
          </div>

          {!enabled ? (
            <EmptyState title="Connect the backend to load the audit trail" />
          ) : isPending ? (
            <TableSkeleton rows={6} />
          ) : error ? (
            <ErrorState error={error} />
          ) : events.length === 0 ? (
            <EmptyState
              title="No matching events"
              description="Decisions appear here the moment an agent attempts a purchase."
            />
          ) : (
            <ol className="divide-y divide-border">
              {events.map((event) => {
                const tone = toneFor(event.decision ?? event.action);
                return (
                  <li key={event.id} className="flex gap-3 px-4 py-3 sm:px-5">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        tone === "approved" && "bg-emerald-500",
                        tone === "rejected" && "bg-red-500",
                        tone === "pending" && "bg-amber-500",
                        tone === "neutral" && "bg-muted-foreground/40",
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {humanize(event.action) === "—" ? "Gateway event" : humanize(event.action)}
                        </p>
                        <StatusBadge value={event.decision ?? event.action} />
                        {event.amount !== undefined ? (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatINR(event.amount)}
                          </span>
                        ) : null}
                      </div>
                      {event.reason ? (
                        <p className="mt-0.5 text-sm text-muted-foreground">{event.reason}</p>
                      ) : null}
                      <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-muted-foreground">
                        <span>{event.actor ?? "system"}</span>
                        {event.transactionId ? <span>txn {shortId(event.transactionId)}</span> : null}
                        {event.mandateId ? <span>mandate {shortId(event.mandateId)}</span> : null}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(event.timestamp)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
}
