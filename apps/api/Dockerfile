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
# cleanly" reasoning as this repo's other infra choices.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api ./apps/api
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/server.js"]
