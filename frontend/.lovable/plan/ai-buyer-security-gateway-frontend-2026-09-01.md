# AI Buyer Security Gateway — Frontend

A minimal, production-grade fintech UI for controlled autonomous purchasing, wired to your existing Supabase project and Razorpay test checkout.

## Configuration (no credentials in chat, none hardcoded)

The app reads everything from environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_RAZORPAY_KEY_ID`

No service-role key and no Razorpay secret ever enter the frontend. A single browser Supabase client is created from those variables; if any is missing, the app renders a clear "backend not configured" state instead of crashing or faking data. No new Supabase project is created and no schema changes are made — the UI reads the existing `products`, `mandates`, `transactions`, `budget_reservations`, and `audit_log` tables. If RLS blocks a read, the page shows a professional error/empty state, never mock rows.

The `purchase-agent` and `verify-payment` Edge Functions are invoked for real. Until they exist, the purchase flow surfaces an explicit "authorization service unavailable" development state — no simulated approval, no simulated payment.


## Design system

- Neutral base: white/near-white surfaces, charcoal text, 1px light-gray borders, minimal shadows.
- Status colors, muted: green (approved), red (rejected/failed), amber (pending). One restrained slate-blue accent for primary actions.
- Modern sans-serif (Inter-class), compact dashboard scale, tabular numerals for all currency.
- Mobile-first, no horizontal overflow: tables collapse to stacked cards below `md`.

## App shell

Persistent left sidebar on desktop ("AI Buyer" wordmark; Overview, Products, Mandates, Transactions, Audit Trail; Settings pinned to bottom). On mobile, a compact top bar with a slide-in drawer.

## Pages

**Overview** — four compact metric cards (Available Budget, Authorized Today, Successful Payments, Blocked Requests), all computed from the database. Active Mandate panel with agent, status, limits, allowed categories, expiry, and a horizontal budget-usage bar with the remaining amount as the prominent number. Below it, the Security Activity table (Time, Agent, Action, Amount, Decision, Reason) with subtle status dots. A compact AI Agent Activity panel shows the observable step list (goal, checks passed, authorization requested) plus demo trigger buttons for the three scenarios.

**Products** — catalog with Product, Category, Price, Stock, Status and a Purchase button per row. Prices are display-only; the client never sends an amount.

**Purchase flow** — confirmation panel showing product, category, DB price, active mandate, per-transaction limit, remaining budget, and the reusable Policy Check component. "Continue to Payment" calls the real `purchase-agent` function with `{ product_id, mandate_id, idempotency_key }`. On rejection: "Purchase blocked" with the reason and the per-check pass/fail list — no Razorpay order is created. On authorization: "Purchase authorized" state, then the real Razorpay test checkout opens; the handler calls `verify-payment`. Success shows amount, product, transaction ID, status; failure clearly separates Policy ✓ Approved / Payment ✕ Failed / Budget ✓ Released.

**Mandates** — table of all mandates with full limit/usage/category/expiry detail. Create Mandate form with a "Delegated Authority" summary shown before saving. Revoke Mandate behind a serious confirmation dialog.

**Transactions** — table (ID, Product, Amount, Mandate, Status, Razorpay Order, Date). Row click opens a detail drawer with the Policy Check block and a lifecycle timeline built from that transaction's audit events: requested → policy evaluated → authorized → budget reserved → payment started → succeeded/failed → captured/released.

**Audit Trail** — the hero security page. Header plus subtitle, a dense timeline/table of Timestamp, Actor, Action, Decision, Amount, Reason, and filter chips (All / Approved / Rejected / Failed / Pending). Subscribes to Supabase realtime on `audit_log` so new events appear live during the demo.

**Settings** — minimal: connection status, mandate defaults display, no invented features.

## Behavior

- Skeleton loaders on every data surface; professional empty states; human-readable error messages (raw Postgres/function errors are logged, never shown).
- Purchase button states: normal / loading / success / error / disabled. A `crypto.randomUUID()` idempotency key is generated per attempt and reused across retries of that attempt, so double-clicks cannot create duplicate requests.
- Realtime on `audit_log` and `transactions`; other views invalidate their queries on those events.

## Technical notes

- TanStack Start + TanStack Query. One typed Supabase browser client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`; no service-role key, no Razorpay secret in the client.
- Data access lives in a small set of query modules (`products`, `mandates`, `transactions`, `audit`), so every page reads real rows.
- Edge Functions invoked with `supabase.functions.invoke('purchase-agent' | 'verify-payment')`.
- Razorpay checkout script loaded on demand, test key only; verification is server-side.
- Each route gets its own `head()` metadata; tables use semantic markup and responsive card fallbacks.
