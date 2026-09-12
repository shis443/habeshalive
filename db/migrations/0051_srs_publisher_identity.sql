-- Captures the identity SRS itself hands over at publish time, so an
-- emergency kill can target the exact session directly instead of
-- searching the whole cluster for it by name.
--
-- SRS's on_publish HTTP hook (srs_app_http_hooks.cpp's on_publish) already
-- POSTs both of these on every publish — client_id (unique per connection)
-- and server_id (which node accepted it, the same identifier the admin API
-- returns as `server` on every response — both read stat_->server_id(),
-- confirmed against infra/srs/vendor/trunk/src/app/srs_app_http_api.cpp).
-- The webhook handler discarded both; this is additive, not a schema
-- change to anything already relied upon.
--
-- WHY THIS MATTERS BEYOND CONVENIENCE: killPublisherConfirmed previously
-- had to search SRS's client listing for an entry whose `name` matched the
-- stream, which is a race if the creator's encoder drops and reconnects
-- mid-kill — SRS assigns a fresh client_id per connection, so a listing
-- taken before the reconnect and one taken after are each blind to the
-- other's session. A client_id captured once, at the specific publish this
-- kill is meant to end, cannot be confused with a later reconnection: it
-- either exists (this exact session, killable) or it doesn't (already gone
-- by the time we got here, nothing to do).
ALTER TABLE streams
    ADD COLUMN srs_client_id VARCHAR(64),
    ADD COLUMN srs_server_id VARCHAR(64);
