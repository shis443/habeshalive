-- Birq database schema — machine-generated from production.
--
-- Regenerated 2026-08-02 via `pg_dump --schema-only --no-owner
-- --no-privileges --no-tablespaces` against the real production Neon
-- database, replacing a hand-maintained version of this file that had
-- drifted significantly out of sync with db/migrations/ (it covered only
-- 22 of the 45 tables that actually exist — missing platform_config,
-- gift_cards, stream_boosts, every ad_* table, notifications,
-- admin_actions, announcements, creator_applications, and more — found
-- during a 2026-08-02 codebase-hygiene audit).
--
-- This file is a snapshot for reference (schema shape, constraints,
-- indexes) — it is NOT applied directly. Migrations in db/migrations/
-- remain the actual source of truth for how the schema evolves, and are
-- also where the "why" behind specific design decisions lives (this dump
-- has none of that narrative — read the migration that introduced a given
-- table/column for the reasoning behind it).
--
-- To regenerate: `pg_dump --schema-only --no-owner --no-privileges
-- --no-tablespaces "$DATABASE_URL" > db/schema.sql`, then strip pg_dump's
-- session-scoped SET/\restrict lines the same way this version did.


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';



--
-- Name: ad_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_campaigns (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    advertiser_id uuid NOT NULL,
    name character varying(140) NOT NULL,
    budget_santim bigint NOT NULL,
    spent_santim bigint DEFAULT 0 NOT NULL,
    cpm_santim bigint NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_campaigns_budget_santim_check CHECK ((budget_santim > 0)),
    CONSTRAINT ad_campaigns_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'pending_review'::character varying, 'active'::character varying, 'paused'::character varying, 'completed'::character varying])::text[])))
);


--
-- Name: ad_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_clicks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    impression_id uuid NOT NULL,
    clicked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ad_creatives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_creatives (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    campaign_id uuid NOT NULL,
    format character varying(30) NOT NULL,
    asset_url text NOT NULL,
    click_url text,
    duration_seconds integer,
    approved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_creatives_format_check CHECK (((format)::text = ANY ((ARRAY['preroll'::character varying, 'midroll'::character varying, 'display_banner'::character varying, 'sponsored_card'::character varying, 'overlay'::character varying])::text[])))
);


--
-- Name: ad_impressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_impressions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    creative_id uuid NOT NULL,
    stream_id uuid,
    creator_id uuid,
    viewer_id uuid,
    served_at timestamp with time zone DEFAULT now() NOT NULL,
    settled boolean DEFAULT false NOT NULL,
    settled_ledger_transaction_id uuid
);


--
-- Name: ad_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_leads (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_name character varying(140) NOT NULL,
    contact_name character varying(140) NOT NULL,
    contact_email character varying(255) NOT NULL,
    message text,
    status character varying(20) DEFAULT 'new'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_leads_status_check CHECK (((status)::text = ANY ((ARRAY['new'::character varying, 'contacted'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: ad_targeting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_targeting (
    campaign_id uuid NOT NULL,
    category character varying(50),
    language character varying(30),
    min_viewers integer
);


--
-- Name: admin_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_actions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    actor_id uuid NOT NULL,
    action character varying(50) NOT NULL,
    target_type character varying(30) NOT NULL,
    target_id text,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: advertisers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.advertisers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(120) NOT NULL,
    contact_email character varying(255),
    contact_phone character varying(20),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT advertisers_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'paused'::character varying, 'archived'::character varying])::text[])))
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    body character varying(280) NOT NULL,
    action_label character varying(40),
    action_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: appeals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appeals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    reason character varying(1000) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appeals_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'denied'::character varying])::text[])))
);


--
-- Name: avatar_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.avatar_parts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    category character varying(20) NOT NULL,
    name character varying(50) NOT NULL,
    swatch_color character varying(7),
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT avatar_parts_category_check CHECK (((category)::text = ANY ((ARRAY['background'::character varying, 'skin_tone'::character varying, 'hair'::character varying, 'eyes'::character varying, 'accessories'::character varying])::text[])))
);


