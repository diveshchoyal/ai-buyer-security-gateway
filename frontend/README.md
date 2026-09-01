# AI Buyer Gateway

Build the frontend for my existing project:

AI Buyer Security Gateway

IMPORTANT:

This is a fintech/security product, so the UI must feel trustworthy, professional, minimal and production-quality.

DESIGN DIRECTION

Take visual inspiration from Razorpay's current product/dashboard aesthetic:

- clean

- minimal

- professional

- spacious

- modern SaaS/fintech

- strong typography

- subtle borders

- restrained shadows

- clear hierarchy

- excellent whitespace

- responsive

- fast and lightweight

DO NOT copy Razorpay's branding, logo, exact layouts, proprietary assets, or exact visual design.

Instead create an original UI with a similar level of polish and simplicity.

Avoid:

- excessive gradients

- glassmorphism everywhere

- neon colors

- excessive animations

- huge hero sections

- unnecessary illustrations

- overly rounded "AI startup" cards

- cluttered dashboards

- fake 3D elements

The product should feel like a serious financial security platform.

COLOR SYSTEM

Use a mostly neutral interface:

- white / very light background

- dark charcoal text

- subtle gray borders

- restrained green for approved/success

- restrained red for rejected/failure

- amber for pending/approval required

- one subtle accent color

Do not use lots of colors.

TYPOGRAPHY

Use a modern professional sans-serif.

Prioritize:

- readability

- hierarchy

- compact dashboard typography

- clear numbers

MOBILE FIRST

The entire application must work properly on:

- desktop

- laptop

- tablet

- mobile

No horizontal overflow.

==================================================

APPLICATION STRUCTURE

==================================================

Create a responsive application shell:

LEFT SIDEBAR / DESKTOP NAV

Logo:

AI Buyer

Navigation:

Overview

Products

Mandates

Transactions

Audit Trail

Bottom:

Settings

On mobile:

Use a compact top navigation / drawer.

==================================================

1. OVERVIEW DASHBOARD

==================================================

This is the main screen.

Top:

"AI Buyer Security Gateway"

Small description:

"Controlled autonomous purchasing with policy enforcement and complete auditability."

Show four compact metric cards:

Available Budget

Authorized Today

Successful Payments

Blocked Requests

Then:

ACTIVE MANDATE

Display:

Agent

Status: Active

Total Limit

Used

Remaining

Per Transaction Limit

Allowed Categories

Expires

Use a clean horizontal progress indicator for budget usage.

Example:

₹1,000 limit

₹400 used

₹600 remaining

Make the remaining amount visually prominent.

==================================================

2. SECURITY ACTIVITY

==================================================

Create a clean activity table.

Columns:

Time

Agent

Action

Amount

Decision

Reason

Example rows:

Purchase authorized

₹400

Approved

Purchase rejected

₹600

Rejected

"Exceeds per-transaction limit"

Payment failed

₹400

Failed

"Razorpay payment declined"

Each row should have a subtle status indicator.

Approved → green

Rejected → red

Pending → amber

Failed → red

Do NOT make these colors overly bright.

==================================================

3. PRODUCTS

==================================================

Create a clean merchant catalog.

Product cards/table should show:

Product

Category

Price

Stock

Status

Example:

Cloud Compute Standard

cloud_compute

₹400

Available

Developer IDE Pro

developer_tools

₹299

Available

GPU Cluster H100

cloud_compute

₹600

Available

Luxury Chronograph

luxury_goods

₹800

Available

Each product should have:

"Purchase"

button.

IMPORTANT:

The frontend must NOT control the actual purchase amount.

The backend/database remains the authoritative source of price.

The UI should only send:

product_id

mandate_id

idempotency_key

==================================================

4. PURCHASE FLOW

==================================================

When the user clicks Purchase:

Open a clean confirmation panel.

Show:

Product

Category

Database price

Active mandate

Maximum transaction limit

Remaining mandate budget

Example:

Cloud Compute Standard

₹400

Mandate:

AI Buyer — Development

Remaining budget:

₹600

Transaction limit:

₹500

Category:

✓ Allowed

Then:

"Continue to Payment"

IMPORTANT:

Do not show a fake authorization result.

Call the real Supabase Edge Function.

Flow:

Frontend

→ purchase-agent Edge Function

→ authorize_purchase()

→ Razorpay

If policy rejects:

Show:

"Purchase blocked"

Reason:

"Transaction exceeds your delegated spending limit."

Also show:

Policy checks:

✓ Mandate active

✓ Category allowed

✕ Transaction limit exceeded

✓ Total budget available

This is extremely important for the demo.

==================================================

5. PAYMENT EXPERIENCE

==================================================

For an authorized purchase:

Show a clean payment state:

"Purchase authorized"

"Your spending mandate approved this transaction."

Then launch the Razorpay TEST MODE checkout.

Do not create a fake payment interface.

After payment:

SUCCESS:

"Payment successful"

Show:

Amount

Product

Transaction ID

Payment status

FAILURE:

"Payment failed"

Explain:

"The spending authorization succeeded, but the payment provider rejected the transaction."

Show:

Policy:

✓ Approved

Payment:

✕ Failed

Budget:

✓ Released

This distinction is one of the key features of the product.

==================================================

6. MANDATES

==================================================

Create a clean mandate management page.

Show:

Mandate ID

Agent

Status

Total Limit

Per Transaction

Used

