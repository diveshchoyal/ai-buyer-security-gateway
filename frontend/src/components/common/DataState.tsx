import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function TableSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-4", className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
      <span className="sr-only">Loading data</span>
    </div>
  );
}

export function ErrorState({ error, className }: { error: unknown; className?: string }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}
    >
      <AlertTriangle className="size-5 text-amber-600" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">Data unavailable</p>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      <Inbox className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