--
-- Name: blocklist_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocklist_terms (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    term text NOT NULL,
    language character varying(10) NOT NULL,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blocklist_terms_language_check CHECK (((language)::text = ANY ((ARRAY['en'::character varying, 'am'::character varying])::text[])))
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    stream_id uuid NOT NULL,
    user_id uuid NOT NULL,
    body character varying(500) NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: creator_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.creator_applications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    applicant_id uuid NOT NULL,
    application_text text NOT NULL,
    social_links text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewer_id uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creator_applications_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: creator_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.creator_profiles (
    user_id uuid NOT NULL,
    stream_key text NOT NULL,
    revenue_share_bps integer DEFAULT 8000 NOT NULL,
    category character varying(50),
    is_anchor_creator boolean DEFAULT false NOT NULL,
    payout_method character varying(20) DEFAULT 'telebirr'::character varying,
    payout_account text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    language character varying(30),
    ads_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT creator_profiles_payout_method_check CHECK (((payout_method)::text = ANY ((ARRAY['telebirr'::character varying, 'bank'::character varying])::text[]))),
    CONSTRAINT creator_profiles_revenue_share_bps_check CHECK (((revenue_share_bps >= 0) AND (revenue_share_bps <= 10000)))
);


--
-- Name: follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follows (
    follower_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT follows_check CHECK ((follower_id <> creator_id))
);


--
-- Name: gift_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gift_cards (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(20) NOT NULL,
    amount_santim bigint NOT NULL,
    design_theme character varying(40) NOT NULL,
    personal_message character varying(300),
    purchaser_id uuid,
    recipient_phone character varying(20),
    recipient_email character varying(255),
    ledger_transaction_id uuid,
    status character varying(20) DEFAULT 'issued'::character varying NOT NULL,
    redeemed_by uuid,
    redeemed_at timestamp with time zone,
    scheduled_delivery_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gift_cards_amount_santim_check CHECK ((amount_santim > 0)),
    CONSTRAINT gift_cards_status_check CHECK (((status)::text = ANY ((ARRAY['issued'::character varying, 'redeemed'::character varying, 'expired'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: gift_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gift_types (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(50) NOT NULL,
    price_santim bigint NOT NULL,
    animation_key character varying(50) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT gift_types_price_santim_check CHECK ((price_santim > 0))
);


--
-- Name: gifter_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gifter_badges (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    total_gursha_santim bigint DEFAULT 0 NOT NULL,
    tier character varying(20) DEFAULT 'none'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gifter_badges_tier_check CHECK (((tier)::text = ANY ((ARRAY['none'::character varying, 'bronze'::character varying, 'silver'::character varying, 'gold'::character varying, 'platinum'::character varying])::text[])))
);


--
-- Name: gifts_sent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gifts_sent (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ledger_transaction_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    stream_id uuid NOT NULL,
    gift_type_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    message character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    recipient_id uuid,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT gifts_sent_quantity_check CHECK ((quantity > 0))
);


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ledger_transaction_id uuid NOT NULL,
    wallet_id uuid NOT NULL,
    direction character varying(6) NOT NULL,
    amount_santim bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_entries_amount_santim_check CHECK ((amount_santim > 0)),
    CONSTRAINT ledger_entries_direction_check CHECK (((direction)::text = ANY ((ARRAY['debit'::character varying, 'credit'::character varying])::text[])))
);


--
-- Name: ledger_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    type character varying(20) NOT NULL,
    reference text,
    stream_id uuid,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT ledger_transactions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'failed'::character varying, 'reversed'::character varying])::text[]))),
    CONSTRAINT ledger_transactions_type_check CHECK (((type)::text = ANY ((ARRAY['topup'::character varying, 'gift'::character varying, 'payout'::character varying, 'refund'::character varying, 'adjustment'::character varying, 'subscription'::character varying, 'boost'::character varying, 'ad'::character varying, 'gift_card'::character varying])::text[])))
);


