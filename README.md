# AI Buyer Security Gateway

A database-enforced spending gate for autonomous AI purchasing agents on Razorpay — the agent decides, but a Postgres function independently verifies every rupee before it moves.

[Architecture](#architecture) · [Security Model](#security) · [Verification](#verification)

---

## The Problem

Giving an autonomous AI agent direct access to payment credentials or an unrestricted checkout API creates an unacceptable financial liability. LLMs are vulnerable to prompt injection, hallucinated product attributes, and runaway decision loops, meaning that asking "the agent to promise to stay within budget" is not a security boundary. If the enforcement layer lives inside the agent prompt or client-side application code, any compromised or erratic model execution can drain funds instantly.

---

## The Solution

This gateway separates decision-making from monetary authorization by placing an independent, transactional PostgreSQL engine directly in front of the payment rail.

```
AI Agent / Shopper               Database Security Gate                    Payment Rail
┌──────────────────┐            ┌────────────────────────────┐            ┌─────────────────────────┐
│  agent-shopper   │  Proposal  │    authorize_purchase()    │  Approved  │ Razorpay Order Creation │
│  (LLM Decision)  ├───────────►│ (Row Locks & Policy Rules) ├───────────►│ (Real / Simulated Mode) │
└──────────────────┘            └─────────────┬──────────────┘            └────────────┬────────────┘
                                              │                                        │
                                              │ Audit Entries                          │ Checkout / Webhook
                                              ▼                                        ▼
                                ┌────────────────────────────┐            ┌─────────────────────────┐
                                │         audit_log          │◄───────────┤     verify-payment      │
                                │   (Append-Only Trigger)    │ Settlement │ record_payment_result() │
                                └────────────────────────────┘            └─────────────────────────┘
```

1. **Mandates**: A human sets explicit spending boundaries (`mandates` table) specifying permitted categories, per-transaction ceilings, and lifetime budget caps.
2. **Autonomous Proposal**: The `agent-shopper` edge function uses an LLM to evaluate user purchasing goals against catalog items, but possesses zero credential access to move money.
3. **Database Gate**: The `authorize_purchase()` PostgreSQL function independently verifies mandate status, validity dates, category allow-lists, per-transaction limits, and committed balances under an atomic row lock before encumbering funds.
4. **Order Initialization**: Once approved by the database, the `purchase-agent` edge function initializes a Razorpay order (or simulated test order for automated environments).
5. **Settlement Verification**: After payment completion or failure, `verify-payment` cryptographically checks the Razorpay signature and invokes `record_payment_result()` in PostgreSQL to capture or release the reserved budget.
6. **Immutable Audit**: Every proposal, approval, rejection, payment transition, and settlement is recorded in `audit_log`, protected by an engine-level append-only trigger.

---

## Key Features

- **Per-Transaction Spending Caps**: Enforced via `mandates.max_transaction_paise` inside `authorize_purchase()`. Purchases exceeding this threshold fail immediately without generating a payment order.
- **Cumulative Budget Tracking**: Tracks current encumbrances against `mandates.max_total_paise` by summing all active `reserved` and `captured` rows in `budget_reservations`.
- **Category Allow-Lists**: Restricts purchasing agents to authorized merchant categories defined in `mandates.allowed_categories`, blocking unauthorized product types (e.g., blocking `luxury_goods` when only `cloud_compute` is allowed).
- **Atomic Row-Locked Authorization**: Uses `SELECT ... FOR UPDATE` on `mandates` and `SELECT ... FOR SHARE` on `products` within an isolated PostgreSQL transaction, preventing concurrency race conditions and double-spending.
- **Constant-Time HMAC-SHA256 Verification**: Edge function `verify-payment` computes the HMAC-SHA256 signature of `${razorpay_order_id}|${razorpay_payment_id}` using Web Crypto and validates it via `crypto.subtle.timingSafeEqual` to prevent timing attacks.
- **Scoped Idempotency Protection**: Transactions enforce a unique constraint on `(mandate_id, idempotency_key)`. Replaying an authorization request returns the existing transaction with `is_idempotent_replay: true` rather than double-charging.
- **Two-Phase Reserve / Capture / Release Settlement**: Funds are held in `reserved` status inside `budget_reservations` during checkout. Successful payments transition the reservation to `captured`; payment failures or user cancellations transition it to `released`, restoring available budget instantly.
- **Append-Only Audit Trail**: Enforced at the PostgreSQL engine level via trigger `trg_protect_audit_log` on `audit_log`, rejecting all `UPDATE` and `DELETE` queries with SQL state `55000`.
- **Realtime Dashboard Updates**: Live WebSocket subscriptions via Supabase Realtime update transaction status, audit events, and budget usage without polling.
- **Injection-Resistant Agent Shopper**: The `agent-shopper` system prompt treats user goals and catalog metadata as untrusted data, operates at temperature 0, requires structured JSON outputs, and validates product IDs against actual catalog records.

---

## How It Works

The end-to-end purchasing lifecycle executes through the following steps:

1. **Purchase Initiation**:
   A client or autonomous agent sends `POST /functions/v1/purchase-agent` with `mandate_id`, `product_id`, `idempotency_key`, and an optional `actor` tag. Alternatively, `agent-shopper` can be invoked with a natural language goal, which selects a candidate product before submitting to `purchase-agent`.
2. **Database Policy Evaluation (`authorize_purchase`)**:
   `purchase-agent` invokes the PostgreSQL stored procedure `public.authorize_purchase()`:
   - Evaluates `idempotency_key` against existing transactions for the mandate.
   - Acquires a row lock on the mandate with `SELECT * FROM mandates WHERE id = p_mandate_id FOR UPDATE`.
   - Verifies the mandate is `status = 'active'` and `expires_at > now()`.
   - Queries `products.price_paise` using `FOR SHARE` and checks stock (`stock > 0`).
   - Asserts `product.category = ANY(mandate.allowed_categories)`.
   - Confirms `price_paise <= mandate.max_transaction_paise`.
   - Sums existing `reserved` and `captured` amounts in `budget_reservations` to confirm `committed_paise + price_paise <= mandate.max_total_paise`.
3. **Atomic Reservation & Audit Logging**:
   Upon policy approval, `authorize_purchase()` generates a new `transactions` row (`status = 'authorized'`) and creates a corresponding `budget_reservations` row (`status = 'reserved'`). It writes two events to `audit_log` (`purchase_authorized` and `budget_reserved`) and returns the authorization payload.
4. **Razorpay Order Creation**:
   With authorization confirmed, `purchase-agent` calls `createRazorpayOrder()`:
   - In standard mode, it calls the Razorpay API (`POST https://api.razorpay.com/v1/orders`) using server-side credentials.
   - In simulated test mode, it creates a deterministic test order (`order_test_*`).
   - The transaction is updated to `status = 'payment_pending'` with `razorpay_order_id`, and `payment_started` is logged to `audit_log`.
5. **Payment Execution & Client Callback**:
   The frontend displays Razorpay Standard Checkout modal using the returned `razorpay_order_id`. The customer or test environment completes the payment.
6. **Signature Verification (`verify-payment`)**:
   The frontend posts checkout results to `POST /functions/v1/verify-payment`. The function queries `transactions` to fetch the authoritative database-stored `razorpay_order_id` (rejecting any client-supplied mismatch), computes the HMAC-SHA256 signature, and compares it in constant time against `razorpay_signature`.
7. **Settlement Finalization (`record_payment_result`)**:
   - **On Success**: `verify-payment` calls PostgreSQL `record_payment_result()` with `p_payment_success = true`. The transaction updates to `status = 'paid'`, the reservation transitions to `status = 'captured'`, product stock decrements by 1, and `payment_succeeded` and `reservation_captured` are written to `audit_log`.
   - **On Failure / Cancellation**: If the buyer cancels or payment fails, `verify-payment` calls `record_payment_result()` with `p_payment_success = false`. The transaction is marked `failed`, the budget reservation is marked `released`, restoring available funds to the mandate, and `payment_failed` and `reservation_released` are recorded in `audit_log`.

---

## Security <a id="security"></a>

The gateway enforces the principle that **application code and AI models are untrusted; the database is the authoritative perimeter**.

- **Row Level Security (RLS)**:
  All five core tables (`products`, `mandates`, `transactions`, `budget_reservations`, `audit_log`) have RLS enabled. Client roles (`anon`, `authenticated`) have read-only `SELECT` permissions. Direct client `INSERT`, `UPDATE`, or `DELETE` operations are completely denied by database policy. State changes occur exclusively via stored procedures executing with `SECURITY DEFINER` or through edge functions using the service role key.
- **Server-Side Price Validation**:
  Clients pass only a `product_id`. The actual charge amount is read directly from `products.price_paise` under a PostgreSQL `FOR SHARE` lock. Client-supplied prices are neither requested nor accepted.
- **Pessimistic Concurrency Serialization**:
  Concurrent purchase requests against the same mandate are serialized using PostgreSQL `FOR UPDATE` row locking on `mandates`. This mathematically prevents race conditions from exceeding budget limits during simultaneous purchases.
- **HMAC-SHA256 Signature Verification**:
  Payment signatures are generated using the merchant secret and verified on the server side using constant-time comparison (`timingSafeEqual`), preventing signature forgery and timing attacks.
- **Scoped Idempotency Keys**:
  Unique constraints on `(mandate_id, idempotency_key)` prevent duplicate charges from network retries or replay attacks.
- **Database-Enforced Audit Immutability**:
  Trigger `trg_protect_audit_log` intercepts all `UPDATE` and `DELETE` operations on `audit_log`, aborting with exception code `55000` to guarantee a non-repudiable financial audit trail.

### Known Limitations

- **Edge Function Caller Authentication**: Edge functions are currently deployed with `--no-verify-jwt`. While incoming payment signatures and database RPCs are secure, enforcing caller authentication (e.g. Supabase Auth JWTs or API keys on client ingress) remains an open implementation item.
- **External LLM Provider Dependency**: The autonomous `agent-shopper` function relies on an external Groq API key (`AGENT_LLM_API_KEY`). If the key is omitted or the provider experiences downtime, the function fails closed with HTTP 500 (`"Agent shopper failed closed"`), preserving database and financial security.

---

## Verification <a id="verification"></a>

Core money-path behavior has been manually verified end-to-end, including: a purchase within mandate bounds being auto-approved, a purchase exceeding the per-transaction cap being rejected by the gate, a purchase outside the allowed category being rejected, a duplicate request with the same idempotency key being safely deduplicated, and one deliberately triggered payment failure being caught and its budget reservation released.

---

## Architecture <a id="architecture"></a>

### Core Database Tables

- **`products`**: Authoritative catalog containing product titles, descriptions, categories, stock counts, active flags, and server-enforced prices in integer paise.
- **`mandates`**: Autonomous spending rules defining agent identity, allowed categories, single-transaction spending caps, total budget limits, and validity windows.
- **`transactions`**: Authoritative payment state machine tracking mandate associations, product references, status transitions (`authorized`, `payment_pending`, `paid`, `failed`, `cancelled`), and Razorpay order IDs.
- **`budget_reservations`**: Two-phase financial hold ledger tracking reservation lifecycles (`reserved`, `captured`, `released`) tied directly to transaction records.
- **`audit_log`**: Append-only event store recording every gate evaluation, actor, action, reason, amount, and metadata payload.

### Edge Functions

- **`purchase-agent`** (`/functions/v1/purchase-agent`): Secure entry point that orchestrates purchase requests, invokes the `authorize_purchase()` database gate, creates Razorpay orders, and initializes payment tracking.
- **`verify-payment`** (`/functions/v1/verify-payment`): Cryptographically verifies Razorpay payment signatures, invokes `record_payment_result()`, captures or releases budget holds, and updates transaction state.
- **`agent-shopper`** (`/functions/v1/agent-shopper`): Autonomous decision-making layer that evaluates natural-language purchasing goals against mandate rules and catalog items, submitting approved proposals to `purchase-agent`.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, TanStack Router (`@tanstack/react-router`), TanStack Query (`@tanstack/react-query`), Tailwind CSS v4, shadcn/ui (Radix UI primitives), Lucide React.
- **Backend & Serverless**: Supabase Edge Functions (Deno runtime), Web Crypto API for cryptographic operations.
- **Database**: Supabase PostgreSQL 17, Row Level Security (RLS), PL/pgSQL stored procedures, Database Triggers, and Supabase Realtime (WebSocket publication).
- **Payment Processing**: Razorpay (Checkout SDK, API order generation, test-mode signature simulation).
- **AI Inference**: Groq API (Llama 3.3 70B Versatile model with temperature 0 and structured JSON schema enforcement).

---

## Demo Walkthrough

The frontend dashboard provides complete visual verification of the security gateway across these routes:

1. **Overview (`/`)**: View top-level system statistics (Total Authorizations, Settled Volume, Gate Rejections, Active Mandates) and real-time activity feeds.
2. **Mandates (`/mandates`)**: Inspect active agent mandates, including single-transaction caps (e.g., ₹500), cumulative budget limits (e.g., ₹10,000), and permitted category lists (`cloud_compute`, `developer_tools`).
3. **Products (`/products`)**: Browse the merchant catalog with prices queried directly from PostgreSQL.
4. **Purchase & Pre-Flight Gate (`/purchase/:productId`)**:
   - Selecting a product renders the live **Pre-Flight Policy Check**.
   - For an approved item (e.g., *Cloud Compute Standard* at ₹400), the UI confirms all four checks pass (Mandate Active, Category Permitted, Under Per-Transaction Cap, Within Remaining Budget).
   - Clicking **Authorize & Pay** calls `purchase-agent`, generates the Razorpay order, and launches Razorpay Checkout.
   - Completing payment triggers `verify-payment`, updating the view to show cryptographic verification and settled state.
   - For a restricted item (e.g., *GPU Cluster H100* at ₹600 with a ₹500 cap, or *Luxury Chronograph Watch* in `luxury_goods`), the pre-flight check flags the policy violation, and clicking authorize triggers immediate gate rejection (`PER_TRANSACTION_LIMIT_EXCEEDED` or `CATEGORY_NOT_ALLOWED`).
5. **Transactions (`/transactions`)**: Review the full transaction ledger displaying status badges (`paid`, `authorized`, `failed`), associated mandate IDs, product IDs, and Razorpay order/payment identifiers.
6. **Audit Trail (`/audit`)**: Inspect the real-time, append-only event stream showing the step-by-step financial audit entries (`purchase_authorized`, `budget_reserved`, `payment_started`, `payment_succeeded`, `reservation_captured`).
7. **Agent Activity (`/agent-activity`)**: Trace autonomous AI shopper runs, displaying the input purchasing goal, model reasoning, gate authorization status, and final settlement outcome.
8. **Settings (`/settings`)**: Inspect gateway environment variables, Supabase connection status, and Razorpay test mode configuration.
