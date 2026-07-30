# CSAM escalation — internal runbook

This is an operational document for admins/moderators reviewing the moderation
queue (`/admin/moderation`), not a public-facing policy page. It's referenced
from `apps/api/src/moderation/image-moderation-client.ts`'s file comment and
should stay linked from wherever the moderation queue UI lives.

## What Birq's automated tooling does and does not do

- `scanText()` (English + Amharic blocklist) flags likely-harmful **text** —
  stream titles, chat messages, gift messages — for human review. It has no
  concept of CSAM; it matches literal terms.
- The image moderation pipeline (AWS Rekognition's `DetectModerationLabels`,
  see `image-moderation-client.ts`) flags likely nudity/violence/graphic
  content on stream thumbnails for human review. **It has no concept of
  subject age and is not a CSAM detector.** No general-purpose content
  moderation API is — that requires hash-matching against a database of
  already-confirmed material (Microsoft's PhotoDNA, accessible via an NCMEC
  partnership, or a vendor like Thorn's Safer). Birq does not have that
  integration; setting one up requires a formal application/vendor
  relationship, not a code change.
- **Neither system auto-deletes or auto-bans.** Everything lands in the
  moderation queue for a human to look at.

## If a human reviewer suspects CSAM

This can happen regardless of what triggered the review (an image-moderation
flag, a user report, or just something a moderator notices). Anyone with
access to the moderation queue must follow this exactly:

1. **Do not download, forward, screenshot, or further distribute the
   content** — including to other Birq staff "to confirm." Limit exposure to
   what's already visible in the review queue.
2. **Immediately restrict the account and remove the content's public
   visibility** via the existing admin tools (force-end the stream if live,
   ban the user) — this is normal moderation action, already available, do
   it first.
3. **Preserve the record.** Do not delete the underlying database row or
   object storage file — law enforcement requests will need it. Note the
   `moderation_flags.id`, the content type, and the account involved
   somewhere durable (an internal incident log, not the public admin UI).
4. **Escalate to a designated staff member immediately** — this should not
   sit in the normal queue waiting for routine review. If Birq has not yet
   named who that is, that's a real gap to close before this becomes a live
   risk, not something to work around ad hoc.
5. **Report to NCMEC's CyberTipline** (report.cybertip.org) — the designated
   channel operators worldwide use, including outside the US; NCMEC
   coordinates with international law enforcement (INTERPOL, and Ethiopian
   authorities as applicable). This is normally a company-level legal
   obligation, not an individual moderator's call to skip.
6. **Do not tip off the account holder.** No warning, no "your content was
   removed for policy reasons" message beyond Birq's standard moderation
   copy.

## What this document is not

This is not a substitute for actual legal counsel on CSAM reporting
obligations in Ethiopia and in any jurisdiction Birq's infrastructure or
users touch. Get that review before launch — flagged elsewhere in the
prelaunch report as a genuine non-code blocker, same category as Chapa/NBE
licensing.