--
-- Name: moderation_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_actions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    stream_id uuid,
    actor_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    action character varying(20) NOT NULL,
    reason character varying(300),
    duration_seconds integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_actions_action_check CHECK (((action)::text = ANY ((ARRAY['delete_message'::character varying, 'timeout'::character varying, 'ban'::character varying, 'unban'::character varying])::text[])))
);


--
-- Name: moderation_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_flags (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    content_type character varying(20) NOT NULL,
    content_id uuid NOT NULL,
    author_id uuid NOT NULL,
    text_snapshot text NOT NULL,
    matched_terms text[] NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_flags_content_type_check CHECK (((content_type)::text = ANY ((ARRAY['stream_title'::character varying, 'gift_message'::character varying, 'chat_message'::character varying, 'stream_thumbnail'::character varying])::text[]))),
    CONSTRAINT moderation_flags_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'removed'::character varying])::text[])))
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    live_alerts boolean DEFAULT true NOT NULL,
    gursha_received boolean DEFAULT true NOT NULL,
    subscription_events boolean DEFAULT true NOT NULL,
    payout_events boolean DEFAULT true NOT NULL,
    moderation_events boolean DEFAULT true NOT NULL,
    gift_card_events boolean DEFAULT true NOT NULL,
    marketing boolean DEFAULT false NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    type character varying(40) NOT NULL,
    title character varying(140) NOT NULL,
    body character varying(300),
    link_url text,
    actor_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_codes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    phone_number character varying(20),
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email character varying(255),
    CONSTRAINT otp_codes_one_identifier CHECK ((((phone_number IS NOT NULL) AND (email IS NULL)) OR ((phone_number IS NULL) AND (email IS NOT NULL))))
);


