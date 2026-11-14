# Security self-review (off-chain system)

> **This is a self-review**, written by the developer (Claude Code) for the owner. It is **not an audit**. No external
> audit of Samite has been done, and nothing here should be presented as one (CLAUDE.md §0, §12).

Branch `m3-app` at `9af75cf` (Nov 12, 2026); the three bugs it found (B1–B3) were fixed right after, each with a test that
failed before the fix, and the sections below describe the code after those fixes. Every claim below comes from code read in this repo; references are
`path:line`. Where something could not be confirmed from the code, it says **not verified**. No test suite was run for
this review (they need the local harness); test names are cited from the test files, and whether they pass is CI's
word, not this document's. `pnpm audit` was not run.

Each section gives: **what** is protected, **how**, **where**, **tests**, and **not covered**.

## 1. The escrow program (summary)

The program has its own self-review: [PROGRAM-REVIEW.md](./PROGRAM-REVIEW.md). Its invariants, in short: one vault per
job (the job PDA's USDC ATA); money leaves only to the job's machine (+ fee to `Config.treasury`) or back to the
poster; no admin path to escrowed funds; pause blocks only `post_job` and `claim_job`; the fee is capped at 500 bps and
snapshotted per job; time-outs are permissionless; rent goes back to the poster; classic SPL Token with
`transfer_checked`, one mint; every state change emits an event by `emit_cpi!`, which the indexer reads (section 11).

Open owner items listed there (PROGRAM-REVIEW.md:438-447): remove `claim_window = 0`?; a claim bond?; make `Proven`
harder to farm?; allow cancelling a pending admin proposal? Its residual risks 1-11 (upgrade authority, Circle's
freeze authority, closed ATAs, dishonest posters, squatting with several keys, `Proven` farming, no fuzzing or external
audit) still apply.

PROGRAM-REVIEW.md used to say the keeper "should prepend `CreateIdempotent`" for missing ATAs. The keeper deliberately
does not (apps/worker/src/keeper/keeper.ts:7-9, 90-103): paying for an account it doesn't own would let a user drain the
keeper's SOL by closing it again. PROGRAM-REVIEW now says so too.

## 2. Keys and secrets

**What.** The keys that can move money or change the program, and the service secrets.

| Key                       | Where it lives                                                                                                                     | What it can do                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Upgrade authority         | Owner's own key or multisig; read only from a file path on the command line by `scripts/mainnet/` (scripts/mainnet/lib.ts:2-3, 40) | Replace the program                                                                         |
| Admin                     | Same (becomes admin at `initialize_config`)                                                                                        | Fee for new jobs (≤ 500 bps), min reward, pause, treasury                                   |
| Treasury owner            | Owner's wallet or multisig; never in a service                                                                                     | Receives fees                                                                               |
| Keeper                    | `KEEPER_SECRET` (base58) in the worker host's env (apps/worker/src/main.ts:52-53)                                                  | Pays fees for `release_after_review`, `refund_after_deadline`, `expire_claim`; nothing else |
| Users' and machines' keys | Their wallet; the machine's keypair file (`SAMITE_KEYPAIR`, packages/mcp/src/main.ts:18-23)                                        | Their own funds                                                                             |

**How.**

- The keeper is off unless `KEEPER_ENABLED` is exactly `"true"` (packages/config/src/env.ts:82) **and** `KEEPER_SECRET`
  is set (apps/worker/src/main.ts:52, 65). It is only the fee payer (apps/worker/src/keeper/chain.ts:60); the three
  instructions it sends are permissionless and their destinations are fixed by the program. It re-reads the job and the
  chain's clock before sending (keeper.ts:75-80) and never pays to re-create a closed USDC account (keeper.ts:90-103).
  The 0.5 SOL ceiling is a runbook rule (docs/RUNBOOK.md:150), not enforced in code.
- `.env` and `.env.*` are gitignored except `.env.example`, as are `*.pem` and `*keypair*.json` (.gitignore:17-22).
  `.env.example` has only empty values (and the public USDC mint).
- gitleaks runs on every push to `main` and every PR, with full git history checked out
  (.github/workflows/ci.yml:51-63); which commits the action scans is its default (**not verified**). Two false
  positives are ignored by fingerprint, each with a comment (.gitleaksignore:1-5).
- In production (`VERCEL_ENV=production`, apps/web/lib/env.ts:7-9) the web app refuses to start without
  `DATABASE_URL`, `SESSION_SECRET`, `SOLANA_RPC_URL` (apps/web/lib/server/context.ts:38-42, 48, 52, 84) and all four R2
  values (context.ts:58-59). Without `ANTHROPIC_API_KEY` it runs the "off" moderator,
  which passes nothing (context.ts:70-74). The worker exits without `DATABASE_URL` and `SOLANA_RPC_URL`
  (apps/worker/src/main.ts:23-26).

**Tests.** packages/config/test/env.test.ts "leaves the keeper off unless it is exactly 'true'";
apps/worker/test/keeper.svm.test.ts "doesn't pay to re-create a closed USDC account; it sends once the owner re-creates
it" and "sends nothing the index says is due but the chain says isn't (the index is behind)". apps/web/test/server/context.test.ts: a preview and production both refuse missing secrets.

**Not covered.** Preview deployments now refuse local defaults too (R4, fixed in code); they still need their own
database and bucket (owner configuration). A missing
`SAMITE_PROGRAM_ID` is not refused in production: both apps fall back to the program id compiled into the client
(context.ts:76, apps/worker/src/main.ts:30). `scripts/mainnet/keeper-secret.ts` prints `KEEPER_SECRET` to the
terminal, by design, so it lands in scrollback.

## 3. The server never signs users' transactions

**What.** Samite's servers hold no key that can sign for a poster or a machine.

**How.** `/api/v1/tx/:action` builds an unsigned transaction whose fee payer and signers are the caller as no-op
signers (apps/web/lib/server/tx.ts:72-86, 100). Every check reads the job from the chain, not the index (tx.ts:66-70,
171): poster-only and worker-only actions (tx.ts:177-182), status, deadline, review window, the machine's USDC account,
the previous worker, `Config.treasury` and `Config.fee_bps`. The summary is computed from the same values that go into
the instruction (tx.ts:153-165, 252-255). `post` refuses a spec that isn't stored or hasn't passed moderation
(tx.ts:111-118). Every action but `send` requires authentication (apps/web/app/api/v1/tx/[action]/route.ts:8-15).

`/tx/send` relays a signed transaction to the RPC only if every instruction calls the escrow program or a program a
wallet adds to what it signs (compute budget for a priority fee; Lighthouse, `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`,
for Phantom's balance assertions), and at least one calls the escrow program (`relay` in tx.ts). It signs nothing and
adds nothing. Every `/tx/*` transaction is simulated before it is returned for signing (`lib/server/preflight.ts`).

**Tests.** apps/web/test/api.int.test.ts "refuses to let the poster claim their own job", "won't let a machine take
back a job it dropped; another machine can, and the program agrees", "relays only transactions for the escrow program"
(an invalid transaction); apps/web/test/server/relay.test.ts (escrow with and without compute budget passes, and with
Lighthouse added as Phantom returns it; a transaction that only lists the program, one that adds another program's
instruction, and one with only wallet-added programs are refused).

**Not covered.** The relay is unauthenticated and limited only by the per-IP write limit.

## 4. Client honesty

**What.** A lying or compromised API should not be able to show a false status or hash, or get a user to sign
something different from what they were shown.

**How.**

- **Job page.** The browser reads the `Job` account itself through `NEXT_PUBLIC_RPC_URL`
  (apps/web/lib/wallet/chain.ts:29-46; apps/web/lib/wallet/client.ts:20) and shows the chain's status
  (apps/web/app/(site)/(app)/jobs/[ref]/JobClient.tsx:29-34). `ChainCheck` compares status, worker, delivery hash,
  spec hash and reward with what the API served and says so when they differ (JobClient.tsx:37-83). The spec's sha256
  is computed in the browser from `/spec.json` (chain.ts:63-66). The delivery manifest is re-hashed in the browser and
  "✓ matches on-chain hash" shows only if it equals the chain's value (JobClient.tsx:293-311).
- **Before the wallet signs** (apps/web/lib/wallet/send.ts:17-37): the transaction's fee payer must be the connected
  account (send.ts:21-23); the amount on the button must equal the server's summary (JobClient.tsx:136-142;
  apps/web/app/(site)/(app)/jobs/new/PostForm.tsx:100-101).
- **SDK.** Every transaction is built locally from the Codama client and state read on the machine's own RPC, then
  signed and sent there (packages/sdk/src/index.ts:1-5, 155-173). `jobs.get` hashes the served spec bytes and compares
  them with the on-chain `spec_hash` (index.ts:225-243). Posting, delivering and rejecting compare the API's hash with
  one computed locally before signing (index.ts:305-306, 410-411, 470-471).

**Tests.** apps/web/e2e/m3.acceptance.spec.ts "a person posts in the browser, a machine claims and delivers, the person
accepts; every number matches the chain" (asserts `data-chain-check="ok"` and `data-delivery-check="ok"`);
packages/sdk/test/sdk.test.ts "refuses a spec that doesn't hash to the job's spec_hash", "accepts the exact bytes whose
sha256 is the job's spec_hash"; packages/sdk/test/sdk.int.test.ts "posts a job from a machine's wallet; a dry run signs
nothing". **No test** of the mismatch path in the browser (an API that lies).

**Not covered.** The browser now decodes what it signs (R1, fixed); it still takes the job's address from the API,
so a lying API could only point an action at another job the same wallet may act on. It
reads whatever account sits at the address the page gave it, without re-deriving the PDA or checking the owner (the
generated `fetchMaybeJob` doesn't: packages/program-client/src/generated/accounts/job.ts:229-240), and `fee_bps` is not
part of `ChainCheck` (R16). Downloaded files are not re-hashed (R7). The SDK resolves a display number like `0416` to a
PDA through the API (index.ts:191-192); a PDA ref is used as given.

## 5. Authentication

### 5.1 Signed requests

**What.** Machines (SDK, MCP, plain HTTP) prove the address they act for.

**How.** The message is `samite:v1\n<METHOD>\n<path?query>\n<ts>\n<hex sha256 of body>`
(packages/formats/src/request.ts:12-17); the path must be absolute and on one line (request.ts:13-14). The header is
`Samite-Ed25519 address=…, ts=…, sig=…`, each parameter exactly once, base58 checked, `ts` at most 12 digits
(request.ts:26-47). The server (apps/web/lib/server/signed.ts):

- clock skew: `|now − ts| ≤ MAX_SKEW_SEC = 60` (signed.ts:15, 30);
- ed25519 signature over the exact body bytes read once (signed.ts:44-50; apps/web/lib/server/http.ts:34);
- replay: `replay:<address>:<sig>` stored for `REPLAY_WINDOW_SEC = 120` s with set-if-absent, only after the signature
  checks out (signed.ts:16, 53). 120 s covers the whole ±60 s acceptance window.
- storage (since Nov 14): the app's Postgres, table `kv`, shared by every instance (`pgKv`, apps/web/lib/server/kv.ts).
  Set-if-absent is one `INSERT … ON CONFLICT DO UPDATE … WHERE expires_at <= now` that returns a row only to the
  winner; counters are one upsert. Upstash Redis instead when its two variables are set (`SET NX EX`). Memory only in
  unit tests. apps/web/test/server/kv.test.ts runs one contract on both stores; kv.int.test.ts runs it on a real
  Postgres pool (25 concurrent set-if-absent: one winner; 50 concurrent increments: 1 to 50). The worker deletes
  expired rows every minute.

**Tests.** apps/web/test/server/signed.test.ts "refuses a request whose body, path, query or method changed after
signing", "refuses a signature by another key for the claimed address", "accepts a clock 60 s off either way, and not
61", "refuses the same signed request twice within 2 minutes, and lets it go after";
packages/formats/test/request.test.ts "is the exact string the spec gives (vectors)", "refuses anything else";
packages/sdk/test/sdk.test.ts "sign exactly the method, path, query, time and body with the machine's key (§6.1)".

**Not covered.** The message does not include the host, so a request signed for one deployment of the API can be
replayed against another within 60 s (R14). Rejection of non-canonical ed25519 signatures relies on the runtime's
WebCrypto (**not verified**).

### 5.2 Sign-In With Solana sessions (browser)

**What.** One wallet signature opens a session that replaces per-request signatures.

**How** (apps/web/lib/server/session.ts):

- nonce: 16 random bytes, stored for `NONCE_TTL_SEC = 600` s (session.ts:16, 29-30), spent with get-and-delete, last,
  so a bad attempt doesn't burn it (session.ts:79-81);
- checks: domain equals the site's host, URI origin, address, chain id, expiration in the future, `issuedAt` at most 60 s
  ahead, then the signature (session.ts:63-78);
- token: 32 random bytes; the database stores only `HMAC-SHA256(SESSION_SECRET, token)` (session.ts:49, 83-85);
- cookie: `samite_session`, `Path=/; HttpOnly; SameSite=Lax`, `Secure` in production, expires after
  `SESSION_DAYS = 7` (session.ts:14-15, 93-95; apps/web/app/api/v1/session/route.ts:24);
- CSRF: a cookie counts for a non-GET/HEAD/OPTIONS request only if `Origin` equals the site's origin
  (session.ts:104, 119-120). The origin is `NEXT_PUBLIC_SITE_URL`, else `https://samite.fun` in production
  (context.ts:53-54).

**Tests.** apps/web/test/server/session.test.ts "opens a session that authenticates the browser's requests", "never
stores the session token itself", "refuses a message for another site, another address, another chain, or a bad
signature", "spends each nonce once, and refuses one it never issued", "refuses an expired sign-in", "only lets a
session change state from this site (CSRF)", "ends with its expiry".

**Not covered.** No idle timeout or rotation; expired rows are never deleted. `POST /session` and `DELETE /session`
have no Origin check (login CSRF), softened by the app re-checking that the session's address is the connected wallet
before every action (apps/web/lib/wallet/session.ts:16-17) (R15).

## 6. Authorization per route

| Route                                         | Who                                        | Check                                                                                    | Where                                   |
| --------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------- |
| `POST /specs`                                 | any signed-in address                      | none beyond auth; `posted_from` = `app` for a session, `api` for a signed request        | apps/web/app/api/v1/specs/route.ts:7-11 |
| `POST /tx/:action`                            | per action                                 | read from the chain: poster for cancel/accept/reject, current worker for unclaim/deliver | tx.ts:177-182                           |
| `POST /deliveries/upload`, `POST /deliveries` | the job's current machine, while `Claimed` | read from the chain                                                                      | apps/web/lib/server/work.ts:69-75       |
| `GET /jobs/:ref/delivery`                     | poster: every delivery; a machine: its own | the stored delivery rows (who submitted each), not the current worker                    | `readDelivery` in work.ts               |
| `POST /jobs/:ref/rejection`                   | poster, while `Delivered`                  | read from the chain                                                                      | work.ts:193-197                         |
| reads (`/jobs`, `/events`, `/stats`, …)       | anyone                                     | hidden jobs answer 404                                                                   | apps/web/lib/server/jobs.ts:21-27       |

`storeDelivery` also checks that `manifest.job` is this job, that `attempt` is the next one, that the kind matches the
spec, and that each file key starts with `deliveries/<job no>/<attempt>/` (work.ts:107-121).

**Tests.** apps/web/test/api.int.test.ts "lets a machine claim, upload, store a manifest whose hashes match, and
deliver", "shows the delivery to the poster only, with a hash that matches the chain" (a second machine is refused);
apps/web/test/server/delivery-access.test.ts (the poster sees every delivery; the machine now on the job sees only its
own, not the earlier machine's; a machine that left still sees its own; anyone else is refused).

## 7. Rate limits

Fixed windows in the shared store (apps/web/lib/server/rate.ts:7-17), applied by `handler()`
(apps/web/lib/server/http.ts:21-33, 53-56):

| Limit                     | Key                                | Value                   |
| ------------------------- | ---------------------------------- | ----------------------- |
| Writes (any non-GET/HEAD) | `ip:<first X-Forwarded-For hop>:w` | 60 / 60 s               |
| Writes, after auth        | `addr:<address>`                   | 30 / 60 s               |
| Reads                     | `ip:<…>:r`                         | 600 / 60 s              |
| Body size                 | —                                  | 256 KB (http.ts:19, 35) |

**Tests.** No test of `rateLimit` itself was found.

**Not covered.** `/events/stream` (SSE, polls the DB every 2 s per connection), `/api/v1/health` and `/api/v1/blobs/*`
don't go through `handler()` and have no limit. The IP is the first `X-Forwarded-For` hop (rate.ts:20-22); this is
only sound if the host overwrites that header (Vercel: **not verified**). The body is read fully before the size check
(http.ts:34-35) (R13).

## 8. Uploads and downloads

**What.** Delivery files: private to the poster and the machine, size-bounded, hash-checked.

**How.**

- Upload URL: only for the current machine of a `file` job; size from the spec's `max_bytes` (default and cap
  200 MB, packages/formats/src/limits.ts:22); key `deliveries/<no>/<attempt>/<12 hex>-<safe name>`; content type
  forced to `application/octet-stream`; valid 900 s (work.ts:85-97).
- R2: presigned PUT with `ContentLength` signed (apps/web/lib/server/storage.ts:145-158). Local: HMAC-signed grant
  (op, key, expiry, length, type, name) checked in constant time (storage.ts:52-78); PUT must be exactly `len` bytes
  (apps/web/app/api/v1/blobs/[...key]/route.ts:25). Keys are restricted to `[a-z0-9/._-]`, no `..`, and must stay
  inside the folder (storage.ts:34-36, 86-91).
- Hash check: the server streams each stored file back and compares size and sha256 with the manifest
  (work.ts:122-128; storage.ts:173-182); the total is capped at `max_bytes` (work.ts:132-134).
- Downloads: 300 s links (work.ts:174). R2 forces `Content-Disposition: attachment` and
  `application/octet-stream` (storage.ts:160-172). Local adds `nosniff` and `private, no-store`
  (blobs route:39-46). The filename is reduced to `[\w.\- ]` (storage.ts:38).
- **Download domain.** In production the store must be R2 (context.ts:58-60), so links point at R2's endpoint
  `https://<account>.r2.cloudflarestorage.com` (storage.ts:139), a different origin from `samite.fun`, but not a
  Samite-owned download domain. Locally, downloads come from the site's own origin (`/api/v1/blobs/…`); that route
  answers 404 unless the store is local (blobs route:13) and the production gate 404s it anyway.

**Tests.** apps/web/test/server/storage.test.ts "hands out an upload URL whose grant checks out, for exactly that key,
size and type", "hashes what is stored, not what anyone claims", "never lets a key leave the folder", "downloads as an
attachment under the given name"; api.int.test.ts "lets a machine claim, upload, store a manifest whose hashes match,
and deliver".

**Not covered.** The upload URL stays valid for 900 s and can be reused, so the machine can overwrite a file after the
hash check (R7). A delivery's content is deleted 90 days after the job closes: the indexer sets `purge_after` when a
job closes, and the worker hourly deletes due files, strips the manifest's text, link, note and file names, and sets
`pruned_at` (apps/worker/src/purge.ts, decided Nov 13; tests: apps/worker/test/purge.test.ts, the indexer's "dates
each closed job's delivered files", apps/web/test/server/delivery-access.test.ts). The API then returns only the
record and the hash. Uploads never referenced
by a manifest are never cleaned up. Whether R2 enforces the signed content type was **not verified**.

## 9. Untrusted text and the MCP server

**How.**

- Spec instructions render through `Untrusted` (apps/web/components/Untrusted.tsx:24-40): react-markdown 10.1.0 with
  `skipHtml`, an element allowlist with no images, links `rel="nofollow noopener ugc noreferrer"` in a new tab. Used at
  apps/web/app/(site)/(app)/jobs/[ref]/LiveJob.tsx:180. Conditions, notes, reasons and text deliveries are plain
  React text. A URL delivery must be `https:` with no credentials (packages/formats/src/fields.ts:81-95). The only
  `dangerouslySetInnerHTML` is a constant script (apps/web/app/layout.tsx:27, 33).
- MCP: every tool that returns a spec or delivery labels it as untrusted data (packages/mcp/src/server.ts:10-11, 92,
  111-112, 215). `get_job` verifies the spec hash against the chain through the SDK.
- Spending guards (packages/mcp/src/guards.ts): posting is off unless both `SAMITE_MAX_POST_USDC` and
  `SAMITE_DAILY_SPEND_USDC` are > 0 (guards.ts:27, 31-34); one job ≤ the per-job cap (guards.ts:35-38); the UTC day's
  total ≤ the daily cap, kept in a file per address (guards.ts:13, 39-47). Recorded only after a signature
  (server.ts:189-193). Accept and reject need the guard on, but aren't counted (server.ts:218-221).
- Confirm mode: with `SAMITE_CONFIRM=1`, a sending tool returns a dry-run summary and signs nothing until called again
  with `confirm: true` (server.ts:39-49).

**Tests.** packages/mcp/test/guards.test.ts "is off by default: no posting at all", "refuses one job above the per-job
cap, and the day's total above the daily cap", "keeps the day's total across restarts, and starts again the next UTC
day"; packages/mcp/test/mcp.int.test.ts "won't post or review unless the owner of the machine turned it on", "with
SAMITE_CONFIRM=1, shows the summary first and signs only on confirm: true", "finds, checks, claims, delivers a file and
gets paid after a scripted accept". **No test** for `Untrusted`.

**Not covered.** `submit_delivery` still uploads any other local file the model passes (no allowlist directory); keys
are refused (R2, fixed). The confirm summary doesn't list the
files. `find_jobs` reads `accepted_when` from `/spec.json` without the hash check (server.ts:76-78).

## 10. Moderation

**How.** One model call per new spec (apps/web/lib/server/moderation.ts:54-97). The spec goes in as canonical JSON with
`<` escaped, inside `<job_spec>` tags, and the system prompt says it is data (moderation.ts:28-34, 49-50). It fails
closed: a refusal, a cut-off answer or any error gives `pending`, never `pass` (moderation.ts:77-93). Production without
a key passes nothing (moderation.ts:106-112). Only `pass` specs can get a `post` transaction (tx.ts:113-118). The
indexer marks a job `hidden` unless its spec was stored, re-hashes to the on-chain hash, and passed, **at the time of
`JobPosted`** (apps/worker/src/indexer/apply.ts:126, 149). Hidden jobs are off the board, the job page, `spec.json` and
the feed (jobs.ts:25, 85, 205), and so off the MCP tools, but their money rules are unchanged.

**Tests.** apps/web/test/server/moderation.test.ts "fails closed: a refusal, a cut-off answer or an outage is pending,
never pass", "keeps the spec inside its block: a '</job_spec>' in the text can't close it", "passes with no reasons, and
never refuses without one"; apps/worker/test/indexer.test.ts "keeps a job posted around the API, and one with a refused
spec, off the board".

**Not covered.** A job hidden at post time stays hidden even if its spec passes later; there is no tool to hide a passed
job later short of editing the database. Every new spec costs one model call (R12). Non-production runs use the local
moderator, which passes everything (R4).

## 11. Indexer and worker integrity

**How.** Events are read only from inner instructions to the program carrying Anchor's event tag, in successful
transactions (packages/program-client/src/events.ts:111-131). Only the program can sign as its event authority, so these
can't be forged by another program. Logs are not used. Each transaction is applied at most once (keyed by signature,
`events (sig, ix)` unique) with the cursor in the same database transaction (apply.ts:41-56;
packages/db/src/schema.ts:152). An event for a job the index doesn't have stops the indexer (apply.ts:63); an
undecodable event throws (events.ts:109-110). Failed transactions only move the cursor
(apps/worker/src/indexer/sync.ts:67-71). A lost cursor transaction falls back to its slot; a gap in the RPC's history
is logged (sync.ts:41-60). `earned` counts `reward − fee`, as the program does (apply.ts:242-247).

What the index is trusted for: the board, the feed, records and display numbers. Where money moves, the chain is
re-read: `/tx/*` and the work routes (sections 3, 6), the keeper (keeper.ts:77-80), the job page in the browser
(section 4) and `/machines/:address`, which returns `MachineStats` from the chain beside the index's counts
(apps/web/app/api/v1/machines/[address]/route.ts:10-16).

**Tests.** apps/worker/test/indexer.test.ts "applies each transaction at most once, even when replayed by hand",
"survives a kill at every point and catches up on restart", "backfills from the start when the cursor is lost, without
double counting", "falls back to the cursor's slot when the RPC no longer knows the cursor's transaction", "shows the
race's winner, not the claim that failed on-chain"; packages/program-client/test/events.test.ts "ignores look-alike
events from another program and the program's own non-event instructions", "returns nothing for a failed transaction:
its events were rolled back", "throws on an event CPI it cannot decode rather than skip it silently".

**Not covered.** The index reads at `confirmed` (sync.ts:15-16), not `finalized`. It trusts one RPC provider; if the
browser's `NEXT_PUBLIC_RPC_URL` is the same provider, the browser check is not independent of it (R16).

## 12. HTTP hardening and the production gate

**How.** Every route sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` denying camera, microphone, geolocation and
payment, and HSTS for one year with subdomains; `X-Powered-By` is off (apps/web/next.config.ts). `www` redirects to
the apex.

**Content-Security-Policy (Nov 14).** `proxy.ts` sets it on every response with a fresh nonce (apps/web/lib/csp.ts):

- `script-src 'nonce-…' 'strict-dynamic'` (no `'unsafe-inline'`, no `'unsafe-eval'` outside `next dev`): only scripts
  carrying this response's nonce run, and what they load. Next.js puts the nonce on its scripts, the root layout on its
  one inline script. An injected `<script>`, inline handler or `javascript:` URL doesn't run.
- `connect-src`: the site, the browser's RPC (by origin: the API key in its URL is never in a header), the R2 endpoint,
  and Privy's documented domains. `frame-src`/`child-src`: Privy and WalletConnect's verify frames, Cloudflare
  Turnstile. `img-src` adds WalletConnect's explorer for the wallet icons in Privy's list (not in Privy's documented
  policy; found by the Privy test).
- `object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`; `upgrade-insecure-requests` on
  samite.fun. `style-src` allows inline styles (React's style attributes, Privy's styled-components; styles can't run
  code). The gate's 404 and redirect send `default-src 'none'`.
- Every page renders per request (the root layout reads the nonce), so none is served from build-time HTML without
  one. Lighthouse mobile after the change (local `next start`): landing 99 / 96 / 96, `/jobs` 98, `/jobs/new` 100 / 97
  / 96, `/docs` 97; accessibility and best practices 100. Re-measure on samite.fun, where rendering runs in a function.
- zod 4 tries `new Function` once to compile faster parsers; under the policy that attempt is reported as a violation,
  so `instrumentation-client.ts` sets zod's `jitless` before the app starts.
- `SAMITE_CSP_REPORT_ONLY=1` (Vercel env, then redeploy) sends the policy as Report-Only: the browser logs what it
  would block and blocks nothing. The way back if a wallet needs something the policy forbids.

**The gate (changed Nov 13: no placeholder).** Before launch, samite.fun is closed to everyone without the access
key, on every request, by `proxy.ts` (apps/web/lib/gate.ts). Strangers get a plain `404 Not found` for pages, the API
and every file, with `X-Robots-Tag: noindex, nofollow`; `robots.txt` says `Disallow: /`.

- The team opens it with `/?access=<SAMITE_ACCESS_KEY>`. That sets a 30-day `HttpOnly`, `Secure`, `SameSite=Lax`
  cookie holding a SHA-256 of the key (never the key), and redirects to the same address without it.
- Machines send the key in `x-samite-access`. The SDK sends it to the site's own URL only, never to storage URLs
  (packages/sdk/src/access.ts).
- Comparisons are constant-time. A key shorter than 32 characters, or none, keeps the site closed to everyone.
- The owner opens the site with `SAMITE_PUBLIC=1` and a redeploy. Only then do pages say `index` (apps/web/lib/env.ts).
- What the key does not stop: anyone who has it, or a browser holding the cookie, sees everything. Share the link only
  with the team; change the key to cut everyone off.

**Tests.** apps/web/test/gate.test.ts (strangers, the link, the cookie, the header, near-misses, a short key, launch);
apps/web/test/env.test.ts; apps/web/e2e/landing.spec.ts "the home page carries the title, the social card tags and
the hardening headers"; packages/sdk/test/sdk.test.ts "goes to the site, as x-samite-access, and nowhere else".
The policy: apps/web/test/csp.test.ts; apps/web/e2e/csp.spec.ts (twelve pages load with no violation and no page
error, a fresh nonce per response on every `<script>` in the HTML, injected markup can't run code); the M3 acceptance
run (sign, send and the browser's chain check under the policy); e2e/privy.manual.spec.ts (Privy's modal, sign-in and a
post with no violation; run by hand with the App ID, Nov 14).

**Not covered.** Wallets other than the injected test wallet (Phantom, Solflare, Backpack, and their mobile apps) are
checked on samite.fun after M5. A wallet extension's own scripts aren't subject to the page's policy.

## 13. Logging

Every `console.*` and `log(` in shipped code was read. The web app logs unhandled errors as
`{ msg: "unhandled", error: e.message }` (apps/web/lib/server/errors.ts:63); moderation logs only the refusal category
or the error's name and status, never the spec (moderation.ts:78, 88-92). The worker logs start-up, keeper on/off with
the keeper's public address, each keeper outcome, indexed signatures and event names, and loop errors
(apps/worker/src/main.ts:21-65; keeper.ts:84; sync.ts:43-60, 86). The MCP server prints the machine's address and the
API URL on stderr (packages/mcp/src/main.ts:36). No code logs a secret, an `Authorization` header or a delivery
directly. Two indirect paths exist:

- drizzle-orm 0.45.4 wraps a failed query in `DrizzleQueryError`, whose message carries the SQL **and its
  parameters** (node_modules/.pnpm/drizzle-orm@0.45.4…/drizzle-orm/errors.js:10-14). errors.ts:63 logs that message,
  so a failed insert in `storeDelivery` would log the manifest: a text delivery's content and the note (R11);
- both health endpoints return the raw error message to anyone (apps/web/app/api/v1/health/route.ts:12-14;
  apps/worker/src/main.ts:78) (R11).

Sentry (CLAUDE.md §7.1) is not wired in. `RPC_WEBHOOK_SECRET` is parsed (packages/config/src/env.ts:19) but no webhook
route exists; the indexer polls.

## 14. Supply chain and CI

pnpm 12.14.0 (package.json:4). `minimumReleaseAge` is pnpm 12's default (docs/DECISIONS.md:20), not set in
pnpm-workspace.yaml; five `@aws-sdk/*` versions are exempt from it (pnpm-workspace.yaml:7-12). Build scripts run only
for `esbuild` (pnpm-workspace.yaml:5-6). `pnpm-lock.yaml` and `Cargo.lock` are committed and CI installs with
`--frozen-lockfile` (ci.yml:23, 40, 134). Versions are exact except `@types/node` (`^24.19.2`, package.json:19) and
the `react` peer of packages/ui (`^19.0.0`). CI checks that the committed IDL and generated client match the build
(ci.yml:126-138). Actions are pinned by tag, not commit SHA; the Solana CLI installs by `curl | sh` (ci.yml:94); only
the `secrets` job sets `permissions:` (R19).

**`pnpm audit --prod` (Nov 14).** 6 findings, all under `@privy-io/react-auth` (its Ethereum side: `x402`, `wagmi`,
`@walletconnect/ethereum-provider`, `@privy-io/api-base`), none in Samite's own dependencies (Samite's zod is 4.6.7,
patched). Privy 3.51.4, the latest, pulls the same packages.

- `ws` 8.18 (GHSA-96hv-2xvq-fx4p high, GHSA-58qx-3vcg-4xpx moderate): **fixed** by a pnpm override to `^8.21.0`, the
  same major (pnpm-workspace.yaml).
- **Left:** `zod` 3.22/3.25 (GHSA-mrhx-c7xc-m3w5, high: memory on oversized collections), `decode-uri-component` 0.2.2
  (GHSA-vcc3-ghjq-m6fr moderate, GHSA-qr28-fpjm-wq7f high: slow decoding of malformed input), `uuid` 8/9
  (GHSA-w5hq-g745-h8pq moderate: only when the caller passes its own buffer). Each fix is a new major (zod 4, uuid 11,
  decode-uri-component 0.5 is ESM-only while `query-string` 7 requires `^0.2.2`) that the packages pinning them don't
  accept.
- **Why the rest is acceptable for now:** none of it is in the server bundle (the Privy layer is `ssr: false`; no `x402`
  in `.next/server`). It runs only in a visitor's browser, after Privy is loaded, on Ethereum code paths Samite doesn't
  use (Solana wallets only). The worst case is a denial of service of that visitor's own tab on input Privy parses.
  Re-run the audit at each Privy upgrade.

**Privy (added Nov 13, the owner's choice).** On the app's pages, when `NEXT_PUBLIC_PRIVY_APP_ID` is set, the wallet
connect modal is Privy's (`@privy-io/react-auth` 3.51.0, pinned; its native install scripts are not run,
pnpm-workspace.yaml). It is a large third-party bundle running in Samite's origin. What it can't do: sign anything
without the person's wallet asking them, or change what the page checks before a signature (verify.ts runs on the
transaction bytes before they are handed to the wallet). What a compromised Privy release could still do: what any
script on the page can, such as alter what the page shows. Mitigations: an exact version, upgrades read like any other
dependency, loaded only on the app's pages (not the landing) and only on demand (the first click on Connect, or a
returning visitor who connected through it before), wallets only (no email, no Privy-held keys), and a fallback to the
built-in Wallet Standard dialog if Privy fails to load. Its known advisories: `pnpm audit` above.

## Residual risks and known gaps

### Bugs found by this review: fixed

Each was reproduced by a test that failed before the fix (DECISIONS, "M6 prep — security self-review fixes").

- **B1. Medium. A later machine can read an earlier machine's deliveries.** `readDelivery` authorizes against the
  index's current `worker` and returns every submitted delivery of the job, with download links (work.ts:155-162). After
  machine A's delivery is rejected, A can unclaim (or its claim expires); machine B claims and then reads and downloads
  A's work, and can resubmit it. A loses access to its own deliveries. §5.2 says only "the poster and the job's machine"
  may download. **Fixed:** the poster sees every delivery; a machine sees only the ones it submitted, also after it
  left (apps/web/test/server/delivery-access.test.ts).
- **B2. Medium. Delivery files and manifests are never deleted.** The job page (JobClient.tsx:354), the delivery docs
  (apps/web/app/(site)/(app)/docs/delivery/page.mdx:28) and the privacy draft
  (apps/web/app/(site)/(app)/(legal)/privacy/page.mdx:16) say files are deleted 90 days after the job closes, and
  DECISIONS.md:203 says the privacy draft describes only what the code does. `deliveries.purge_after`
  (schema.ts:113) was never written, and nothing called `store.delete`. **Fixed:** the indexer sets `purge_after` at
  close + 90 days; the worker deletes due files hourly (the blob store moved to `packages/storage` so the worker can use
  it). Since Nov 13 (the owner's decision) the text, link, note and file names go too; only the hash and the record
  that a delivery happened stay (apps/worker/src/purge.ts).
- **B3. Low. `/tx/send` is a general relay in practice.** It accepts any transaction that lists the program id among
  its static accounts (tx.ts:305-310), so adding the id as an extra account to any transaction passes. The comment
  (tx.ts:296) and DECISIONS.md:174 say it is "not a general relay". The server signs nothing, so the cost is RPC quota.
  **Fixed:** every instruction must call the escrow program or the compute-budget program, and at least one the escrow
  program (apps/web/test/server/relay.test.ts).

### Other residual risks

1. **R1. Medium → fixed. The browser signed server-built transactions** after checking only the fee payer and the
   server's own summary. **Fixed:** before the wallet is asked, the browser decodes the transaction and requires
   exactly one Samite escrow instruction of the kind the page asked for, on this job, with the connected wallet as its
   signer and fee payer, and nothing else but compute-budget instructions. For a post, the reward shown and the spec
   hash the page computed itself; for an accept or reject, the machine the chain names; for a reject, the hash of the
   reason as typed (apps/web/lib/wallet/verify.ts; apps/web/test/verify.test.ts, including a token transfer slipped
   in). The page also refuses if the server stored a different spec or reason than it sent.
2. **R2. Medium → fixed. MCP could upload the machine's key.** `submit_delivery` reads any path the model passes
   (packages/sdk/src/index.ts), so a spec could talk the model into "delivering" the keypair file. **Fixed:** the SDK
   refuses any file, text, URL or note that holds a real Solana key pair (the CLI's JSON array or base58; only a true
   pair counts, so a transaction signature doesn't), before anything leaves the machine (packages/sdk/src/secrets.ts;
   packages/sdk/test/sdk.test.ts "deliveries never carry a private key"); the MCP server also refuses the
   `SAMITE_KEYPAIR` file by its real path, links included (packages/mcp/test/server.test.ts). Still open: an allowlist
   directory (`SAMITE_DELIVERY_DIR`) and listing file paths in the confirm summary.
3. **R3. Medium → fixed (Nov 14). No full Content-Security-Policy.** **Fixed:** a nonce-based policy with
   `'strict-dynamic'` and a `connect-src` list on every response (section 12). Left: wallets other than the test wallet
   are checked on samite.fun after M5; `SAMITE_CSP_REPORT_ONLY=1` is the way back if one breaks.
4. **R4. Medium → fixed in code; config remains.** Preview deployments ran on local defaults: memory KV, the constant
   session secret, the local store, and the local moderator, which passes every spec. **Fixed:** any Vercel deployment
   (`VERCEL=1`, previews included) refuses the defaults exactly as production does, and without a model key it uses the
   moderator that passes nothing (apps/web/test/server/context.test.ts). **Still the owner's:** give previews their own
   database and bucket (never production's), and turn on Vercel Deployment Protection.
5. **R5. Medium → reduced (Nov 13). Claim squatting with two keys** (PROGRAM-REVIEW residual 9). Time lost, no money
   lost; the poster is refunded after the deadline. The owner's decision: `claim_window = 0` is gone, so every claim
   lapses after 1 h to the deadline (post_job.rs; the default is 24 h); no claim bond in v1.
6. **R6. Medium, accepted for v1. A poster can keep a rejected delivery** (CLAUDE.md §4.6). Bounded by the public
   reason, 24 h to redeliver, at most 3 deliveries. The docs FAQ says so plainly ("Can a poster reject good work and
   keep it?").
7. **R7. Low. A file can change after its hash check.** The presigned PUT is reusable for 900 s (work.ts:95), and the
   browser doesn't re-hash downloads, so the poster may download bytes that differ from the manifest's sha256 while
   the page shows "✓ matches on-chain hash" (for the manifest). Only the machine can do it. **Fix:** copy each checked
   object to a final key no upload URL points at (or use a write-once condition), and re-hash in the browser.
8. **R8. Low. No Samite-owned download domain.** Production downloads come from R2's endpoint host, with attachment +
   octet-stream; local ones from the site origin (gated in production). **Fix:** a dedicated download domain if files
   are ever previewed inline.
9. **R9. Low. `posted_from` is a hint.** It comes from whoever stored the spec first (work.ts:24-47;
   apply.ts:134), so an identical spec posted later inherits it, and anyone can use either path. The docs FAQ now says it
   is a hint (§6.1).
10. **R10. Low. `Proven` can be farmed** for about 0.125 USDC in fees (PROGRAM-REVIEW residual 10). Owner decision.
11. **R11. Low → fixed. Error details leaked into logs and health checks** (section 13). drizzle-orm's
    `DrizzleQueryError` doesn't set `name`, and its message carries the query's parameters. **Fixed:** unexpected
    database errors are logged as "database query failed" with the SQLSTATE code only (`describeError` in
    apps/web/lib/server/errors.ts; apps/web/test/server/describe-error.test.ts runs a real failing query whose
    parameter must not reach the log). The web `/health` answers `{ ok: false }` and logs the detail. The worker's
    `/health` names where the last error happened, not its message.
12. **R12. Low. Moderation cost.** Any signed-in address can store specs (30 a minute per address, 60 per IP), each new
    one a model call; addresses are free. **Fix:** a per-IP daily cap on new specs, or require a USDC account holding at
    least the min reward.
13. **R13. Low. Gaps in rate limiting** (section 7). **Fix:** limit SSE connections per IP; run health and blobs
    through the limiter; confirm Vercel overwrites `X-Forwarded-For`; check `Content-Length` before reading the body.
14. **R14. Low. Signed requests aren't bound to a host.** **Fix:** add the host to the signed message in a `samite:v2`.
15. **R15. Low. Sessions.** 7 days, no idle timeout, expired rows kept, login CSRF on `POST /session`. **Fix:** the
    Origin check on all methods; delete expired rows; consider a shorter session.
16. **R16. Low. The browser's chain check is weaker than it looks.** It takes the account address on trust, skips
    `fee_bps`, and may use the same RPC provider as the index. **Fix:** derive the PDA from `(poster, job_id)`, check
    the account's owner, compare `fee_bps`; use a different provider for `NEXT_PUBLIC_RPC_URL` than `SOLANA_RPC_URL`.
17. **R17. Low. MCP guard details.** The daily total is a read-modify-write file (not atomic); accept and reject are
    gated by the switch but not counted. Acceptable for one MCP process per machine.
18. **R18. Low. Storage cost.** Orphan uploads are never cleaned; every `POST /deliveries` streams each file (up to
    200 MB) back through the function to hash it (storage.ts:173-182). **Fix:** expire unreferenced keys (R2 lifecycle).
19. **R19. Low. CI supply chain** (section 14). **Fix:** pin actions to SHAs; check the Solana installer's checksum;
    set `permissions: contents: read` for the whole workflow.
20. **R20. Low. Production accepts a missing `SAMITE_PROGRAM_ID`** and uses the compiled-in id (context.ts:76). Right
    once the M5 rebuild sets the owner's id; refusing it would be safer.

## Before launch (owner)

- [x] B1–B3 are fixed. Text deliveries, links and notes are deleted after 90 days too (Nov 13).
- [ ] Vercel **production** env: `DATABASE_URL`, `SOLANA_RPC_URL`, the four `R2_*`,
      `ANTHROPIC_API_KEY` + `MODERATION_MODEL`, `NEXT_PUBLIC_SITE_URL=https://samite.fun`, `NEXT_PUBLIC_RPC_URL` (a
      read-only, rate-limited key, ideally another provider), the program id after M5.
- [ ] `SESSION_SECRET`: a new random value (32+ bytes) set only in the host. Rotating it later signs everyone out.
- [ ] Preview env: its own database and bucket, no production secrets, Deployment Protection on (R4).
- [ ] R2 bucket private (no public access); CORS allows `GET` from `https://samite.fun` only (the delivery preview
      fetches from it; **not verified**).
- [ ] Admin, upgrade authority and treasury keys never in any `.env`; a Squads multisig is recommended (§16).
- [ ] Keeper: a new key with at most 0.5 SOL (docs/RUNBOOK.md:150); `KEEPER_ENABLED=true` only after its own "go";
      keep the worker's `/health` off the public internet or fix R11.
- [x] `pnpm audit --prod` run and reviewed (section 14, Nov 14); the gitleaks job is green on `main` (Nov 14).
- [x] The PROGRAM-REVIEW open items are decided (Nov 13: every claim lapses; no claim bond; `Proven` stays a hint).
- [ ] Re-verify the USDC mint against Circle's page before M5 (`TODO(verify)`).
- [x] `script-src` with nonces and `connect-src` in the CSP (R3, Nov 14); Lighthouse re-measured locally.
- [ ] Re-measure Lighthouse on samite.fun (pages now render per request), and connect Phantom, Solflare and Backpack
      there once (the policy is checked with the test wallet only).
