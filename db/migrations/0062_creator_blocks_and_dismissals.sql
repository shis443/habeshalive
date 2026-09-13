-- Two viewer-side signals the Explore feed's 3-dot menu needs, both
-- shaped exactly like the existing follows table (0001_init.sql):
--
-- creator_blocks: a viewer blocking a creator they never want to see
-- again. Deliberately separate from the pre-existing channel_blocks table
-- (0036_channel_mods_and_multiscript.sql), which is the opposite
-- direction — a creator/moderator blocking a viewer from their own
-- channel. Blocking a creator here also removes any existing follow row
-- (see blocks/service.ts's blockCreator) and hides their live streams
-- from listLiveStreams for the blocker.
--
-- stream_dismissals: a lighter "not interested" signal — only affects
-- what this viewer sees on Explore, doesn't touch the follow relationship,
-- and doesn't block the creator from other surfaces (search, a shared
-- watch link). No personalization/recommendation system reads this today;
-- it's a plain per-viewer exclusion list, same mechanism as creator_blocks.

CREATE TABLE creator_blocks (
    blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, creator_id),
    CHECK (blocker_id <> creator_id)
);

CREATE TABLE stream_dismissals (
    viewer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (viewer_id, creator_id),
    CHECK (viewer_id <> creator_id)
);