--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ledger_transaction_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    amount_santim bigint NOT NULL,
    method character varying(20) NOT NULL,
    destination text NOT NULL,
    status character varying(20) DEFAULT 'pending_review'::character varying NOT NULL,
    requires_manual_approval boolean DEFAULT false NOT NULL,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    bank_code text,
    chapa_reference text,
    failure_reason text,
    rejected_by uuid,
    CONSTRAINT payouts_amount_santim_check CHECK ((amount_santim > 0)),
    CONSTRAINT payouts_method_check CHECK (((method)::text = ANY ((ARRAY['telebirr'::character varying, 'bank'::character varying])::text[]))),
    CONSTRAINT payouts_status_check CHECK (((status)::text = ANY ((ARRAY['pending_review'::character varying, 'processing'::character varying, 'paid'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: pinned_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pinned_messages (
    stream_id uuid NOT NULL,
    message_id uuid NOT NULL,
    pinned_by uuid NOT NULL,
    pinned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_config (
    id boolean DEFAULT true NOT NULL,
    boost_price_santim bigint DEFAULT 5000 NOT NULL,
    boost_duration_ms bigint DEFAULT 3600000 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    default_revenue_share_bps integer DEFAULT 8000 NOT NULL,
    payout_manual_review_threshold_santim bigint DEFAULT 500000 NOT NULL,
    vod_retention_days_default integer DEFAULT 7 NOT NULL,
    vod_retention_days_anchor integer DEFAULT 30 NOT NULL,
    approved_creator_cap integer DEFAULT 100 NOT NULL,
    ad_revenue_share_bps integer DEFAULT 5500 NOT NULL,
    ad_frequency_cap_per_hour integer DEFAULT 3 NOT NULL,
    gift_card_expiry_months integer DEFAULT 12 NOT NULL,
    CONSTRAINT platform_config_id_check CHECK (id)
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reporter_id uuid NOT NULL,
    target_type character varying(20) NOT NULL,
    target_id uuid NOT NULL,
    reason character varying(30) NOT NULL,
    details character varying(500),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reports_reason_check CHECK (((reason)::text = ANY ((ARRAY['harassment'::character varying, 'hate_speech'::character varying, 'spam'::character varying, 'nudity'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT reports_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'actioned'::character varying, 'dismissed'::character varying])::text[]))),
    CONSTRAINT reports_target_type_check CHECK (((target_type)::text = ANY ((ARRAY['stream'::character varying, 'user'::character varying, 'gift_message'::character varying])::text[])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: social_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(20) NOT NULL,
    provider_user_id text NOT NULL,
    email character varying(255),
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT social_accounts_provider_check CHECK (((provider)::text = ANY ((ARRAY['google'::character varying, 'apple'::character varying])::text[])))
);


--
-- Name: stream_boosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stream_boosts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    ledger_transaction_id uuid NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    price_santim bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    CONSTRAINT stream_boosts_price_santim_check CHECK ((price_santim > 0))
);


--
-- Name: stream_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stream_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    stream_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    category character varying(50),
    peak_viewers integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stream_events_type_check CHECK (((type)::text = ANY ((ARRAY['started'::character varying, 'ended'::character varying])::text[])))
);


--
-- Name: stream_tag_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stream_tag_links (
    stream_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: stream_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stream_tags (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(30) NOT NULL,
    is_banned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stream_vods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stream_vods (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    stream_id uuid NOT NULL,
    playback_url text NOT NULL,
    duration_seconds integer,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: streams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.streams (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    title character varying(140) NOT NULL,
    category character varying(50),
    language character varying(30),
    thumbnail_url text,
    status character varying(20) DEFAULT 'offline'::character varying NOT NULL,
    playback_url text,
    provider_stream_id text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    peak_viewers integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, (((COALESCE(title, ''::character varying))::text || ' '::text) || (COALESCE(category, ''::character varying))::text))) STORED,
    is_sensitive boolean DEFAULT false NOT NULL,
    CONSTRAINT streams_status_check CHECK (((status)::text = ANY ((ARRAY['offline'::character varying, 'live'::character varying, 'ended'::character varying])::text[])))
);


--
-- Name: subscription_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_tiers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(50) NOT NULL,
    price_santim bigint NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT subscription_tiers_price_santim_check CHECK ((price_santim > 0))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ledger_transaction_id uuid NOT NULL,
    subscriber_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    tier_id uuid NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_check CHECK ((subscriber_id <> creator_id)),
    CONSTRAINT subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'cancelled'::character varying, 'expired'::character varying, 'payment_failed'::character varying])::text[])))
);


--
-- Name: user_avatar_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_avatar_selections (
    user_id uuid NOT NULL,
    category character varying(20) NOT NULL,
    part_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_avatar_selections_category_check CHECK (((category)::text = ANY ((ARRAY['background'::character varying, 'skin_tone'::character varying, 'hair'::character varying, 'eyes'::character varying, 'accessories'::character varying])::text[])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    phone_number character varying(20),
    email character varying(255),
    username character varying(30) NOT NULL,
    display_name character varying(50) NOT NULL,
    avatar_url text,
    bio character varying(300),
    password_hash text,
    role character varying(20) DEFAULT 'viewer'::character varying NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    is_banned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, (((((COALESCE(username, ''::character varying))::text || ' '::text) || (COALESCE(display_name, ''::character varying))::text) || ' '::text) || (COALESCE(bio, ''::character varying))::text))) STORED,
    show_sensitive_content boolean DEFAULT false NOT NULL,
    is_suspended boolean DEFAULT false NOT NULL,
    suspended_reason text,
    username_changed_at timestamp with time zone,
    pending_phone_number character varying(20),
    pending_email character varying(255),
    deletion_requested_at timestamp with time zone,
    anonymized_at timestamp with time zone,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['viewer'::character varying, 'creator'::character varying, 'moderator'::character varying, 'admin'::character varying])::text[])))
);


