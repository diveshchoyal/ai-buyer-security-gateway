-- ============================================================================
-- AI-AGENT PURCHASING SYSTEM: DATABASE SECURITY FOUNDATION
-- Migration: 20260901000000_ai_buyer_security_foundation.sql
-- Description: Core tables, constraints, RLS policies, append-only audit log,
--              atomic purchase authorization, and payment reconciliation functions.
-- ============================================================================

-- Ensure required extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ENUMS & DOMAINS
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mandate_status') THEN
        CREATE TYPE mandate_status AS ENUM ('active', 'revoked', 'exhausted', 'expired');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_status') THEN
        CREATE TYPE transaction_status AS ENUM (
            'authorized',
            'payment_pending',
            'paid',
            'failed',
            'rejected',
            'cancelled'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_status') THEN
        CREATE TYPE reservation_status AS ENUM ('reserved', 'captured', 'released');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_decision') THEN
        CREATE TYPE audit_decision AS ENUM ('approved', 'rejected', 'recorded', 'failed');
    END IF;
END $$;

-- ============================================================================
-- 2. TABLE DEFINITIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Products: Merchant catalog (source of truth for pricing)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
    category TEXT NOT NULL,
    stock INTEGER NOT NULL CHECK (stock >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Mandates: Delegated spending authority bounds
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mandates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    max_total_paise INTEGER NOT NULL CHECK (max_total_paise >= 0),
    max_transaction_paise INTEGER NOT NULL CHECK (max_transaction_paise >= 0),
    allowed_categories TEXT[] NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    status mandate_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Security constraints:
    CONSTRAINT chk_mandate_transaction_limit CHECK (max_transaction_paise <= max_total_paise),
    CONSTRAINT chk_mandate_validity_window CHECK (expires_at > valid_from)
);

-- ----------------------------------------------------------------------------
-- Transactions: Intent and execution records
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mandate_id UUID NOT NULL REFERENCES mandates(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    status transaction_status NOT NULL,
    idempotency_key TEXT NOT NULL,
    razorpay_order_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Scoped idempotency boundary: prevents replay per mandate
    CONSTRAINT uq_mandate_idempotency_key UNIQUE (mandate_id, idempotency_key)
);

-- ----------------------------------------------------------------------------
-- Budget Reservations: Encumbered spending against mandate authority
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mandate_id UUID NOT NULL REFERENCES mandates(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    status reservation_status NOT NULL DEFAULT 'reserved',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at TIMESTAMPTZ,

    -- Exact 1-to-1 relationship between transaction and budget reservation
    CONSTRAINT uq_reservation_transaction_id UNIQUE (transaction_id)
);

-- ----------------------------------------------------------------------------
-- Audit Log: Immutable record of all decisions, policy gates, and money movements
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mandate_id UUID REFERENCES mandates(id) ON DELETE SET NULL,
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    decision audit_decision NOT NULL,
    amount_paise INTEGER CHECK (amount_paise IS NULL OR amount_paise >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. IMMUTABILITY & ENGINE-LEVEL AUDIT PROTECTION
-- ============================================================================

-- Enforce append-only semantics on audit_log directly in PostgreSQL
CREATE OR REPLACE FUNCTION prevent_audit_log_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security violation: audit_log records are immutable and append-only. UPDATE and DELETE are prohibited.'
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_audit_log ON audit_log;
CREATE TRIGGER trg_protect_audit_log
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_tampering();

-- Automatic updated_at timestamp trigger for mutable entity tables
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_mandates_updated_at ON mandates;
CREATE TRIGGER trg_mandates_updated_at
    BEFORE UPDATE ON mandates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

-- ============================================================================
-- 4. PERFORMANCE & CONCURRENCY INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(category) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_mandates_agent_status ON mandates(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_mandate_id ON transactions(mandate_id);
CREATE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(mandate_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_reservations_mandate_status ON budget_reservations(mandate_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_mandate_created ON audit_log(mandate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_transaction_created ON audit_log(transaction_id, created_at DESC);

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Products: Public catalog is read-only for active items
CREATE POLICY products_read_active ON products
    FOR SELECT
    TO anon, authenticated
    USING (active = true);

-- Mandates: Agents / authenticated owners can only view their own mandates
CREATE POLICY mandates_select_owner ON mandates
    FOR SELECT
    TO authenticated
    USING (agent_id = auth.uid());

-- Transactions: Agents can view transactions belonging to their mandates
CREATE POLICY transactions_select_owner ON transactions
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM mandates
            WHERE mandates.id = transactions.mandate_id
              AND mandates.agent_id = auth.uid()
        )
    );

-- Budget Reservations: Viewable by mandate owner
CREATE POLICY budget_reservations_select_owner ON budget_reservations
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM mandates
            WHERE mandates.id = budget_reservations.mandate_id
              AND mandates.agent_id = auth.uid()
        )
    );

-- Audit Log: Viewable only by mandate owner
CREATE POLICY audit_log_select_owner ON audit_log
    FOR SELECT
    TO authenticated
    USING (
        mandate_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM mandates
            WHERE mandates.id = audit_log.mandate_id
              AND mandates.agent_id = auth.uid()
        )
    );

-- ============================================================================
-- 6. ATOMIC PURCHASE AUTHORIZATION FUNCTION (FAIL-CLOSED GATE)
-- ============================================================================

CREATE OR REPLACE FUNCTION authorize_purchase(
    p_mandate_id UUID,
    p_product_id UUID,
    p_idempotency_key TEXT,
    p_actor TEXT DEFAULT 'ai_agent'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_mandate mandates%ROWTYPE;
    v_product products%ROWTYPE;
    v_existing_tx transactions%ROWTYPE;
    v_current_committed_paise INTEGER := 0;
    v_new_transaction_id UUID;
    v_new_reservation_id UUID;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- STEP 1: IDEMPOTENCY CHECK
    SELECT *
    INTO v_existing_tx
    FROM transactions
    WHERE mandate_id = p_mandate_id
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        INSERT INTO audit_log (
            mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata
        ) VALUES (
            p_mandate_id, v_existing_tx.id, p_actor, 'purchase_requested',
            'Idempotent replay detected', 'recorded', v_existing_tx.amount_paise,
            jsonb_build_object(
                'idempotency_key', p_idempotency_key,
                'existing_status', v_existing_tx.status,
                'replayed', true
            )
        );

        RETURN jsonb_build_object(
            'success', (v_existing_tx.status IN ('authorized', 'payment_pending', 'paid')),
            'authorized', (v_existing_tx.status IN ('authorized', 'payment_pending', 'paid')),
            'is_idempotent_replay', true,
            'transaction_id', v_existing_tx.id,
            'amount_paise', v_existing_tx.amount_paise,
            'status', v_existing_tx.status,
            'razorpay_order_id', v_existing_tx.razorpay_order_id
        );
    END IF;

    -- STEP 2: PESSIMISTIC LOCK ON MANDATE
    SELECT *
    INTO v_mandate
    FROM mandates
    WHERE id = p_mandate_id
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected', 'Mandate not found', 'rejected',
            jsonb_build_object('product_id', p_product_id, 'idempotency_key', p_idempotency_key)
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'MANDATE_NOT_FOUND',
            'message', 'The specified mandate does not exist.'
        );
    END IF;

    -- STEP 3: MANDATE STATUS & TEMPORAL BOUNDS
    IF v_mandate.status != 'active' THEN
        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected',
            format('Mandate is not active (current status: %s)', v_mandate.status), 'rejected',
            jsonb_build_object('mandate_status', v_mandate.status, 'product_id', p_product_id)
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'MANDATE_INACTIVE',
            'message', format('Mandate is currently %s.', v_mandate.status)
        );
    END IF;

    IF v_now < v_mandate.valid_from THEN
        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected', 'Mandate not yet valid', 'rejected',
            jsonb_build_object('valid_from', v_mandate.valid_from, 'evaluated_at', v_now)
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'MANDATE_NOT_YET_VALID',
            'message', 'Mandate validity window has not started.'
        );
    END IF;

    IF v_now > v_mandate.expires_at THEN
        UPDATE mandates SET status = 'expired' WHERE id = p_mandate_id;

        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected', 'Mandate has expired', 'rejected',
            jsonb_build_object('expires_at', v_mandate.expires_at, 'evaluated_at', v_now)
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'MANDATE_EXPIRED',
            'message', 'Mandate has expired.'
        );
    END IF;

    -- STEP 4: SERVER-SIDE PRODUCT PRICING & STOCK CHECK
    SELECT *
    INTO v_product
    FROM products
    WHERE id = p_product_id
    FOR SHARE;

    IF NOT FOUND THEN
        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected', 'Product not found', 'rejected',
            jsonb_build_object('product_id', p_product_id)
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'PRODUCT_NOT_FOUND',
            'message', 'The requested product does not exist.'
        );
    END IF;

    IF NOT v_product.active THEN
        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected', 'Product is inactive', 'rejected',
            jsonb_build_object('product_id', p_product_id, 'product_name', v_product.name)
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'PRODUCT_INACTIVE',
            'message', 'The product is currently unavailable.'
        );
    END IF;

    IF v_product.stock <= 0 THEN
        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected', 'Product out of stock', 'rejected',
            jsonb_build_object('product_id', p_product_id, 'stock', v_product.stock)
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'OUT_OF_STOCK',
            'message', 'Product is out of stock.'
        );
    END IF;

    -- STEP 5: CATEGORY RESTRICTION CHECK
    IF NOT (v_product.category = ANY(v_mandate.allowed_categories)) THEN
        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected',
            format('Category "%s" not permitted by mandate', v_product.category), 'rejected',
            jsonb_build_object(
                'product_id', p_product_id,
                'category', v_product.category,
                'allowed_categories', v_mandate.allowed_categories
            )
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'CATEGORY_NOT_ALLOWED',
            'message', format('Category "%s" is not in allowed categories.', v_product.category)
        );
    END IF;

    -- STEP 6: PER-TRANSACTION LIMIT CHECK
    IF v_product.price_paise > v_mandate.max_transaction_paise THEN
        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, amount_paise, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected',
            format('Price (%s paise) exceeds per-transaction limit (%s paise)',
                   v_product.price_paise, v_mandate.max_transaction_paise),
            'rejected',
            v_product.price_paise,
            jsonb_build_object(
                'product_id', p_product_id,
                'price_paise', v_product.price_paise,
                'max_transaction_paise', v_mandate.max_transaction_paise
            )
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'PER_TRANSACTION_LIMIT_EXCEEDED',
            'message', 'Item price exceeds per-transaction spending limit.',
            'price_paise', v_product.price_paise,
            'max_transaction_paise', v_mandate.max_transaction_paise
        );
    END IF;

    -- STEP 7: TOTAL MANDATE BUDGET CAP CHECK
    SELECT COALESCE(SUM(amount_paise), 0)
    INTO v_current_committed_paise
    FROM budget_reservations
    WHERE mandate_id = p_mandate_id
      AND status IN ('reserved', 'captured');

    IF (v_current_committed_paise + v_product.price_paise) > v_mandate.max_total_paise THEN
        INSERT INTO audit_log (
            mandate_id, actor, action, reason, decision, amount_paise, metadata
        ) VALUES (
            p_mandate_id, p_actor, 'purchase_rejected',
            format('Purchase would exceed total mandate limit. Committed: %s, Price: %s, Max: %s',
                   v_current_committed_paise, v_product.price_paise, v_mandate.max_total_paise),
            'rejected',
            v_product.price_paise,
            jsonb_build_object(
                'committed_paise', v_current_committed_paise,
                'price_paise', v_product.price_paise,
                'max_total_paise', v_mandate.max_total_paise,
                'remaining_paise', (v_mandate.max_total_paise - v_current_committed_paise)
            )
        );

        RETURN jsonb_build_object(
            'success', false,
            'authorized', false,
            'error_code', 'TOTAL_BUDGET_EXCEEDED',
            'message', 'Purchase exceeds total remaining mandate budget.',
            'price_paise', v_product.price_paise,
            'committed_paise', v_current_committed_paise,
            'remaining_paise', (v_mandate.max_total_paise - v_current_committed_paise),
            'max_total_paise', v_mandate.max_total_paise
        );
    END IF;

    -- STEP 8: ATOMIC CREATION OF TRANSACTION & BUDGET RESERVATION
    v_new_transaction_id := gen_random_uuid();
    v_new_reservation_id := gen_random_uuid();

    INSERT INTO transactions (
        id, mandate_id, product_id, amount_paise, status, idempotency_key
    ) VALUES (
        v_new_transaction_id, p_mandate_id, p_product_id, v_product.price_paise, 'authorized', p_idempotency_key
    );

    INSERT INTO budget_reservations (
        id, mandate_id, transaction_id, amount_paise, status
    ) VALUES (
        v_new_reservation_id, p_mandate_id, v_new_transaction_id, v_product.price_paise, 'reserved'
    );

    INSERT INTO audit_log (
        mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata
    ) VALUES (
        p_mandate_id, v_new_transaction_id, p_actor, 'purchase_authorized',
        'All gate security policies verified successfully', 'approved', v_product.price_paise,
        jsonb_build_object(
            'product_id', p_product_id,
            'product_name', v_product.name,
            'category', v_product.category,
            'new_committed_paise', (v_current_committed_paise + v_product.price_paise),
            'remaining_paise', (v_mandate.max_total_paise - (v_current_committed_paise + v_product.price_paise))
        )
    );

    INSERT INTO audit_log (
        mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata
    ) VALUES (
        p_mandate_id, v_new_transaction_id, p_actor, 'budget_reserved',
        'Funds encumbered prior to external payment gateway call', 'approved', v_product.price_paise,
        jsonb_build_object('reservation_id', v_new_reservation_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'authorized', true,
        'is_idempotent_replay', false,
        'transaction_id', v_new_transaction_id,
        'reservation_id', v_new_reservation_id,
        'amount_paise', v_product.price_paise,
        'product_id', p_product_id,
        'mandate_id', p_mandate_id,
        'status', 'authorized'
    );
END;
$$;

-- ============================================================================
-- 7. PAYMENT SETTLEMENT & RECONCILIATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION record_payment_result(
    p_transaction_id UUID,
    p_payment_success BOOLEAN,
    p_razorpay_order_id TEXT DEFAULT NULL,
    p_razorpay_payment_id TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL,
    p_actor TEXT DEFAULT 'edge_function:payment_worker'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tx transactions%ROWTYPE;
    v_res budget_reservations%ROWTYPE;
BEGIN
    SELECT *
    INTO v_tx
    FROM transactions
    WHERE id = p_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_NOT_FOUND');
    END IF;

    SELECT *
    INTO v_res
    FROM budget_reservations
    WHERE transaction_id = p_transaction_id
    FOR UPDATE;

    IF v_tx.status IN ('paid', 'failed', 'cancelled') THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Transaction already finalized',
            'status', v_tx.status,
            'already_settled', true
        );
    END IF;

    IF p_payment_success THEN
        UPDATE transactions
        SET status = 'paid',
            razorpay_order_id = COALESCE(p_razorpay_order_id, razorpay_order_id)
        WHERE id = p_transaction_id;

        UPDATE budget_reservations
        SET status = 'captured'
        WHERE id = v_res.id;

        UPDATE products
        SET stock = stock - 1
        WHERE id = v_tx.product_id AND stock > 0;

        INSERT INTO audit_log (
            mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata
        ) VALUES (
            v_tx.mandate_id, v_tx.id, p_actor, 'payment_succeeded',
            'Razorpay payment verified and confirmed', 'approved', v_tx.amount_paise,
            jsonb_build_object(
                'razorpay_order_id', p_razorpay_order_id,
                'razorpay_payment_id', p_razorpay_payment_id
            )
        );

        INSERT INTO audit_log (
            mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata
        ) VALUES (
            v_tx.mandate_id, v_tx.id, p_actor, 'reservation_captured',
            'Budget reservation finalized into permanent spend', 'approved', v_tx.amount_paise,
            jsonb_build_object('reservation_id', v_res.id)
        );

        RETURN jsonb_build_object(
            'success', true,
            'status', 'paid',
            'transaction_id', v_tx.id,
            'amount_paise', v_tx.amount_paise
        );

    ELSE
        UPDATE transactions
        SET status = 'failed',
            razorpay_order_id = COALESCE(p_razorpay_order_id, razorpay_order_id)
        WHERE id = p_transaction_id;

        UPDATE budget_reservations
        SET status = 'released',
            released_at = now()
        WHERE id = v_res.id;

        INSERT INTO audit_log (
            mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata
        ) VALUES (
            v_tx.mandate_id, v_tx.id, p_actor, 'payment_failed',
            COALESCE(p_failure_reason, 'External payment gateway rejected charge'), 'failed', v_tx.amount_paise,
            jsonb_build_object(
                'razorpay_order_id', p_razorpay_order_id,
                'failure_reason', p_failure_reason
            )
        );

        INSERT INTO audit_log (
            mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata
        ) VALUES (
            v_tx.mandate_id, v_tx.id, p_actor, 'reservation_released',
            'Budget returned to mandate following payment failure', 'recorded', v_tx.amount_paise,
            jsonb_build_object('reservation_id', v_res.id)
        );

        RETURN jsonb_build_object(
            'success', true,
            'status', 'failed',
            'transaction_id', v_tx.id,
            'budget_released', true
        );
    END IF;
END;
$$;

-- ============================================================================
-- 8. SWEEP FUNCTION: AUTO-RELEASE ORPHANED / STALE RESERVATIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION release_expired_reservations(p_timeout_minutes INT DEFAULT 15)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stale_record RECORD;
    v_count INTEGER := 0;
BEGIN
    FOR v_stale_record IN
        SELECT r.id AS reservation_id, r.mandate_id, r.transaction_id, r.amount_paise
        FROM budget_reservations r
        JOIN transactions t ON t.id = r.transaction_id
        WHERE r.status = 'reserved'
          AND t.status IN ('authorized', 'payment_pending')
          AND r.created_at < (now() - (p_timeout_minutes || ' minutes')::interval)
        FOR UPDATE OF r
    LOOP
        UPDATE budget_reservations
        SET status = 'released', released_at = now()
        WHERE id = v_stale_record.reservation_id;

        UPDATE transactions
        SET status = 'cancelled'
        WHERE id = v_stale_record.transaction_id;

        INSERT INTO audit_log (
            mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata
        ) VALUES (
            v_stale_record.mandate_id,
            v_stale_record.transaction_id,
            'system:reconciliation_worker',
            'reservation_released',
            'Auto-released stale budget reservation after timeout',
            'recorded',
            v_stale_record.amount_paise,
            jsonb_build_object('timeout_minutes', p_timeout_minutes)
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;
