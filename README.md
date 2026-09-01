# AI Buyer Security Gateway

The **AI Buyer Security Gateway** is an enterprise-grade Supabase & PostgreSQL security foundation for an AI-agent purchasing system. It enables autonomous AI agents to purchase products from a merchant catalog using **delegated spending authority**, while enforcing that **the database is the immutable security boundary**.

Every financial action is:
1. **Explainable**: Clear machine-readable reasons and human-readable audit logs for every decision.
2. **Bounded**: Hard spending limits (lifetime total + velocity per-transaction limits) and category whitelists.
3. **Gated**: Multi-condition policy gate executed atomically inside PostgreSQL before any payment order is generated.
4. **Auditable**: Append-only, engine-level protected audit log that cannot be modified or purged.
5. **Resilient**: Clean separation between policy decisions and payment rail outcomes, with automatic reservation release on failure.

---

## Architecture & Security Principles

- **Zero-Trust Client Pricing**: The AI agent never supplies price or currency amount. Product price is authoritatively retrieved server-side from `products.price_paise` using a row-level `FOR SHARE` lock.
- **Integer Paise Representation**: All monetary figures are stored as integer paise (`CHECK (price_paise >= 0)`), completely eliminating floating-point errors.
- **Pessimistic Concurrency Locking**: The authorization function locks the mandate row (`SELECT ... FOR UPDATE`), serializing concurrent purchase attempts and mathematically preventing overspending.
- **Append-Only Audit Log**: Enforced via PostgreSQL trigger (`BEFORE UPDATE OR DELETE`) raising exception code `55000`.
- **Scoped Idempotency**: Transactions enforce `UNIQUE(mandate_id, idempotency_key)`, guaranteeing exact-once authorization across network retries.
- **Two-Phase Payment Settlement**:
  - `authorize_purchase()`: Encumbers budget as `reserved` in `budget_reservations` and creates an `authorized` transaction.
  - External payment gateway (Razorpay) is invoked **only after** authorization succeeds.
  - `record_payment_result()`:
    - On payment success: marks transaction `paid`, captures reservation `captured`, and decrements inventory.
    - On payment failure: marks transaction `failed`, safely releases the reservation `released`, instantly restoring the mandate's available budget.

---

## Database Schema

- **`products`**: Authoritative catalog containing `price_paise`, `category`, `stock`, and `active`.
- **`mandates`**: Delegated authority containing `agent_id`, `max_total_paise`, `max_transaction_paise`, `allowed_categories`, `valid_from`, `expires_at`, and `status`.
- **`transactions`**: Financial intent records with `mandate_id`, `product_id`, `amount_paise`, `status`, `idempotency_key`, and `razorpay_order_id`.
- **`budget_reservations`**: 1-to-1 link to transaction tracking active holds (`reserved`, `captured`, `released`).
- **`audit_log`**: Immutable audit records capturing actor, action, reason, decision, amount, and structured JSONB metadata.

---

## Setup & Deployment

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Apply the PostgreSQL schema:
   Execute [`schema.sql`](schema.sql) in your Supabase SQL editor or via the Supabase CLI migration pipeline.