--
-- Name: v_live_streams; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_live_streams AS
 SELECT s.id,
    s.title,
    s.category,
    s.language,
    s.thumbnail_url,
    s.playback_url,
    s.started_at,
    u.id AS creator_id,
    u.username,
    u.display_name,
    u.avatar_url
   FROM (public.streams s
     JOIN public.users u ON ((u.id = s.creator_id)))
  WHERE ((s.status)::text = 'live'::text);


--
-- Name: wallet_balances_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_balances_cache (
    wallet_id uuid NOT NULL,
    balance_santim bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_type character varying(10) NOT NULL,
    owner_id uuid,
    currency character varying(3) DEFAULT 'ETB'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallets_owner_type_check CHECK (((owner_type)::text = ANY ((ARRAY['user'::character varying, 'platform'::character varying])::text[])))
);


--
-- Name: ad_campaigns ad_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_pkey PRIMARY KEY (id);


--
-- Name: ad_clicks ad_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_clicks
    ADD CONSTRAINT ad_clicks_pkey PRIMARY KEY (id);


--
-- Name: ad_creatives ad_creatives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_creatives
    ADD CONSTRAINT ad_creatives_pkey PRIMARY KEY (id);


--
-- Name: ad_impressions ad_impressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_impressions
    ADD CONSTRAINT ad_impressions_pkey PRIMARY KEY (id);


--
-- Name: ad_leads ad_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_leads
    ADD CONSTRAINT ad_leads_pkey PRIMARY KEY (id);


--
-- Name: admin_actions admin_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_pkey PRIMARY KEY (id);


--
-- Name: advertisers advertisers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advertisers
    ADD CONSTRAINT advertisers_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: appeals appeals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_pkey PRIMARY KEY (id);


--
-- Name: avatar_parts avatar_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.avatar_parts
    ADD CONSTRAINT avatar_parts_pkey PRIMARY KEY (id);


--
-- Name: blocklist_terms blocklist_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocklist_terms
    ADD CONSTRAINT blocklist_terms_pkey PRIMARY KEY (id);


--
-- Name: blocklist_terms blocklist_terms_term_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocklist_terms
    ADD CONSTRAINT blocklist_terms_term_language_key UNIQUE (term, language);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: creator_applications creator_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_applications
    ADD CONSTRAINT creator_applications_pkey PRIMARY KEY (id);


--
-- Name: creator_profiles creator_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_profiles
    ADD CONSTRAINT creator_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: creator_profiles creator_profiles_stream_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_profiles
    ADD CONSTRAINT creator_profiles_stream_key_key UNIQUE (stream_key);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (follower_id, creator_id);


--
-- Name: gift_cards gift_cards_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_code_key UNIQUE (code);


--
-- Name: gift_cards gift_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_pkey PRIMARY KEY (id);


--
-- Name: gift_types gift_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_types
    ADD CONSTRAINT gift_types_pkey PRIMARY KEY (id);


--
-- Name: gifter_badges gifter_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifter_badges
    ADD CONSTRAINT gifter_badges_pkey PRIMARY KEY (id);


--
-- Name: gifter_badges gifter_badges_user_id_creator_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifter_badges
    ADD CONSTRAINT gifter_badges_user_id_creator_id_key UNIQUE (user_id, creator_id);


--
-- Name: gifts_sent gifts_sent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: ledger_transactions ledger_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_transactions
    ADD CONSTRAINT ledger_transactions_pkey PRIMARY KEY (id);


--
-- Name: moderation_actions moderation_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_pkey PRIMARY KEY (id);


--
-- Name: moderation_flags moderation_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_flags
    ADD CONSTRAINT moderation_flags_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: otp_codes otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: pinned_messages pinned_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_messages
    ADD CONSTRAINT pinned_messages_pkey PRIMARY KEY (stream_id);


--
-- Name: platform_config platform_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: social_accounts social_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT social_accounts_pkey PRIMARY KEY (id);


--
-- Name: social_accounts social_accounts_provider_provider_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT social_accounts_provider_provider_user_id_key UNIQUE (provider, provider_user_id);


