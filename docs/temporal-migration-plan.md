# Temporal migration plan — money-path workflows

**Status: plan only, nothing deployed.** No Temporal dependency, cluster,
or worker process has been added to the codebase as part of writing this.
Scopes a first-step migration for the three workflows named in the BIRQ
guidelines' Part V §3 (subscription renewal, payouts, gift-card delivery),
not a platform-wide adoption.

## What's actually running today

All background/scheduled work is `setInterval` loops registered in
`apps/api/src/server.ts:64-77`, each wrapped in a `.catch()` that only logs
(`runReaper`/`runSubscriptionRenewal`/etc., `server.ts:34-62`) — a
rejection is swallowed and logged, never retried until the next tick, and
never surfaced anywhere a human would see it proactively (no Sentry/alerting
exists yet either — see `docs/ROADMAP.md`'s top blocking-gap item, a
separate, unrelated problem from this one).

## Risk audit of the three named workflows — not all three carry equal risk

Read each implementation directly rather than assuming "cron jobs are
risky" applies uniformly. It doesn't:

### 1. Payout disbursement — highest risk, migrate first

`wallet/service.ts`'s `requestPayout` (`wallet/service.ts:470-573`) is a
real multi-step saga, not a batch job:
1. Reserve funds — debit creator wallet, credit platform wallet, insert a
   `payouts` row, all in one DB transaction (`:492-534`).
2. If below the manual-review threshold, call Chapa's real transfer API
   (`:546-551`).
3. On transfer-initiation failure, reverse the ledger in a *second*,
   separate transaction and mark the payout `failed` (`:556-569`).
4. Final completion arrives later, asynchronously, via a separate webhook
   (`POST /wallet/webhooks/chapa-transfer`) — not returned synchronously
   from step 2.

**The actual gap**: steps 1–3 all run inside a single Fastify request
handler. If the process crashes between step 1 committing and step 2's
Chapa call completing (or between Chapa's call and the `UPDATE ... SET
chapa_reference` at `:553`), the client gets no response, funds sit
reserved, and — critically — **nothing retries this**. It's not on a
timer; it only runs once, inline, per `POST /wallet/payouts`. A creator
would see a stuck-pending payout with no automatic recovery path, and an
operator would have to manually reconcile it. This is precisely the
"traditional try/catch is insufficient" case the BIRQ guidelines describe,
and it's real money, not a formatting nicety.

### 2. Gift-card scheduled delivery — real duplicate-delivery risk, migrate second

`gift-cards/service.ts`'s `sendScheduledGiftCards` (`:148-172`):
```
for (const row of rows) {
  await deliverGiftCard(...)                         // sends email/SMS
  await pool.query(`UPDATE gift_cards SET scheduled_delivery_at = NULL ...`)
}
```
Two concrete bugs this exposes, not hypothetical ones:
- **No idempotency guard between send and mark-sent.** If the process
  crashes after `deliverGiftCard` succeeds but before the `UPDATE`
  clears `scheduled_delivery_at`, the next 15-minute tick's `WHERE status
  = 'issued' AND scheduled_delivery_at <= now()` still matches that row —
  the recipient gets the same gift card email/SMS twice.
- **No per-row error isolation.** Unlike `chargeSubscriptionOrNull` (see
  below), nothing catches a `deliverGiftCard` failure on one row — an
  exception aborts the `for` loop entirely, so one bad delivery blocks
  every other scheduled gift card in that batch until the next tick, and
  even then only if the failure was transient.

### 3. Subscription renewal — already fairly resilient, lower priority

`subscriptions/service.ts`'s `renewSubscriptions` /
`chargeSubscriptionOrNull` (`:22-63`) is a genuine batch job, but it's
already written defensively: each subscriber's charge is its own DB
transaction, insufficient balance returns `null` instead of throwing
(`:50`, comment at `:25-27` is explicit about this being intentional so
"the renewal job needs to keep processing the rest of the batch"), and the
whole job is idempotent + re-run every 6 hours regardless of whether the
process restarted in between. **The realistic failure mode here is
already self-healing** — a crash mid-batch just means the remaining
renewals happen up to 6 hours later, not silently lost. Migrating this to
Temporal buys better observability (a real execution history per
subscriber instead of log lines) but not correctness that's currently
missing. Recommend deferring this one, not skipping it forever.

## Recommended sequencing

1. **Payouts** — real correctness gap, real money, do first.
2. **Gift-card delivery** — real duplicate-send bug, do second.
3. **Subscription renewal** — already self-healing; revisit once 1 and 2
   are live and the operational pattern (worker deployment, monitoring) is
   proven, purely for observability rather than a correctness fix.
4. **Everything else** (`reapStaleStreams`, `cleanupExpiredVods`,
   `settleAdRevenue`) — not part of this scope. None of them move money or
   have an external-API-call-in-the-middle shape; `setInterval` + idempotent
   queries is a reasonable fit for all three as-is.

## Proposed decomposition — payout workflow (the first migration)

```
PayoutWorkflow(payoutId)
  1. Activity: reserveLedgerFunds(payoutId)
     — wraps the existing transactional debit/credit/insert
       (wallet/service.ts:492-534), unchanged logic, just called as an
       activity instead of inline in the request handler.
  2. If requiresManualApproval:
       await Signal "PayoutApproved" | "PayoutRejected"
       — replaces today's stateless POST /wallet/payouts/:id/approve
         (wallet/routes.ts) with a signal sent to this specific running
         workflow instance. This is a real behavior change worth calling
         out explicitly, not glossed over: the admin approval endpoint's
         job becomes "send a signal to workflow ID <payoutId>" instead of
         "update a DB row," and the workflow itself becomes the source of
         truth for payout state while it's in flight.
  3. Activity: resolveBankCode(method, destination)   [telebirr path only]
  4. Activity: initiateChapaTransfer(...)
     — Temporal's built-in retry policy (configurable backoff/max
       attempts) replaces the manual try/catch here; a transient Chapa
       API failure gets retried automatically instead of immediately
       falling through to the reversal path.
  5. await Signal "ChapaTransferCompleted" | "ChapaTransferFailed"
     — the existing chapa-transfer webhook handler
       (wallet/routes.ts) delivers this instead of writing directly to
       the payouts table; same HMAC signature verification as today,
       just routes into the workflow instead of a bare UPDATE.
  6. On failure at any step after 1: Activity: reverseLedgerFunds(payoutId)
     — the existing compensating-transaction logic
       (wallet/service.ts:556-569), now Temporal's explicit saga
       compensation step instead of an inline catch block.
