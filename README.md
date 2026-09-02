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

## Edge Functions (Payment Gateway Layer)

- **`purchase-agent` (`/functions/v1/purchase-agent`)**:
  - Secure entry point for AI Agent purchases.
  - Accepts `{ mandate_id, product_id, idempotency_key }`.
  - Invokes `authorize_purchase()` inside PostgreSQL.
  - On policy rejection: fails closed, returns HTTP 403, and never invokes Razorpay.
  - On policy approval: creates Razorpay order using server-side credentials and returns checkout parameters (`razorpay_order_id`, `amount_paise`, `currency`).
  - Handles idempotent replays by returning existing order state without re-charging.
- **`verify-payment` (`/functions/v1/verify-payment`)**:
  - Server-side cryptographic HMAC-SHA256 signature verification.
  - Compares client order ID against the authoritative database-stored `razorpay_order_id` (never trusts client order ID).
  - Calls `record_payment_result()` on verified signature to finalize settlement (`paid` / `captured`).
  - Implements clean failure path (`payment_failed: true`): transitions transaction to `failed`, safely releases budget reservation back to the mandate, and logs audit events.
- **`agent-shopper` (`/functions/v1/agent-shopper`) — Autonomous AI Shopper**:
  - AI decision layer positioned in front of the purchase authorization gate.
  - Evaluates user goal and mandate constraints against the active catalog using an LLM, selecting at most one item to purchase or declining with clear justification.
  - Submits purchase proposals to the authoritative `purchase-agent` gate, and orchestrates simulated settlements for demo orders.
  - **Request Shape**:
    ```json
    {
      "mandate_id": "10000000-0000-0000-0000-000000000001",
      "goal": "Procure cloud compute instance within allowed categories",
      "actor": "ai_agent:shopper" // Optional, defaults to "ai_agent:shopper"
    }
    ```
  - **Response Shape**:
    - *Purchase Attempt*:
      ```json
      {
        "success": true,
        "action": "purchase",
        "agent_reason": "Selected Cloud Compute Standard meeting compute requirements within mandate budget.",
        "gate_authorized": true,
        "simulated": true,
        "transaction_id": "16a41401-1742-4441-b314-aa197dd5f07d",
        "product_id": "20000000-0000-0000-0000-000000000001",
        "amount_paise": 40000
      }
      ```
    - *Decline*:
      ```json
      {
        "success": true,
        "action": "decline",
        "reason": "Goal asks for items not permitted in mandate allowed_categories.",
        "mandate_id": "10000000-0000-0000-0000-000000000001"
      }
      ```
  - **Environment Variables & Secrets**:
    - `AGENT_LLM_API_KEY` (*Required*): API key for LLM inference (e.g. Groq API key).
    - `AGENT_LLM_MODEL` (*Optional*): Model identifier (defaults to `llama-3.3-70b-versatile` via Groq).
    - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (*Required*): Supabase service credentials.
  - **Database Migration Prerequisite**:
    > [!IMPORTANT]
    > The migration [`supabase/migrations/20260902000000_simulated_settlement.sql`](supabase/migrations/20260902000000_simulated_settlement.sql) adds the `p_simulated` parameter and `simulation_payment_succeeded` audit logging to `record_payment_result()`. **This migration must be applied to the database (not just committed)** before this function will work.

---

## Frontend (Fintech Security Dashboard)

A React + Vite application providing full operational visibility and human oversight:

- **Overview Dashboard**: Live metrics (Active Mandates, Approved/Blocked Decisions, Settled Spend, Realtime Activity).
- **Product Catalog**: Live merchant catalog with prices read directly from PostgreSQL (client prices are display-only).
- **Mandates Management**: Real-time tracking of spend caps, velocity limits, allowed categories, and remaining budgets.
- **Transactions Ledger**: Complete history of authorized, settled, and failed transactions with provider references.
- **Agent Activity**: End-to-end trace of autonomous shopper decisions: agent reasoning (LLM proposal/decline) → security gate authorization → settlement outcome, with distinct badges distinguishing demo simulations from verified payments.
- **Audit Trail**: Real-time append-only stream of policy authorizations, budget reservations, and payment settlements.
- **Interactive Purchase Flow**: Live policy evaluation, atomic PostgreSQL gate execution, Razorpay test checkout, and fail-safe budget release on payment failure.

---

## Project Structure

```
razorpay/
├── frontend/                     # React + Vite frontend dashboard
│   ├── src/
│   │   ├── components/           # UI components (PolicyCheck, AppShell, etc.)
│   │   ├── hooks/                # Realtime subscriptions & state hooks
│   │   ├── lib/                  # Supabase client, queries, types, and Razorpay
│   │   └── routes/               # File-based routes (Overview, Products, Audit, etc.)
│   ├── public/                   # Static assets
│   ├── package.json              # Frontend dependencies
│   └── vite.config.ts            # Vite configuration
│
├── supabase/                     # Supabase Edge Functions & configuration
│   ├── functions/
│   │   ├── agent-shopper/        # Autonomous AI shopping decision maker (LLM)
│   │   ├── purchase-agent/       # Ingress validation & atomic authorization gate
│   │   ├── verify-payment/       # Cryptographic signature verification & settlement
│   │   └── _shared/              # CORS headers & Web Crypto Razorpay helper
│   └── migrations/               # Database migrations
│       └── 20260902000000_simulated_settlement.sql # Simulation settlement parameter
│
├── schema.sql                    # PostgreSQL schema, RLS, functions & audit triggers
├── README.md                     # Full-stack documentation
├── .env.example                  # Environment configuration template
└── .gitignore                    # Git ignore rules (protects credentials & build artifacts)
```

---

## Setup & Deployment

### 1. Database & Edge Functions
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Apply the PostgreSQL schema:
   Execute [`schema.sql`](schema.sql) in your Supabase SQL editor.
3. Deploy Supabase Edge Functions:
   ```bash
   supabase functions deploy purchase-agent --no-verify-jwt
   supabase functions deploy verify-payment --no-verify-jwt
   ```

### 2. Frontend Development & Build
1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   npm install
   ```
2. Configure frontend environment variables in `frontend/.env` or root `.env`:
   ```env
   VITE_SUPABASE_URL=https://your_project_ref_here.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key_here
   VITE_RAZORPAY_KEY_ID=rzp_test_your_key_id_here
   ```
3. Run the development server or build for production:
   ```bash
   npm run dev       # Start local development server
   npm run build     # Build production bundle
   ```
