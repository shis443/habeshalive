# Birq

Twitch-style live streaming platform for Ethiopian creators, with birr gifting and payouts to Telebirr/CBE Birr/bank.

## Stack

- `apps/web` — Next.js (App Router), TypeScript
- `apps/api` — Fastify, TypeScript
- `packages/shared` — zod schemas + types shared by web and api
- PostgreSQL, Redis, Centrifugo (chat pub/sub)
- Video: self-hosted [SRS](https://github.com/ossrs/srs) (RTMP ingest, HLS output) — see `infra/srs/`
- Payments: Chapa (Telebirr, CBE Birr, cards)

See `docs/architecture.md` for how the pieces fit together.

## Local dev

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:3000
```

## Money model

All amounts are integer `santim` (birr cents). Every economic event is a
double-entry `ledger_transactions` row with balanced `ledger_entries`. See
`db/schema.sql` for the full schema.