```

Every activity above already exists as real, tested application logic —
this decomposition wraps it, it doesn't rewrite the business logic itself.

## Infra requirements (not yet provisioned)

- A Temporal server: either self-hosted (add to `docker-compose.yml` for
  local dev, a new Fly app or Temporal Cloud for production) or Temporal
  Cloud (managed, no cluster to operate — probably the right call given
  this project's existing "prefer managed services over self-hosting
  another stateful cluster" pattern, e.g. Neon over self-hosted Postgres).
  This is a real vendor/cost decision, same category as the Cloudflare
  choice in `docs/egress-protection-plan.md` — needs sign-off, not a
  unilateral pick.
- New dependencies: `@temporalio/client`, `@temporalio/worker`,
  `@temporalio/workflow` in `apps/api` (or a new dedicated worker
  package under `apps/`, if keeping the Temporal worker process separate
  from the Fastify API process — recommended, since a worker crash
  shouldn't take down request handling and vice versa).
- A new deployable process: the Temporal Worker (polls task queues, runs
  workflow/activity code) needs its own long-running process, separate
  from `apps/api`'s Fastify server — a new Fly `[processes]` entry or a
  new small Fly app.
- New env vars: Temporal server address/namespace, and an API key if using
  Temporal Cloud — same Fly-secret pattern as every other credential in
  this codebase.

## Rollout approach

Given this touches real money movement, the bar here should match this
codebase's existing ledger-integrity rigor (`docs/architecture.md`'s
Ledger integrity section — every balance-mutating path already goes
through shared, tested helpers with a reconciliation check):

1. Build the workflow against a local/staging Temporal instance; write
   Temporal's own time-skipping workflow tests
   (`@temporalio/testing`) for the manual-review wait/signal path so
   the review-threshold branch is verified without a real multi-day wait.
2. **Shadow-run, don't cut over immediately**: for a bounded window, run
   new payout requests through both the existing inline path and the new
   Temporal workflow (with the Temporal path *not* actually calling
   Chapa — dry-run/log-only), diffing the two for behavioral parity before
   the Temporal path is allowed to touch real money.
3. Cut over `POST /wallet/payouts` to start the Temporal workflow instead
   of running `requestPayout` inline; keep the old function in the
   codebase, unused, until the new path has a real production track
   record — not deleted immediately, matching this project's general
   caution about removing things it can't yet prove are safe to remove.
4. Only after payouts are stable, repeat steps 1–3 for gift-card delivery
   (`SendScheduledGiftCardWorkflow`, with `deliverGiftCard` and the
   `scheduled_delivery_at` clear as two separate, idempotent activities —
   Temporal's activity retry semantics naturally close the duplicate-send
   gap described above, since a completed activity is recorded in the
   workflow's event history and won't be re-executed on retry).

## Acceptance criteria

- [ ] A payout that crashes mid-flight (process killed between fund
      reservation and Chapa transfer initiation) resumes automatically
      from the correct step on worker restart — verified by killing the
      worker process mid-workflow in a staging test, not assumed from
      Temporal's docs.
- [ ] A payout's manual-review approval is driven by a signal to the
      specific running workflow, verified end-to-end against a real
      Temporal instance (not mocked).
- [ ] Chapa transfer-status webhook delivery correctly resolves the
      awaiting workflow instance via signal, for both success and failure
      outcomes.
- [ ] A gift card's scheduled delivery activity is provably not
      re-executed on a simulated crash-after-send, closing the duplicate-
      delivery gap identified above.
- [ ] Shadow-run parity confirmed (no ledger divergence) before the real
      cutover in step 3 above.
- [ ] Rollback path exists: the old inline `requestPayout`/
      `sendScheduledGiftCards` code stays in the codebase and can be
      re-wired in `wallet/routes.ts`/`server.ts` without a redeploy delay
      if the Temporal path needs to be pulled back.

## What this plan deliberately does not do yet

No Temporal dependency was added, no cluster/Temporal Cloud account was
provisioned, and no existing route or cron job was modified. Subscription
renewal, the stale-stream reaper, VOD cleanup, and ad-revenue settlement
stay on `setInterval` for now — revisit only after payouts and gift-card
delivery are live on Temporal and the operational pattern is proven.
