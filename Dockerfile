# The worker (indexer and keeper) for Railway (docs/RUNBOOK.md, "Worker on Railway"). Railway builds a file named
# `Dockerfile` at the root of the source by itself. The context is the repo root: the worker runs the workspace's
# TypeScript packages as source (tsx), so the image holds the workspace with the worker's dependencies only.
# Nothing secret is built in: DATABASE_URL, SOLANA_RPC_URL, R2_*, KEEPER_* come from Railway's variables at run time.
FROM node:24.21.0-slim

RUN npm install --global pnpm@12.14.0

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@samite/worker..."

ENV NODE_ENV=production
WORKDIR /app/apps/worker
USER node
# Railway sets PORT; GET /health answers on it. The process gets SIGTERM directly (no pnpm wrapper).
CMD ["./node_modules/.bin/tsx", "src/main.ts"]