--
-- Name: stream_boosts stream_boosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_boosts
    ADD CONSTRAINT stream_boosts_pkey PRIMARY KEY (id);


--
-- Name: stream_events stream_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_events
    ADD CONSTRAINT stream_events_pkey PRIMARY KEY (id);


--
-- Name: stream_tag_links stream_tag_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_tag_links
    ADD CONSTRAINT stream_tag_links_pkey PRIMARY KEY (stream_id, tag_id);


--
-- Name: stream_tags stream_tags_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_tags
    ADD CONSTRAINT stream_tags_name_key UNIQUE (name);


--
-- Name: stream_tags stream_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_tags
    ADD CONSTRAINT stream_tags_pkey PRIMARY KEY (id);


--
-- Name: stream_vods stream_vods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_vods
    ADD CONSTRAINT stream_vods_pkey PRIMARY KEY (id);


--
-- Name: streams streams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.streams
    ADD CONSTRAINT streams_pkey PRIMARY KEY (id);


--
-- Name: subscription_tiers subscription_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_tiers
    ADD CONSTRAINT subscription_tiers_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: user_avatar_selections user_avatar_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_avatar_selections
    ADD CONSTRAINT user_avatar_selections_pkey PRIMARY KEY (user_id, category);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_number_key UNIQUE (phone_number);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: wallet_balances_cache wallet_balances_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_balances_cache
    ADD CONSTRAINT wallet_balances_cache_pkey PRIMARY KEY (wallet_id);


--
-- Name: wallets wallets_owner_type_owner_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_owner_type_owner_id_currency_key UNIQUE (owner_type, owner_id, currency);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: idx_ad_campaigns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_campaigns_status ON public.ad_campaigns USING btree (status, starts_at, ends_at);


--
-- Name: idx_ad_creatives_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_creatives_campaign ON public.ad_creatives USING btree (campaign_id);


--
-- Name: idx_ad_impressions_frequency_cap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_impressions_frequency_cap ON public.ad_impressions USING btree (creative_id, viewer_id, served_at);


--
-- Name: idx_ad_impressions_unsettled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_impressions_unsettled ON public.ad_impressions USING btree (creator_id, settled) WHERE (settled = false);


--
-- Name: idx_admin_actions_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_actor ON public.admin_actions USING btree (actor_id, created_at DESC);


--
-- Name: idx_admin_actions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_created ON public.admin_actions USING btree (created_at DESC);


--
-- Name: idx_appeals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appeals_status ON public.appeals USING btree (status, created_at);


--
-- Name: idx_avatar_parts_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_avatar_parts_category ON public.avatar_parts USING btree (category, sort_order);


--
-- Name: idx_creator_applications_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_creator_applications_one_pending ON public.creator_applications USING btree (applicant_id) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_creator_applications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_creator_applications_status ON public.creator_applications USING btree (status, created_at);


--
-- Name: idx_gift_cards_purchaser; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gift_cards_purchaser ON public.gift_cards USING btree (purchaser_id);


--
-- Name: idx_gift_cards_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gift_cards_status ON public.gift_cards USING btree (status, created_at);


--
-- Name: idx_gifter_badges_creator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gifter_badges_creator ON public.gifter_badges USING btree (creator_id, total_gursha_santim DESC);


--
-- Name: idx_ledger_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ledger_reference ON public.ledger_transactions USING btree (reference) WHERE (reference IS NOT NULL);


--
-- Name: idx_moderation_flags_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moderation_flags_status ON public.moderation_flags USING btree (status, created_at);


--
-- Name: idx_notifications_user_all; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_all ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: idx_otp_codes_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_codes_email ON public.otp_codes USING btree (email, created_at) WHERE (email IS NOT NULL);


--
-- Name: idx_otp_codes_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_codes_phone ON public.otp_codes USING btree (phone_number, created_at) WHERE (phone_number IS NOT NULL);


--
-- Name: idx_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_status ON public.reports USING btree (status, created_at);


