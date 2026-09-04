import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/layout/AppShell";
import { BackendNotice } from "@/components/common/BackendNotice";
import { EmptyState, ErrorState, Panel, TableSkeleton } from "@/components/common/DataState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { productsQuery } from "@/lib/queries";
import { formatINR } from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/supabase";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products — AegisBuy" },
      {
        name: "description",
        content:
          "Catalog available to autonomous agents. Prices are read from the database and never trusted from the client.",
      },
      { property: "og:title", content: "Products — AegisBuy" },
      {
        property: "og:description",
        content: "Catalog available to autonomous agents, priced by the database.",
      },
    ],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  const { data, isPending, error } = useQuery({ ...productsQuery, enabled: isSupabaseConfigured });

  return (
    <>
      <PageHeader
        title="Products"
        description="Prices shown here are read from the database. The client never sends an amount when purchasing."
      />
      <div className="space-y-4">
        <BackendNotice />
        <Panel bodyClassName="overflow-hidden">
          {!isSupabaseConfigured ? (
            <EmptyState title="Connect the backend to load products" />
          ) : isPending ? (
            <TableSkeleton />
          ) : error ? (
            <ErrorState error={error} />
          ) : data && data.length > 0 ? (
            <>
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Product
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Category
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      Price
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      Stock
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.map((product) => (
                    <tr key={product.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-5 py-3 font-medium text-foreground">{product.name}</td>
                      <td className="px-5 py-3 text-muted-foreground">{product.category ?? "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatINR(product.price)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {product.stock ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge value={product.status ?? "available"} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/purchase/$productId" params={{ productId: product.id }}>
                            Purchase
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul className="divide-y divide-border md:hidden">
                {data.map((product) => (
                  <li key={product.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{product.category ?? "—"}</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">
                        {formatINR(product.price)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <StatusBadge value={product.status ?? "available"} />
                      <Button asChild size="sm" variant="outline">
                        <Link to="/purchase/$productId" params={{ productId: product.id }}>
                          Purchase
                        </Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              title="No products yet"
              description="Products added to the database will appear here."
            />
          )}
        </Panel>
      </div>
    </>
  );
}
