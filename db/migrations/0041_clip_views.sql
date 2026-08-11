-- Phase 3.1 — shareable clips need a real view counter, same as
-- stream_vods.views (0028_vod_publish_workflow.sql) — clips never got
-- one because the only consumer until now was FeaturedClips.tsx
-- rendering inline on a channel page, where a per-clip count wasn't
-- shown anywhere. A public, independently-linkable clip page
-- (apps/web/app/clip/[id]) needs it.
ALTER TABLE clips ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