--
-- Name: idx_social_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_accounts_user ON public.social_accounts USING btree (user_id);


--
-- Name: idx_stream_boosts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stream_boosts_active ON public.stream_boosts USING btree (creator_id, ends_at);


--
-- Name: idx_stream_events_stream; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stream_events_stream ON public.stream_events USING btree (stream_id);


--
-- Name: idx_stream_events_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stream_events_type_created ON public.stream_events USING btree (type, created_at);


--
-- Name: idx_stream_tag_links_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stream_tag_links_tag ON public.stream_tag_links USING btree (tag_id);


--
-- Name: idx_stream_tags_name_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stream_tags_name_prefix ON public.stream_tags USING btree (name text_pattern_ops);


--
-- Name: idx_streams_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_streams_search ON public.streams USING gin (search_vector);


--
-- Name: idx_subscriptions_creator_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_creator_active ON public.subscriptions USING btree (creator_id) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_users_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_search ON public.users USING gin (search_vector);


--
-- Name: ad_campaigns ad_campaigns_advertiser_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_advertiser_id_fkey FOREIGN KEY (advertiser_id) REFERENCES public.advertisers(id);


--
-- Name: ad_clicks ad_clicks_impression_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_clicks
    ADD CONSTRAINT ad_clicks_impression_id_fkey FOREIGN KEY (impression_id) REFERENCES public.ad_impressions(id);


--
-- Name: ad_creatives ad_creatives_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_creatives
    ADD CONSTRAINT ad_creatives_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id) ON DELETE CASCADE;


--
-- Name: ad_impressions ad_impressions_creative_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_impressions
    ADD CONSTRAINT ad_impressions_creative_id_fkey FOREIGN KEY (creative_id) REFERENCES public.ad_creatives(id);


--
-- Name: ad_impressions ad_impressions_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_impressions
    ADD CONSTRAINT ad_impressions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: ad_impressions ad_impressions_settled_ledger_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_impressions
    ADD CONSTRAINT ad_impressions_settled_ledger_transaction_id_fkey FOREIGN KEY (settled_ledger_transaction_id) REFERENCES public.ledger_transactions(id);


--
-- Name: ad_impressions ad_impressions_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_impressions
    ADD CONSTRAINT ad_impressions_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(id);


--
-- Name: ad_impressions ad_impressions_viewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_impressions
    ADD CONSTRAINT ad_impressions_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES public.users(id);


--
-- Name: ad_targeting ad_targeting_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_targeting
    ADD CONSTRAINT ad_targeting_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id) ON DELETE CASCADE;


--
-- Name: admin_actions admin_actions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: announcements announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: appeals appeals_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: appeals appeals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: blocklist_terms blocklist_terms_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocklist_terms
    ADD CONSTRAINT blocklist_terms_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);


--
-- Name: chat_messages chat_messages_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: creator_applications creator_applications_applicant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_applications
    ADD CONSTRAINT creator_applications_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.users(id);


--
-- Name: creator_applications creator_applications_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_applications
    ADD CONSTRAINT creator_applications_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id);


--
-- Name: creator_profiles creator_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_profiles
    ADD CONSTRAINT creator_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: follows follows_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: follows follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: gift_cards gift_cards_ledger_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_ledger_transaction_id_fkey FOREIGN KEY (ledger_transaction_id) REFERENCES public.ledger_transactions(id);


--
-- Name: gift_cards gift_cards_purchaser_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_purchaser_id_fkey FOREIGN KEY (purchaser_id) REFERENCES public.users(id);


--
-- Name: gift_cards gift_cards_redeemed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES public.users(id);


--
-- Name: gifter_badges gifter_badges_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifter_badges
    ADD CONSTRAINT gifter_badges_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: gifter_badges gifter_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifter_badges
    ADD CONSTRAINT gifter_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: gifts_sent gifts_sent_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: gifts_sent gifts_sent_gift_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_gift_type_id_fkey FOREIGN KEY (gift_type_id) REFERENCES public.gift_types(id);


