-- B.3: gift cards — buy Birq wallet credit for someone else, culturally
-- themed. Schema matches the spec's exact table.
CREATE TABLE gift_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    amount_santim BIGINT NOT NULL CHECK (amount_santim > 0),
    design_theme VARCHAR(40) NOT NULL,
    personal_message VARCHAR(300),
    purchaser_id UUID REFERENCES users(id),
    recipient_phone VARCHAR(20),
    recipient_email VARCHAR(255),
    ledger_transaction_id UUID REFERENCES ledger_transactions(id),
    status VARCHAR(20) NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued','redeemed','expired','cancelled')),
    redeemed_by UUID REFERENCES users(id),
    redeemed_at TIMESTAMPTZ,
    scheduled_delivery_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gift_cards_status ON gift_cards (status, created_at);
CREATE INDEX idx_gift_cards_purchaser ON gift_cards (purchaser_id);

-- Same "one money system, not a parallel one" instruction as ad revenue.
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_type_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_type_check
    CHECK (type IN ('topup', 'gift', 'payout', 'refund', 'adjustment', 'subscription', 'boost', 'ad', 'gift_card'));

-- Expiry [CONFIRM] default 12 months — flagged in the report as worth a
-- lawyer's read on consumer-protection implications, same category as the
-- CSAM escalation doc and Chapa/NBE licensing.
ALTER TABLE platform_config ADD COLUMN gift_card_expiry_months INTEGER NOT NULL DEFAULT 12;
