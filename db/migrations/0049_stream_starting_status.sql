-- Both live-start paths (SRS's on_publish webhook -> markLiveByProviderStreamId,
-- and the browser/WHIP dashboard flow -> goLive()) previously flipped a
-- stream straight to 'live' the instant the *connection* began, not once
-- the *media* was actually flowing — SRS/HLS packaging genuinely takes a
-- real, measured (if anecdotal) 5-50s after that before any playable
-- segment exists. Viewers' players (web and Flutter) could see
-- status='live' and a playback_url for a manifest that had nothing to
-- serve yet, with no way to tell "still starting" from "actually broken".
--
-- 'starting' sits between 'offline' and 'live': both live-start paths now
-- write 'starting' first. A new short-interval sweep (streams/service.ts's
-- promoteStartingStreams(), registered in server.ts next to the existing
-- reapStaleStreams() job) promotes a 'starting' row to 'live' only once its
-- manifest is confirmed to have real segment content, or reverts it to
-- 'ended' if that never happens within a bounded timeout.
--
-- Every existing `status = 'live'` read across the codebase (discovery,
-- search, points, boost, squad, admin, metrics, follows, categories) needs
-- no changes: none of them special-case 'offline' vs. any other non-'live'
-- value, so a 'starting' row simply won't match yet — which is exactly the
-- desired behavior (not discoverable/boostable/etc. until actually
-- watchable), matching how Twitch's own directory never lists a stream
-- before its pipeline confirms real output.
ALTER TABLE streams DROP CONSTRAINT streams_status_check;
ALTER TABLE streams ADD CONSTRAINT streams_status_check
  CHECK (status IN ('offline', 'starting', 'live', 'ended'));
