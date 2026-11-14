# M3: App on the local validator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person posts a job in the browser, a scripted machine claims and delivers, the person accepts, and every number on every screen matches the chain — all against `solana-test-validator` with local USDC.

**Architecture:** The chain is the source of truth. `apps/worker` indexes the program's CPI events into Postgres (`packages/db`, Drizzle) and runs the keeper. `apps/web` serves the HTTP API (§6.1) from route handlers and the app pages from the index, re-checking state and hashes against the RPC in the browser. Storage, rate limits and moderation sit behind small interfaces with a local implementation (filesystem, memory, an explicit "local pass") and a production one (R2, Upstash, Anthropic), chosen from env. Wallets connect through Wallet Standard (`@solana/react` + `@solana/kit-plugin-wallet`); e2e uses an injected test wallet.

**Tech Stack:** as M1, plus `@solana/kit` 8.6, `@samite/program-client` (Codama), `@samite/formats`, Drizzle 0.45 + PGlite 0.5 (local) / postgres-js (prod), `@noble/curves` (ed25519 verify), `@upstash/redis`, `@aws-sdk/client-s3`, `@anthropic-ai/sdk`.

**Spec:** `CLAUDE.md` §3, §5, §6.1, §7, §8, §9, §11.12, §12, §13 (indexer, web), §14 M3. Program: `docs/PROGRAM-REVIEW.md`.

## Global Constraints

- Local only: `solana-test-validator`, LiteSVM; never a public cluster. Amounts are `bigint` base units end to end; display only via `formatUsdc`.
- The server never signs a user's transaction: `/tx/*` returns unsigned base64 + a summary; `/tx/send` relays.
- Signed requests: `Samite-Ed25519 address, ts, sig` over `samite:v1\n<METHOD>\n<path?query>\n<ts>\n<hex sha256(body)>`; |now − ts| ≤ 60 s; replay window 2 min.
- Specs are moderated before they reach the board, API listing or MCP; refused specs never appear. Untrusted text renders as Markdown with HTML off, links `nofollow noopener ugc`.
- Deliveries are private (poster + machine only), served with `Content-Disposition: attachment`.
- `KEEPER_ENABLED=false` by default; the local harness turns it on only for its own validator.
- The API and the app pages stay behind the production gate until M6.

## Review Focus

1. Indexer replay and restart: the index must end identical (idempotent on signature, backfill on start).
2. Browser honesty: the job page must show the chain's status and hashes even if the API lies (§12).
3. Money shown before every signature equals the instruction's amounts (summary built from the same values as the tx).
4. Concurrency: two machines claim at once; one tx fails on-chain and the UI shows the winner, not a stale state.
5. Clock edges: review window and deadline exactly at boundaries (keeper and UI countdowns agree with the program's `>`/`<=`).

---

### Task 1: Local chain harness (`scripts/local/`)
USDC mint account built locally at the real address (82-byte SPL mint, test authority), `solana-test-validator` with the program loaded upgradeable (local upgrade authority), bootstrap: `initialize_config` (fee 250, min 1 USDC, local treasury ATA), funded poster + machine wallets. `pnpm local:up` / `pnpm local:down`. Test: a script reads back Config and balances.

### Task 2: `packages/db`
Drizzle schema exactly §8; migrations; `createDb(url)` → PGlite for `pglite://` or a path, postgres-js for `postgres://`. Tests on PGlite: insert/select every table, unique constraints (display_no, events.sig).

### Task 3: Event decoding + indexer (`apps/worker/src/indexer`)
Decode `emit_cpi` events from inner instructions (event IX tag + discriminator + borsh via Kit codecs from the IDL). Poll `getSignaturesForAddress` (backfill from the last indexed slot), `getTransaction`, apply events in slot order, idempotent on signature; display numbers in `JobPosted` slot order; `machines`/`posters` counters. Tests: decode fixtures from LiteSVM; replay a recorded session twice and after a kill → identical tables.

### Task 4: Keeper (`apps/worker/src/keeper`)
Every minute: past review window → `release_after_review`, past deadline (Open/Claimed) → `refund_after_deadline`, stale claim → `expire_claim`, from the keeper key; off unless `KEEPER_ENABLED=true`. Test on the local validator with a warped clock.

### Task 5: Shared server pieces (`apps/web/lib/server/`)
Signed-request verification (+ replay store), SIWS session, storage (fs | R2), rate limits (memory | Upstash), moderation (Anthropic | local pass), JSON errors with stable codes. Unit tests for signing (vectors), replay, clock skew, error shapes.

### Task 6: API (`apps/web/app/api/v1/`)
Every route in §6.1. `/tx/:action` builds unsigned transactions with the Codama client and returns base64 + summary (amounts, accounts, fees, rent read live). Integration tests against the local validator + PGlite.

### Task 7: Wallet + app pages on real data
Wallet Standard connect (modal styled with tokens), board/job/machine/me from the API, post flow (`POST /specs` → `/tx/post` → wallet signs → send → redirect), accept/reject, browser re-check of status and hashes against the RPC, live feed via SSE. Example labels stay only where data isn't live.

### Task 8: The M3 acceptance run
Playwright + local validator + worker: person posts in the browser (injected test wallet), a scripted machine claims and delivers a file, the person accepts; every number on the job, board, machine and my-jobs screens equals the chain (balances, fee 2.5%, rent returned). Progress note.
