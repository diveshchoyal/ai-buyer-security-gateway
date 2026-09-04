import { queryOptions } from "@tanstack/react-query";

import { getSupabase } from "./supabase";
import {
  toAuditEvent,
  toMandate,
  toProduct,
  toReservation,
  toTransaction,
  type AuditEvent,
  type Mandate,
  type Product,
  type Reservation,
  type Row,
  type Transaction,
} from "./types";

/** Human-readable message; the raw error is logged, never rendered. */
export function readableError(error: unknown, subject: string): Error {
  console.error(`[data] ${subject}`, error);
  const message = error instanceof Error ? error.message : String(error);
  if (/not configured/i.test(message)) return new Error(message);
  if (/permission|denied|policy|rls/i.test(message)) {
    return new Error(`Access to ${subject} is restricted by database security policies.`);
  }
  if (/relation|does not exist|schema/i.test(message)) {
    return new Error(`The ${subject} table is not reachable from this project.`);
  }
  if (/fetch|network/i.test(message)) {
    return new Error(`Could not reach the backend while loading ${subject}.`);
  }
  return new Error(`Could not load ${subject}.`);
}

async function selectAll(table: string, subject: string): Promise<Row[]> {
  try {
    const { data, error } = await getSupabase().from(table).select("*");
    if (error) throw error;
    return (data ?? []) as Row[];
  } catch (error) {
    throw readableError(error, subject);
  }
}

export const productsQuery = queryOptions({
  queryKey: ["products"],
  queryFn: async (): Promise<Product[]> =>
    (await selectAll("products", "products"))
      .map(toProduct)
      .sort((a, b) => a.name.localeCompare(b.name)),
});

export const mandatesQuery = queryOptions({
  queryKey: ["mandates"],
  queryFn: async (): Promise<Mandate[]> => (await selectAll("mandates", "mandates")).map(toMandate),
});

export const transactionsQuery = queryOptions({
  queryKey: ["transactions"],
  queryFn: async (): Promise<Transaction[]> =>
    (await selectAll("transactions", "transactions"))
      .map(toTransaction)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
});

export const auditQuery = queryOptions({
  queryKey: ["audit_log"],
  queryFn: async (): Promise<AuditEvent[]> =>
    (await selectAll("audit_log", "the audit log"))
      .map(toAuditEvent)
      .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? "")),
});

export const reservationsQuery = queryOptions({
  queryKey: ["budget_reservations"],
  queryFn: async (): Promise<Reservation[]> =>
    (await selectAll("budget_reservations", "budget reservations")).map(toReservation),
});
