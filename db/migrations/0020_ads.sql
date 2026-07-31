-- B.2: house ad server. Birq sells ads directly — no external exchange
-- integration. Schema matches the spec's exact tables.
CREATE TABLE advertisers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(120) NOT NULL,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','paused','archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ad_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    advertiser_id UUID NOT NULL REFERENCES advertisers(id),
    name VARCHAR(140) NOT NULL,
    budget_santim BIGINT NOT NULL CHECK (budget_santim > 0),
    spent_santim BIGINT NOT NULL DEFAULT 0,
    cpm_santim BIGINT NOT NULL,          -- cost per 1000 impressions
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','pending_review','active','paused','completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ad_campaigns_status ON ad_campaigns (status, starts_at, ends_at);

CREATE TABLE ad_creatives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    format VARCHAR(30) NOT NULL
        CHECK (format IN ('preroll','midroll','display_banner','sponsored_card','overlay')),
    asset_url TEXT NOT NULL,
    click_url TEXT,
    duration_seconds INTEGER,             -- video formats only
    approved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ad_creatives_campaign ON ad_creatives (campaign_id);

CREATE TABLE ad_targeting (
    campaign_id UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    category VARCHAR(50),
    language VARCHAR(30),
    min_viewers INTEGER
);

CREATE TABLE ad_impressions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creative_id UUID NOT NULL REFERENCES ad_creatives(id),
    stream_id UUID REFERENCES streams(id),
    creator_id UUID REFERENCES users(id),
    viewer_id UUID REFERENCES users(id),   -- nullable, anonymous viewers
    served_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Revenue settlement is batched, not per-impression (see ads/service.ts
    -- settleAdRevenue()) — a popular stream could serve thousands of
    -- impressions a minute, and a real ledger_transaction per impression
    -- is real write amplification for no benefit nobody asked for. A
    -- periodic job (same "reaper" pattern as server.ts's stale-stream and
    -- VOD-cleanup jobs) batches unsettled impressions per creator into one
    -- real ledger transaction.
    settled BOOLEAN NOT NULL DEFAULT FALSE,
    settled_ledger_transaction_id UUID REFERENCES ledger_transactions(id)
);
CREATE INDEX idx_ad_impressions_frequency_cap ON ad_impressions (creative_id, viewer_id, served_at);
CREATE INDEX idx_ad_impressions_unsettled ON ad_impressions (creator_id, settled) WHERE settled = FALSE;

CREATE TABLE ad_clicks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    impression_id UUID NOT NULL REFERENCES ad_impressions(id),
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The /advertisers landing page's inquiry form writes here — a real lead
-- queue for the Birq sales side to follow up on, not a fire-and-forget
-- mailto link.
CREATE TABLE ad_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(140) NOT NULL,
    contact_name VARCHAR(140) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    message TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ad revenue joins the existing ledger as its own transaction type — "one
-- money system, not a parallel one," same instruction the spec gives for
-- gift cards.
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_type_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_type_check
    CHECK (type IN ('topup', 'gift', 'payout', 'refund', 'adjustment', 'subscription', 'boost', 'ad'));

-- Settings extensions: revenue share [CONFIRM] default 5500 (55%, matching
-- Twitch's current split per the spec's own suggestion) and the frequency
-- cap, both admin-editable in Settings with no deploy, same pattern as
-- every other platform_config field.
ALTER TABLE platform_config ADD COLUMN ad_revenue_share_bps INTEGER NOT NULL DEFAULT 5500;
ALTER TABLE platform_config ADD COLUMN ad_frequency_cap_per_hour INTEGER NOT NULL DEFAULT 3;

-- Creator-side opt in/out (Ads Manager) — ads never serve on a creator's
-- stream unless they've turned this on.
ALTER TABLE creator_profiles ADD COLUMN ads_enabled BOOLEAN NOT NULL DEFAULT FALSE;
