# Roadmap / known gaps

A single, consolidated list of what's known to be missing or unfinished,
synthesized from the 2026-08-02 reality audit (see the commit history
around that date and `docs/SECURITY.md`/`docs/OPERATIONS.md` for the
evidence behind each line). Organized by how much it blocks a real launch,
not chronologically.

## Blocks launching to real creators/audiences

- **No error tracking or alerting in production** — no Sentry, no metrics
  consumer, no alerting on payment/ledger anomalies. See
  `docs/OPERATIONS.md`. Given real money moves through this platform, this
  is the highest-priority operational gap.
- **Backups are unverified against production** — the real backup
  mechanism only runs in docker-compose; production relies entirely on
  unconfirmed Neon PITR, and no restore has ever been tested anywhere.
- **SMS delivery is a stub** — phone OTP just console.logs the code. Phone
  signup/login doesn't actually work for a real user today.
- **Chapa production readiness unconfirmed** — no evidence a real
  `CHAPA_SECRET_KEY` was ever set or a real transaction ever run. Verify
  directly before assuming payments work end-to-end.
- **No CDN in front of SRS** — every viewer's HLS segments come directly
  from the single SRS machine. This is very likely the first thing to
  break under real concurrent load, and is a cost/bandwidth risk with no
  budget cap or alerting in place either.

## Real but narrower gaps

- **RBAC was never built** — flat `admin` role only, no granular
  permission system. Fine for a small trusted team, not for delegating
  partial access safely.
- **No mechanism kills an active RTMP session on ban** — enforcement is
  publish-time only; needs SRS's own admin API integrated.
- **`CENTRIFUGO_API_KEY`/`CENTRIFUGO_TOKEN_HMAC_SECRET` default to a
  guessable dev value** rather than failing closed if unrotated — whether
  production ever set real values wasn't independently confirmed.
- **VOD recording is coded but not wired up** — `createVodFromRecording`
  works, but SRS has no `dvr{}` block/`on_dvr` hook configured, and no
  real object-storage credentials (`VOD_S3_*`) exist. Streams currently
  leave no replay. **2026-08-04**: fixed the storage layer ahead of this
  going live — `stream_vods.playback_url` now stores the bucket key, not a
  permanent public URL, and playback URLs are signed per-request with a
  6-hour expiry (`common/object-storage.ts`'s `getSignedVodUrl`); the
  bucket no longer needs "Public Access" enabled at all. What's still
  missing to actually go live is unchanged (SRS `dvr{}`/`on_dvr`, real
  `VOD_S3_*` credentials).
- **Bulk payout approval and CSV export don't exist** — payouts are
  approved one at a time; no export anywhere in the admin panel.
- **Mobile apps (Moblin/Vivid) were never started** — not present in this
  repository at all.
- **No account linking** — a phone signup and an email signup for the
  same person produce two separate accounts.
- **Avatar art is flat color swatches**, not illustrated character art.
- **The public About page still claims "Birq doesn't run on
  advertising"** — false since the house ad system shipped; a copy fix,
  not code, needs product sign-off on the replacement wording.

## Money-path test coverage

Before this pass, Vitest coverage existed only for the original
gift/wallet paths (top-up idempotency, gift revenue split, payout
threshold) and the stream reaper. Subscriptions, boosts, ad revenue
settlement, and gift cards — all added later — had zero test files. See
the commit history for what was added in this pass and what's still
outstanding; a full ledger-invariant test (debits == credits after every
operation type, across all money paths) is the single highest-value test
to keep expanding.

## Deferred by deliberate choice, not oversight

- **Egress/CDN cost protection** (bandwidth alerting, budget caps,
  hotlink protection) — a real infrastructure/cost decision, not
  something to implement unilaterally without discussing budget/vendor
  choice first. **2026-08-04**: a full staged implementation plan now
  exists (`docs/egress-protection-plan.md` — Cloudflare Tunnel origin
  lockdown, Worker-validated signed viewer tokens, path-scoped WAF rate
  limits, staging/rollout/monitoring/rollback/cost-alert steps), written
  but **not executed** — still needs a human to provision the Cloudflare
  account/domain and sign off on the plan before anything in it gets
  deployed. VOD's half of this (signed R2 URLs) is already implemented
  independently of that plan — see the VOD line above.
- **Centrifugo secret rotation** — straightforward to do, but touches two
  Fly apps simultaneously and would drop every live real-time connection
  the moment it happens; wants an explicit go-ahead and probably a
  low-traffic window.
- **k6 load testing against production** — scripts exist
  (`infra/k6/load-test.js`) and have been run against the local
  docker-compose stack, but running them against production needs
  explicit sign-off given the risk of self-inflicted load/cost.
- **Webhook replay protection beyond idempotency** — accepted as
  sufficient for the current single integration (Chapa); would need
  revisiting if more webhook-driven integrations are added.
- **Durable execution (Temporal) for money-path workflows** — payout
  disbursement (`wallet/service.ts`'s `requestPayout`) has a real
  crash-mid-flight gap (funds reserved, Chapa transfer call in progress,
  process dies, nothing retries); gift-card scheduled delivery
  (`gift-cards/service.ts`'s `sendScheduledGiftCards`) can double-send if
  the process crashes between delivery and marking it sent. Subscription
  renewal, by contrast, is already idempotent and self-healing on its
  6-hour retry and doesn't need this. Full risk audit, workflow/activity
  decomposition, and staged rollout plan: `docs/temporal-migration-plan.md`
  — **2026-08-04, plan only, no Temporal dependency/cluster added yet**;
  needs a vendor decision (self-hosted vs. Temporal Cloud) before
  execution.

## Known dependency vulnerability, tracked not silently ignored

`npm audit` reports a high-severity `sharp <0.35.0` CVE, pulled in
transitively by `next@16.2.11`'s optional image-optimization route. Actual
exposure is low — the app only ever uses plain `<img>` tags, never
`next/image` — but the dependency is still installed. No fixed Next 16.x
release exists yet; revisit when one ships.