Remaining

Categories

Expiry

Include:

"Create Mandate"

form.

Fields:

Agent

Total spending limit

Maximum transaction

Allowed categories

Start date

Expiry date

Create a visual summary before saving:

Delegated Authority

Total:

₹1,000

Per transaction:

₹500

Allowed:

cloud_compute

developer_tools

Expiry:

...

Also include:

"Revoke Mandate"

with a confirmation dialog.

Make revocation visually clear and serious.

==================================================

7. TRANSACTIONS

==================================================

Create a professional transaction table.

Columns:

Transaction ID

Product

Amount

Mandate

Status

Razorpay Order

Date

Clicking a transaction opens a detail drawer.

Detail drawer should show the complete lifecycle:

Purchase requested

↓

Policy evaluated

↓

Authorized

↓

Budget reserved

↓

Payment started

↓

Payment succeeded / failed

↓

Reservation captured / released

This timeline is important for the demo.

==================================================

8. AUDIT TRAIL

==================================================

This is the HERO security page.

Make it visually impressive but still minimal.

Header:

"Audit Trail"

Subtitle:

"Immutable record of every authorization decision and payment event."

Display audit events in a timeline/table.

Each event should show:

Timestamp

Actor

Action

Decision

Amount

Reason

Example:

18:42:11

ai_agent

purchase_requested

Recorded

₹400

18:42:11

edge_function

purchase_authorized

Approved

₹400

18:42:11

edge_function

budget_reserved

Approved

₹400

18:42:14

payment_worker

payment_succeeded

Approved

₹400

For rejection:

purchase_rejected

Rejected

Reason:

"Category luxury_goods is not permitted by the active mandate."

For payment failure:

purchase_authorized

Approved

payment_failed

Failed

reservation_released

Recorded

Add filters:

All

Approved

Rejected

Failed

Pending

==================================================

9. SECURITY VISUALIZATION

==================================================

Add a small reusable "Policy Check" component.

Example:

SECURITY CHECK

Mandate

✓ Active

Category

✓ Allowed

Transaction Limit

✓ Within ₹500

Total Budget

✓ ₹600 remaining

Authorization

✓ APPROVED

For rejected transactions:

Authorization

✕ BLOCKED

Make this component appear inside transaction details and purchase confirmation.

==================================================

10. AI AGENT ACTIVITY

==================================================

Create a small AI activity panel.

Do NOT expose private chain-of-thought.

Only show concise decision explanations.

Example:

AI Buyer

Goal:

"Find a cloud compute product under ₹500."

Activity:

✓ Found Cloud Compute Standard

₹400

✓ Category permitted

✓ Within transaction limit

✓ Within remaining budget

→ Requesting authorization

→ Payment authorized

This should feel like an observable agent workflow, not a chatbot.

==================================================

TECHNICAL REQUIREMENTS

==================================================

Use the existing Supabase backend.

Do NOT create a new backend.

Do NOT create fake/mock financial data once real database integration is available.

Connect to the existing:

products

mandates

transactions

budget_reservations

audit_log

Use the existing Edge Functions when they become available:

purchase-agent

verify-payment

The frontend must never use:

SUPABASE_SERVICE_ROLE_KEY

The browser must only use the public/publishable Supabase credential.

Never expose Razorpay secret credentials.

==================================================

DATA BEHAVIOR

==================================================

Use real Supabase data.

Dashboard metrics should be calculated from the database.

Audit Trail should update when new audit events occur.

Use Supabase realtime where appropriate so the audit activity can update without manually refreshing the page.

Loading states:

Use elegant skeleton loaders.

Empty states:

Make them useful and professional.

Errors:

Show clear human-readable errors.

Never show raw database errors or stack traces to users.

==================================================

UX PRINCIPLES

==================================================

The user should understand the system within 10 seconds.

The primary story should always be obvious:

AI wants to buy

↓

Mandate checks

↓

Policy decision

↓

Payment

↓

Audit trail

Use subtle transitions only where useful.

Buttons must have clear states:

Normal

Loading

Success

Error

Disabled

Never allow double-clicking Purchase to create duplicate requests.

Generate idempotency keys on the client for each purchase attempt.

==================================================

DEMO PRIORITY

==================================================

Optimize the UI for a 5-minute buildathon demonstration.

The demo should easily show:

1. Active ₹1,000 mandate

2. AI selects ₹400 allowed product

3. Policy checks pass

4. Razorpay checkout opens

5. Payment succeeds

6. Audit trail updates

Then demonstrate:

7. Select ₹600 product with ₹500 transaction limit

8. Policy blocks it

9. No Razorpay payment is created

10. Audit trail shows the rejection

Then:

11. Authorized purchase

12. Razorpay test payment failure

13. Transaction becomes FAILED

14. Reservation becomes RELEASED

15. Audit trail shows the complete lifecycle

This should be the visual heart of the application.

==================================================

IMPORTANT

==================================================

Do not overbuild.

Prioritize:

1. Excellent UX

2. Clean fintech visual design

3. Real Supabase integration

4. Purchase flow

5. Policy visualization

6. Audit trail

7. Responsive design

Do not add unnecessary:

- chat interfaces

- crypto features

- complex animations

- social features

- analytics unrelated to purchasing

- unnecessary pages

Build the frontend as a serious fintech security product, not a generic AI dashboard.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d11049a4-8049-4951-bffc-8fcd4220ffe0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
