import { Check, X, Minus, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PolicyCheckItem } from "@/lib/policy";

interface PolicyCheckProps {
  checks: PolicyCheckItem[];
  approved: boolean | null;
  reason?: string | undefined;
  /** Label under AUTHORIZATION. Defaults to APPROVED / BLOCKED / PENDING. */
  authorizationLabel?: string | undefined;
  title?: string;
  className?: string;
}

function Mark({ passed }: { passed: boolean | null }) {
  if (passed === null)
    return <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return passed ? (
    <Check className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
  ) : (
    <X className="size-4 shrink-0 text-red-600" aria-hidden="true" />
  );
}

export function PolicyCheck({
  checks,
  approved,
  reason,
  authorizationLabel,
  title = "Policy check",
  className,
}: PolicyCheckProps) {
  const Icon = approved === true ? ShieldCheck : approved === false ? ShieldAlert : ShieldQuestion;
  const label = authorizationLabel ?? (approved === true ? "APPROVED" : approved === false ? "BLOCKED" : "PENDING");

  return (
    <section
      className={cn("rounded-lg border border-border bg-card", className)}
      aria-label={title}
    >
      <header className="border-b border-border px-4 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h3>
      </header>

      <ul className="divide-y divide-border">
        {checks.map((check) => (
          <li
            key={check.label}
            className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm"
          >
            <span className="text-muted-foreground">{check.label}</span>
            <span
              className={cn(
                "flex items-center gap-1.5 text-right font-medium tabular-nums",
                check.passed === false ? "text-red-700" : "text-foreground",
              )}
            >
              <Mark passed={check.passed} />
              {check.detail}
            </span>
          </li>
        ))}
      </ul>

      <footer
        className={cn(
          "flex items-center justify-between gap-4 border-t border-border px-4 py-3",
          approved === true && "bg-emerald-50/70",
          approved === false && "bg-red-50/70",
        )}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Authorization
        </span>
        <span
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold tracking-wide",
            approved === true && "text-emerald-700",
            approved === false && "text-red-700",
            approved === null && "text-muted-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </span>
      </footer>

      {reason ? (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">{reason}</p>
      ) : null}
    </section>
  );
}
