import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/layout/AppShell";
import { BackendNotice } from "@/components/common/BackendNotice";
import { EmptyState, ErrorState, Panel, TableSkeleton } from "@/components/common/DataState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { productsQuery, transactionsQuery } from "@/lib/queries";
import { formatDateTime, formatINR, shortId } from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/supabase";

export const Route = createFileRoute("/transactions")({
  head: () => ({
    meta: [
      { title: "Transactions — AegisBuy" },
      {
        name: "description",
        content:
          "Authorized, settled and failed agent transactions with provider order and payment references.",
      },
      { property: "og:title", content: "Transactions — AegisBuy" },
      {
        property: "og:description",
        content: "Authorized, settled and failed agent transactions in one ledger.",
      },
    ],
  }),
  component: TransactionsPage,
});

function TransactionsPage() {
  const enabled = isSupabaseConfigured;
  const { data, isPending, error } = useQuery({ ...transactionsQuery, enabled });
  const products = useQuery({ ...productsQuery, enabled });

  const nameFor = (productId?: string) => products.data?.find((p) => p.id === productId)?.name;

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every payment attempt the gateway authorized, settled or refused."
      />

      <div className="space-y-4">
        <BackendNotice />
        <Panel bodyClassName="overflow-hidden">
          {!enabled ? (
            <EmptyState title="Connect the backend to load transactions" />
          ) : isPending ? (
            <TableSkeleton />
          ) : error ? (
            <ErrorState error={error} />
          ) : (data ?? []).length === 0 ? (
            <EmptyState
              title="No transactions yet"
              description="Complete a purchase from the Products page to see it here."
            />
          ) : (
            <>
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      When
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Item
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      References
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(data ?? []).map((txn) => (
                    <tr key={txn.id} className="align-top transition-colors hover:bg-muted/40">
                      <td className="whitespace-nowrap px-5 py-3 tabular-nums text-muted-foreground">
                        {formatDateTime(txn.createdAt)}
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">
                          {txn.productName ?? nameFor(txn.productId) ?? "Purchase"}
                        </p>
                        {txn.reason ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">{txn.reason}</p>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatINR(txn.amount)}</td>
                      <td className="px-5 py-3">
                        <StatusBadge value={txn.status} />
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                        <p>Order {shortId(txn.orderId)}</p>
                        <p>Payment {shortId(txn.paymentId)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul className="divide-y divide-border md:hidden">
                {(data ?? []).map((txn) => (
                  <li key={txn.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">
                        {txn.productName ?? nameFor(txn.productId) ?? "Purchase"}
                      </p>
                      <p className="text-sm font-semibold tabular-nums">{formatINR(txn.amount)}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge value={txn.status} />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatDateTime(txn.createdAt)}
                      </span>
                    </div>
                    {txn.reason ? (
                      <p className="text-xs text-muted-foreground">{txn.reason}</p>
                    ) : null}
                    <p className="font-mono text-[11px] text-muted-foreground">
                      Order {shortId(txn.orderId)} · Payment {shortId(txn.paymentId)}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
