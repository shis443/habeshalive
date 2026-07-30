-- Amharic blocklist seed — the 'am' language value has existed on
-- blocklist_terms since 0013, but zero rows ever used it (see that
-- migration's own comment: "AM_BLOCKLIST was already empty ... nothing to
-- seed there"). This is a deliberately SMALL starting set of terms an
-- English speaker can be reasonably confident about (a direct self-harm
-- incitement phrase, matching the severity tier of the English list's
-- "kill yourself"/"kys", plus a few widely-documented general insults/
-- slurs) — NOT a comprehensive Amharic profanity/hate-speech list. This
-- needs real native-speaker review and expansion before launch; the admin
-- Blocklist page (already built) is exactly where that review happens —
-- add/remove terms there, no deploy needed.
INSERT INTO blocklist_terms (term, language) VALUES
    ('ራስህን ግደል', 'am'),
    ('ውሻ', 'am'),
    ('ዝንጀሮ', 'am'),
    ('አህያ', 'am')
ON CONFLICT (term, language) DO NOTHING;
