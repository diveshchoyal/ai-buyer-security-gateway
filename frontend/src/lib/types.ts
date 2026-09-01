/**
 * The database schema is owned by the backend and is not modified here.
 * Rows are read with `select('*')` and accessed through tolerant getters so
 * minor column-naming differences never crash the UI.
 */
export type Row = Record<string, unknown>;

function pick(row: Row | null | undefined, keys: string[]): unknown {
  if (!row) return undefined;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function str(row: Row | null | undefined, keys: string[]): string | undefined {
  const value = pick(row, keys);
  return value === undefined ? undefined : String(value);
}

export function num(row: Row | null | undefined, keys: string[]): number | undefined {
  const value = pick(row, keys);
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function list(row: Row | null | undefined, keys: string[]): string[] {
  const value = pick(row, keys);
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return value
      .replace(/^[{[]|[}\]]$/g, "")
      .split(",")
      .map((part) => part.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  return [];
}

/* ---------- Products ---------- */

export interface Product {
  id: string;
  name: string;
  category?: string | undefined;
  price?: number | undefined;
  stock?: number | undefined;
  status?: string | undefined;
  raw: Row;
}

export function toProduct(row: Row): Product {
  const paise = num(row, ["price_paise", "price", "amount_paise", "price_inr", "amount", "unit_price"]);
  const price = row["price_paise"] !== undefined && row["price_paise"] !== null
    ? Number(row["price_paise"]) / 100
    : paise;

  const isActive = row["active"] === true || (row["active"] !== false && /active|available/i.test(String(row["status"] ?? "")));

  return {
    id: str(row, ["id", "product_id", "uuid"]) ?? "",
    name: str(row, ["name", "title", "product_name"]) ?? "Untitled product",
    category: str(row, ["category", "product_category", "type"]),
    price,
    stock: num(row, ["stock", "inventory", "quantity", "available_stock"]),
    status: isActive ? "active" : "inactive",
    raw: row,
  };
}

/* ---------- Mandates ---------- */

export interface Mandate {
  id: string;
  agent?: string | undefined;
  status?: string | undefined;
  totalBudget?: number | undefined;
  spent?: number | undefined;
  reserved?: number | undefined;
  perTransactionLimit?: number | undefined;
  categories: string[];
  expiresAt?: string | undefined;
  createdAt?: string | undefined;
  raw: Row;
}

export function toMandate(row: Row): Mandate {
  const totalBudgetPaise = num(row, ["max_total_paise", "total_budget", "budget_limit", "budget", "max_budget"]);
  const perTxPaise = num(row, ["max_transaction_paise", "per_transaction_limit", "transaction_limit"]);
  
  const totalBudget = row["max_total_paise"] !== undefined && row["max_total_paise"] !== null
    ? Number(row["max_total_paise"]) / 100
    : totalBudgetPaise;
    
  const perTransactionLimit = row["max_transaction_paise"] !== undefined && row["max_transaction_paise"] !== null
    ? Number(row["max_transaction_paise"]) / 100
    : perTxPaise;

  return {
    id: str(row, ["id", "mandate_id", "uuid"]) ?? "",
    agent: str(row, ["agent_id", "agent_name", "agent", "actor", "name", "label"]),
    status: str(row, ["status", "state"]),
    totalBudget,
    spent: num(row, ["spent", "spent_amount", "used_amount", "consumed", "total_spent"]),
    reserved: num(row, ["reserved", "reserved_amount", "held_amount"]),
    perTransactionLimit,
    categories: list(row, ["allowed_categories", "categories", "category_whitelist"]),
    expiresAt: str(row, ["expires_at", "valid_until", "expiry", "end_date"]),
    createdAt: str(row, ["created_at", "inserted_at"]),
    raw: row,
  };
}

export function isMandateActive(mandate: Mandate): boolean {
  const status = (mandate.status ?? "active").toLowerCase();
  const notExpired = mandate.expiresAt ? new Date(mandate.expiresAt).getTime() > Date.now() : true;
  return ["active", "approved", "enabled", "valid"].includes(status) && notExpired;
}

/* ---------- Transactions ---------- */

export interface Transaction {
  id: string;
  productId?: string | undefined;
  productName?: string | undefined;
  mandateId?: string | undefined;
  amount?: number | undefined;
  status?: string | undefined;
  orderId?: string | undefined;
  paymentId?: string | undefined;
  reason?: string | undefined;
  createdAt?: string | undefined;
  raw: Row;
}

export function toTransaction(row: Row): Transaction {
  const amount = row["amount_paise"] !== undefined && row["amount_paise"] !== null
    ? Number(row["amount_paise"]) / 100
    : num(row, ["amount", "total", "price", "amount_inr"]);

  return {
    id: str(row, ["id", "transaction_id", "uuid"]) ?? "",
    productId: str(row, ["product_id", "product"]),
    productName: str(row, ["product_name", "item_name", "description"]),
    mandateId: str(row, ["mandate_id", "mandate"]),
    amount,
    status: str(row, ["status", "state", "transaction_status"]),
    orderId: str(row, ["razorpay_order_id", "order_id", "provider_order_id"]),
    paymentId: str(row, ["razorpay_payment_id", "payment_id", "provider_payment_id"]),
    reason: str(row, ["reason", "failure_reason", "message", "note"]),
    createdAt: str(row, ["created_at", "inserted_at", "timestamp"]),
    raw: row,
  };
}

/* ---------- Audit ---------- */

export interface AuditEvent {
  id: string;
  timestamp?: string | undefined;
  actor?: string | undefined;
  action?: string | undefined;
  decision?: string | undefined;
  amount?: number | undefined;
  reason?: string | undefined;
  transactionId?: string | undefined;
  mandateId?: string | undefined;
  raw: Row;
}

export function toAuditEvent(row: Row): AuditEvent {
  const amount = row["amount_paise"] !== undefined && row["amount_paise"] !== null
    ? Number(row["amount_paise"]) / 100
    : num(row, ["amount", "value", "amount_inr"]);

  return {
    id: str(row, ["id", "audit_id", "uuid"]) ?? crypto.randomUUID(),
    timestamp: str(row, ["created_at", "timestamp", "occurred_at", "inserted_at", "event_time"]),
    actor: str(row, ["actor", "actor_type", "actor_name", "source", "performed_by"]),
    action: str(row, ["action", "event", "event_type", "action_type"]),
    decision: str(row, ["decision", "result", "outcome", "status"]),
    amount,
    reason: str(row, ["reason", "details", "message", "note", "description"]),
    transactionId: str(row, ["transaction_id", "txn_id"]),
    mandateId: str(row, ["mandate_id"]),
    raw: row,
  };
}

/* ---------- Budget reservations ---------- */

export interface Reservation {
  id: string;
  mandateId?: string | undefined;
  amount?: number | undefined;
  status?: string | undefined;
  createdAt?: string | undefined;
  raw: Row;
}

export function toReservation(row: Row): Reservation {
  const amount = row["amount_paise"] !== undefined && row["amount_paise"] !== null
    ? Number(row["amount_paise"]) / 100
    : num(row, ["amount", "reserved_amount", "value"]);

  return {
    id: str(row, ["id", "reservation_id"]) ?? "",
    mandateId: str(row, ["mandate_id", "mandate"]),
    amount,
    status: str(row, ["status", "state"]),
    createdAt: str(row, ["created_at", "inserted_at"]),
    raw: row,
  };
}

/* ---------- Semantic status mapping ---------- */

export type Tone = "approved" | "rejected" | "pending" | "neutral";

export function toneFor(value?: string): Tone {
  const v = (value ?? "").toLowerCase();
  if (!v) return "neutral";
  if (/(approve|success|succeed|captur|complete|paid|active|allow|pass)/.test(v)) return "approved";
  if (/(reject|block|fail|denied|declin|error|revok|expired|cancel)/.test(v)) return "rejected";
  if (/(pending|reserved|authoriz|initiat|process|requested|created|await)/.test(v)) return "pending";
  return "neutral";
}
