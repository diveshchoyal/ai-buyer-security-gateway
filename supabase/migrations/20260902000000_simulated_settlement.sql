-- Demo-only simulation marker for settlement auditability.
-- Real Razorpay settlement continues through verify-payment and HMAC verification.

CREATE OR REPLACE FUNCTION record_payment_result(
    p_transaction_id UUID,
    p_payment_success BOOLEAN,
    p_razorpay_order_id TEXT DEFAULT NULL,
    p_razorpay_payment_id TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL,
    p_actor TEXT DEFAULT 'edge_function:payment_worker',
    p_simulated BOOLEAN DEFAULT false
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
    SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_NOT_FOUND'); END IF;

    SELECT * INTO v_res FROM budget_reservations WHERE transaction_id = p_transaction_id FOR UPDATE;
    IF v_tx.status IN ('paid', 'failed', 'cancelled') THEN
        RETURN jsonb_build_object('success', true, 'message', 'Transaction already finalized', 'status', v_tx.status, 'already_settled', true);
    END IF;

    IF p_payment_success THEN
        IF p_simulated = false AND p_razorpay_payment_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_ID_REQUIRED');
        END IF;

        UPDATE transactions SET status = 'paid', razorpay_order_id = COALESCE(p_razorpay_order_id, razorpay_order_id) WHERE id = p_transaction_id;
        UPDATE budget_reservations SET status = 'captured' WHERE id = v_res.id;
        UPDATE products SET stock = stock - 1 WHERE id = v_tx.product_id AND stock > 0;

        INSERT INTO audit_log (mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata)
        VALUES (
            v_tx.mandate_id, v_tx.id, p_actor,
            CASE WHEN p_simulated THEN 'simulation_payment_succeeded' ELSE 'payment_succeeded' END,
            CASE WHEN p_simulated THEN 'Demo-only simulated settlement; no Razorpay payment was cryptographically verified.' ELSE 'Razorpay payment verified and confirmed' END,
            'approved', v_tx.amount_paise,
            jsonb_build_object('razorpay_order_id', p_razorpay_order_id, 'razorpay_payment_id', p_razorpay_payment_id, 'simulated', p_simulated)
        );

        INSERT INTO audit_log (mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata)
        VALUES (v_tx.mandate_id, v_tx.id, p_actor, 'reservation_captured', 'Budget reservation finalized into permanent spend', 'approved', v_tx.amount_paise, jsonb_build_object('reservation_id', v_res.id, 'simulated', p_simulated));

        RETURN jsonb_build_object('success', true, 'status', 'paid', 'transaction_id', v_tx.id, 'amount_paise', v_tx.amount_paise, 'simulated', p_simulated);
    ELSE
        UPDATE transactions SET status = 'failed', razorpay_order_id = COALESCE(p_razorpay_order_id, razorpay_order_id) WHERE id = p_transaction_id;
        UPDATE budget_reservations SET status = 'released', released_at = now() WHERE id = v_res.id;
        INSERT INTO audit_log (mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata)
        VALUES (v_tx.mandate_id, v_tx.id, p_actor, 'payment_failed', COALESCE(p_failure_reason, 'External payment gateway rejected charge'), 'failed', v_tx.amount_paise, jsonb_build_object('razorpay_order_id', p_razorpay_order_id, 'failure_reason', p_failure_reason));
        INSERT INTO audit_log (mandate_id, transaction_id, actor, action, reason, decision, amount_paise, metadata)
        VALUES (v_tx.mandate_id, v_tx.id, p_actor, 'reservation_released', 'Budget returned to mandate following payment failure', 'recorded', v_tx.amount_paise, jsonb_build_object('reservation_id', v_res.id));
        RETURN jsonb_build_object('success', true, 'status', 'failed', 'transaction_id', v_tx.id, 'budget_released', true);
    END IF;
END;
$$;
