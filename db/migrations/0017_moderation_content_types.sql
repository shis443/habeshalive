-- Widen moderation_flags.content_type to cover the two surfaces that were
-- never scanned at all until now: chat messages (the highest-volume text
-- surface on the platform) and stream thumbnails (a real user image
-- upload, moderated via AWS Rekognition — see moderation/
-- image-moderation-client.ts).
ALTER TABLE moderation_flags DROP CONSTRAINT moderation_flags_content_type_check;
ALTER TABLE moderation_flags ADD CONSTRAINT moderation_flags_content_type_check
    CHECK (content_type IN ('stream_title', 'gift_message', 'chat_message', 'stream_thumbnail'));
