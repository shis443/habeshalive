FROM node:22-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

FROM deps AS build
COPY . .
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/api

FROM node:22-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production
# Module 4's 9:16 clipper (vods/clip-service.ts) shells out to the real
# ffmpeg binary via execFile — no npm wrapper package, same "don't add a
# dependency for something the OS package manager already provides
# cleanly" reasoning as this repo's other infra choices. fonts-dejavu-core
# is the watermark download job's (download-service.ts) drawtext font —
# ffmpeg's drawtext filter needs a real fontfile path and node:22-slim
# ships with none by default; this package's DejaVuSans-Bold.ttf lands at
# a fixed, well-known path this repo can reference directly.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api ./apps/api
# Migrations aren't run automatically on deploy (no fly.toml
# release_command) — this lets an operator `fly ssh console` in and run
# `node db/migrate.mjs` directly against this machine's own DATABASE_URL,
# without ever needing to extract that secret's raw value locally.
COPY --from=build /repo/db ./db
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/server.js"]
