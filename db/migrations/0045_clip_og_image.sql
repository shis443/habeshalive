-- Phase 3.3 — a real, generated Open Graph image for the clip-sharing
-- growth loop, not the creator-avatar placeholder generateMetadata fell
-- back to before (clips have no thumbnail_url column at all — nothing
-- existed to build a real preview from until this). Nullable: generation
-- can fail (ffmpeg error, no frame at the probed offset) without losing
-- the clip itself — see clip-service.ts's runFfmpegOgImage for the
-- fail-open handling, same posture as stream_vods.aspect_ratio's ffprobe.
ALTER TABLE clips ADD COLUMN og_image_key VARCHAR(500);
