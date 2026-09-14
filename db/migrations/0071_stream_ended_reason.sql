-- Real bug: a creator taps "End Stream", the row is marked ended with no
-- record of *why* — so markLiveByProviderStreamId's reconnect-grace-window
-- revival (meant to make a brief network blip invisible to viewers) can't
-- tell "the creator just deliberately ended this" from "SRS detected a
-- real disconnect a few seconds ago." Any late/retried RTMP publish
-- handshake landing within that 2-minute window revived the SAME row the
-- creator just ended, and the promotion sweep then flipped it back to
-- live — "ended, then goes live again on its own."
--
-- NULL (the default, and every pre-existing ended row) means "ended via a
-- real on_unpublish from the media server" — the one case the grace
-- window's revival is actually meant to cover. Every deliberate/automatic
-- end path below now stamps a non-NULL reason, and the revival query
-- (streams/service.ts) only matches ended_reason IS NULL.
ALTER TABLE streams ADD COLUMN ended_reason VARCHAR(20)
    CHECK (ended_reason IN ('creator_ended', 'force_ended', 'timeout'));
