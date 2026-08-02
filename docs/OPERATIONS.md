# Operations

How this platform is actually deployed and run today, and — just as
important — what operational tooling does **not** exist in production yet.
Written 2026-08-02 from direct inspection of the live Fly/Vercel/Neon
deployment, not from the docker-compose local-dev setup, which is a
materially richer environment than what's actually running.

## Topology, for real

Three separate Fly.io apps, each a single machine, no HA/clustering:

| App | Fly app name | What it runs |
|---|---|---|
| API | `habeshalive` | Fastify (`apps/api`), Dockerfile at `apps/api/Dockerfile` |
| Video | `habeshalive-srs` | Self-hosted SRS, RTMP:1935 / HLS:8080 / WHIP:1985+8000(UDP), one dedicated static IPv4 for WebRTC ICE |
| Real-time | `habeshalive-centrifugo` | Centrifugo, config baked into its Docker image at build time |

Plus: `apps/web` on Vercel, Neon for managed Postgres, a separate Redis
instance for rate-limit state.

**Important divergence from `docker-compose.yml`**: local dev runs a much
richer topology — multiple SRS nodes behind HAProxy, Grafana, Prometheus,
a scheduled `pg_dump` backup service, ZAP, k6 — none of which exist as Fly
apps in production. `infra/grafana/`, `infra/prometheus/`, `infra/haproxy/`,
and `infra/backup/` are all docker-compose-only today; there is no
`fly.toml` for any of them. If you're debugging production, don't assume
any of that tooling is watching it — it isn't.

## Deploying

```bash
# API (from repo root)
flyctl deploy -a habeshalive --config fly.toml

# SRS (only needed if infra/srs/conf or its Dockerfile changed —
# most API changes don't touch this)
flyctl deploy -a habeshalive-srs --config infra/srs/fly.toml

# Centrifugo (only needed if infra/centrifugo/config.json changed —
# it's baked into the image, not read from an env/volume at runtime)
flyctl deploy -a habeshalive-centrifugo --config infra/centrifugo/fly.toml

# Web
# Deploys via Vercel's own git integration / vercel CLI — not flyctl.
```

Rolling, single-machine deploys — a deploy briefly recycles the one
running machine. `flyctl deploy` sometimes prints a `WARNING: The app is
not listening on the expected address` line during the health-check
window; this has been benign every time observed (the machine reaches
"started"/healthy immediately after) — confirm with a real request before
treating it as a failed deploy, don't just trust the warning text.

## Database migrations

`node db/migrate.mjs` against `DATABASE_URL` — no separate migration
runner service; run manually against production when a migration ships
(there is no CI/CD auto-migrate step). Check `db/migrations/` for the
current head; migrations are plain numbered `.sql` files, forward-only,
no down-migrations.

## Verifying a deploy actually worked

There's no smoke-test step wired into deploy. What's been used
consistently throughout this project's hardening work:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://habeshalive.fly.dev/streams/live
```

For anything deeper (does a specific fix actually behave correctly),
`flyctl ssh console -a habeshalive` gives a real shell in the running
container, with `DATABASE_URL` and every other production secret already
in its environment — `pg` is available at `/repo/node_modules/pg` (run
scripts from `/repo/apps/api`, not `/tmp`, for module resolution to find
it). Use this to run one-off verification scripts against production
directly — always clean up any test data created this way (`DELETE`
the rows before considering the check done).

## Secrets

Set via `flyctl secrets set -a <app> KEY=value`. No secret manager beyond
Fly's own encrypted secret store. See `apps/api/src/common/env.ts` for the
full list and which ones fail closed (stub mode) vs fail open
(`CENTRIFUGO_API_KEY`/`CENTRIFUGO_TOKEN_HMAC_SECRET` — see SECURITY.md)
when unset.

**Whether `CHAPA_SECRET_KEY` has ever actually been set to a real
production key, or whether a real Chapa transaction has ever been run
end-to-end, was not confirmed as part of this audit** — the integration
code is real and contract-verified against Chapa's docs, but no evidence
of a real test transaction exists anywhere in this repo's history. Verify
this directly before depending on it (`flyctl ssh console -a habeshalive
-C "printenv CHAPA_SECRET_KEY"` — a real key or an empty string tells you
immediately which mode production is actually running in).

## Monitoring — does not exist in production today

This is the single biggest operational gap. As of this audit:

- **No error tracking.** No Sentry (or any APM/error-tracking service) is
  integrated anywhere in `apps/api` or `apps/web` — confirmed by a repo-wide
  search for `sentry`/`@sentry` (zero hits). A production exception is
  visible only via `flyctl logs -a habeshalive`, which is not alerting,
  just a stream you have to be actively watching.
- **No metrics/dashboards in production.** `apps/api` does expose
  `/metrics` (Prometheus format, `prom-client`), but nothing in
  production scrapes it — Prometheus and Grafana are docker-compose-only
  (see Topology above). The metrics endpoint is live and correct; there's
  just no consumer of it in the deployed environment.
- **No alerting of any kind** — not on error rate, not on payment/ledger
  anomalies, not on infrastructure health (machine restarts, disk, DB
  connections).
- **No documented runbooks** existed before this document.

**What this means concretely**: if a payment webhook starts failing, a
ledger goes out of balance, or the API starts 500ing, nobody gets paged —
the first signal is a user complaint or someone manually checking logs or
running the ledger reconciliation endpoint. Given ads/gifts/subscriptions/
payouts are all real money paths, this is a genuine pre-launch gap, not a
nice-to-have. See ROADMAP.md.

## Backups — unverified

`infra/backup` (`pg_dump | gzip` → Cloudflare R2, nightly) is real and
works — but **only in docker-compose**. It is not deployed anywhere
against the production Neon database. Production's actual data-loss
protection today is entirely whatever Neon's own point-in-time-recovery
does on its plan tier — **this was not independently confirmed as part of
this audit** (no access to the Neon dashboard/plan details was available).
**No restore has ever been tested**, in docker-compose or otherwise.
Before depending on this for anything real: (1) confirm what Neon's PITR
window actually is on the current plan, (2) actually perform a restore
into a scratch database and verify the data, don't just trust that a
`pg_dump` file exists.

## Minimal incident runbook (what exists so far)

Given no alerting exists, these are manual checks, not automated:

- **"Is the API up?"** — `curl -s -o /dev/null -w "%{http_code}\n"
  https://habeshalive.fly.dev/streams/live` should be `200`. `flyctl status
  -a habeshalive` shows machine state.
- **"Is the ledger balanced?"** — `GET /admin/ledger/reconciliation`
  (admin-authenticated) returns `{totalCreditsSantim, totalDebitsSantim,
  balanced}`. Surfaced in the admin panel's Ledger & Finance page too.
- **"Is a specific webhook working?"** — `flyctl logs -a habeshalive |
  grep webhook` for recent Chapa/SRS callback activity; a 401 spike means
  a secret mismatch, a 500 spike means an application bug.
- **"Something's wrong with real-time (chat/notifications)"** — check
  `habeshalive-centrifugo`'s own health: `curl -s -o /dev/null -w
  "%{http_code}\n" https://habeshalive-centrifugo.fly.dev/` should be
  `200`. Its config is baked into the image — a config change needs a
  redeploy of that specific app, not just the API.

Everything beyond this — real dashboards, alert rules, a tested restore,
a fuller runbook set — is future work, not something to assume already
covered. See ROADMAP.md for what's prioritized.
