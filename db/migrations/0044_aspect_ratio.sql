-- Portrait-default streaming — the platform now has to render both
-- shapes correctly at the same time (landscape stays fully supported per
-- stream), so aspect ratio has to become real, readable data instead of
-- an assumption. '16:9' default is correct for streams/stream_vods: it
-- accurately describes every row that already exists there.
ALTER TABLE streams     ADD COLUMN aspect_ratio VARCHAR(10) NOT NULL DEFAULT '16:9';
ALTER TABLE stream_vods ADD COLUMN aspect_ratio VARCHAR(10) NOT NULL DEFAULT '16:9';

-- clips is different: clip-service.ts's runFfmpegClip has ALWAYS forced a
-- center-crop to 1080x1920 (9:16) regardless of the source VOD's own
-- shape (crop=ih*9/16:ih,scale=1080:1920 — verified this is a real no-op
-- crop when the source is already 9:16, and a real center-crop when it's
-- 16:9, either way landing on a 9:16 output). Every clip that exists
-- today is already 9:16, not 16:9 — '16:9' would be a wrong default here,
-- not just an imprecise one.
ALTER TABLE clips       ADD COLUMN aspect_ratio VARCHAR(10) NOT NULL DEFAULT '9:16';
