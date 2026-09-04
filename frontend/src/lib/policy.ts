import {
  isMandateActive,
  type Mandate,
  type Product,
  type Reservation,
  type Transaction,
} from "./types";
import { formatINR } from "./format";

export interface PolicyCheckItem {
  label: string;
  passed: boolean | null; // null = not evaluable (data unavailable)
  detail: string;
}

export interface PolicyEvaluation {
  checks: PolicyCheckItem[];
  approved: boolean | null;
  blockedReason: string | undefined;
}

export interface BudgetSnapshot {
  total: number | undefined;
  spent: number;
  reserved: number;
  remaining: number | undefined;
}

const SETTLED_SPEND = /(success|succeed|captur|paid|complete)/i;
const HELD = /(reserv|hold|active|pending)/i;

/** Budget derived from real mandate limits, transactions and reservations. */
export function budgetFor(
  mandate: Mandate | undefined,
  transactions: Transaction[],
  reservations: Reservation[],
): BudgetSnapshot {
  if (!mandate) return { total: undefined, spent: 0, reserved: 0, remaining: undefined };

  const spentFromRows = transactions
    .filter((t) => t.mandateId === mandate.id && SETTLED_SPEND.test(t.status ?? ""))
    .reduce((sum, t) => sum + (t.amount ?? 0), 0);

  const reservedFromRows = reservations
    .filter((r) => r.mandateId === mandate.id && HELD.test(r.status ?? "active"))
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);

  const spent = mandate.spent ?? spentFromRows;
  const reserved = mandate.reserved ?? reservedFromRows;
  const total = mandate.totalBudget;
  const remaining = total === undefined ? undefined : Math.max(total - spent - reserved, 0);

  return { total, spent, reserved, remaining };
}

/**
 * Client-side preview of the policy the database enforces. This is display
 * only — the authoritative decision always comes from `authorize_purchase`
 * via the `purchase-agent` function.
 */
export function evaluatePolicy(
  mandate: Mandate | undefined,
  product: Product | undefined,
  budget: BudgetSnapshot,
): PolicyEvaluation {
  const checks: PolicyCheckItem[] = [];

  if (!mandate) {
    return {
      checks: [{ label: "Mandate", passed: false, detail: "No mandate selected" }],
      approved: false,
      blockedReason: "No active mandate is available for this purchase.",
    };
  }

  const active = isMandateActive(mandate);
  checks.push({
    label: "Mandate",
    passed: active,
    detail: active ? "Active" : `Not active${mandate.status ? ` (${mandate.status})` : ""}`,
  });

  const categoryAllowed =
    mandate.categories.length === 0
      ? null
      : product?.category
        ? mandate.categories.some((c) => c.toLowerCase() === product.category!.toLowerCase())
        : null;
  checks.push({
    label: "Category",
    passed: categoryAllowed,
    detail:
      categoryAllowed === null
        ? "No category restriction on record"
        : categoryAllowed
          ? "Allowed"
          : `${product?.category} is not permitted`,
  });

  const limit = mandate.perTransactionLimit;
  const price = product?.price;
  const withinLimit = limit === undefined || price === undefined ? null : price <= limit;
  checks.push({
    label: "Transaction limit",
    passed: withinLimit,
    detail:
      limit === undefined
        ? "No per-transaction limit on record"
        : withinLimit === false
          ? `Exceeds ${formatINR(limit)}`
          : `Within ${formatINR(limit)}`,
  });

  const remaining = budget.remaining;
  const withinBudget = remaining === undefined || price === undefined ? null : price <= remaining;
  checks.push({
    label: "Remaining budget",
    passed: withinBudget,
    detail:
      remaining === undefined
        ? "Budget not available"
        : withinBudget === false
          ? `${formatINR(remaining)} available, ${formatINR(price)} required`
          : `${formatINR(remaining)} available`,
  });

  const failed = checks.find((c) => c.passed === false);
  const unknown = checks.some((c) => c.passed === null);
  const approved = failed ? false : unknown ? null : true;

  return {
    checks,
    approved,
    blockedReason: failed ? `${failed.label}: ${failed.detail}` : undefined,
  };
}