--
-- Name: gifts_sent gifts_sent_ledger_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_ledger_transaction_id_fkey FOREIGN KEY (ledger_transaction_id) REFERENCES public.ledger_transactions(id);


--
-- Name: gifts_sent gifts_sent_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id);


--
-- Name: gifts_sent gifts_sent_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: gifts_sent gifts_sent_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(id);


--
-- Name: ledger_entries ledger_entries_ledger_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_ledger_transaction_id_fkey FOREIGN KEY (ledger_transaction_id) REFERENCES public.ledger_transactions(id) ON DELETE CASCADE;


--
-- Name: ledger_entries ledger_entries_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);


--
-- Name: ledger_transactions ledger_transactions_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_transactions
    ADD CONSTRAINT ledger_transactions_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(id);


--
-- Name: moderation_actions moderation_actions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: moderation_actions moderation_actions_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(id) ON DELETE CASCADE;


--
-- Name: moderation_actions moderation_actions_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id);


--
-- Name: moderation_flags moderation_flags_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_flags
    ADD CONSTRAINT moderation_flags_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: moderation_flags moderation_flags_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_flags
    ADD CONSTRAINT moderation_flags_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payouts payouts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: payouts payouts_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: payouts payouts_ledger_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_ledger_transaction_id_fkey FOREIGN KEY (ledger_transaction_id) REFERENCES public.ledger_transactions(id);


--
-- Name: payouts payouts_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id);


--
-- Name: pinned_messages pinned_messages_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_messages
    ADD CONSTRAINT pinned_messages_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: pinned_messages pinned_messages_pinned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_messages
    ADD CONSTRAINT pinned_messages_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES public.users(id);


--
-- Name: pinned_messages pinned_messages_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_messages
    ADD CONSTRAINT pinned_messages_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(id) ON DELETE CASCADE;


--
-- Name: platform_config platform_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);


--
-- Name: reports reports_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: social_accounts social_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT social_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: stream_boosts stream_boosts_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_boosts
    ADD CONSTRAINT stream_boosts_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id);


--
-- Name: stream_boosts stream_boosts_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_boosts
    ADD CONSTRAINT stream_boosts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: stream_boosts stream_boosts_ledger_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_boosts
    ADD CONSTRAINT stream_boosts_ledger_transaction_id_fkey FOREIGN KEY (ledger_transaction_id) REFERENCES public.ledger_transactions(id);


--
-- Name: stream_events stream_events_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_events
    ADD CONSTRAINT stream_events_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(id) ON DELETE CASCADE;


--
-- Name: stream_tag_links stream_tag_links_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_tag_links
    ADD CONSTRAINT stream_tag_links_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(id) ON DELETE CASCADE;


--
-- Name: stream_tag_links stream_tag_links_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_tag_links
    ADD CONSTRAINT stream_tag_links_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.stream_tags(id) ON DELETE CASCADE;


--
-- Name: stream_vods stream_vods_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_vods
    ADD CONSTRAINT stream_vods_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(id) ON DELETE CASCADE;


--
-- Name: streams streams_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.streams
    ADD CONSTRAINT streams_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: subscriptions subscriptions_ledger_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_ledger_transaction_id_fkey FOREIGN KEY (ledger_transaction_id) REFERENCES public.ledger_transactions(id);


--
-- Name: subscriptions subscriptions_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.users(id);


--
-- Name: subscriptions subscriptions_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.subscription_tiers(id);


--
-- Name: user_avatar_selections user_avatar_selections_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_avatar_selections
    ADD CONSTRAINT user_avatar_selections_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.avatar_parts(id);


--
-- Name: user_avatar_selections user_avatar_selections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_avatar_selections
    ADD CONSTRAINT user_avatar_selections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wallet_balances_cache wallet_balances_cache_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_balances_cache
    ADD CONSTRAINT wallet_balances_cache_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


