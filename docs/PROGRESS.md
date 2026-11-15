# Progress

One note per milestone (CLAUDE.md §14), newest first.

## M5 — the keeper is on (Nov 15, 2026)

The owner said "go" for the keeper. A new key, made only for it: `VxdTHQNHdLP3LXCfP5AEu2P3kNmBgyZXtMYEN5F7x4J`, funded by the owner with 0.005 SOL (0.00065 of it is the minimum a wallet keeps; the rest pays about 870 transactions at 0.000005 SOL). It has no authority over anything and pays no rent. The key was generated without printing its seed phrase; `KEEPER_SECRET` went from `scripts/mainnet/keeper-secret.ts` into a file only the owner could read, the owner pasted it into Railway, and the file was deleted. The keypair stays in the owner's `~/samite-keys/keeper.json`.

The worker logs `"keeper on"` with that address (Railway deployment of `adcc9c6`, 00:47 UTC) and no errors. No job was open, so it had nothing to send yet.

The mainnet test of the person's path (Nov 14–15): a post from Phantom, a claim and a text delivery from the machine, an accept. Every amount matched the chain to the lamport. The bugs found on the way are fixed (DECISIONS, "Manual tests on the closed site" and the Nov 15 sections).

## M5 — mainnet: accepted (Nov 14, 2026)

**The owner ran every step on mainnet**, each after a dry run, with `--go` and a typed `GO`. Claude prepared the commands, checked each step read-only, and sent nothing.

- **Rehearsed first:** Nov 14, on a fresh local chain with the same build. Config, then the first job: machine +0.975 USDC, treasury +0.025 USDC, the index showed `paid`.
- **USDC:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` matches Circle's page (Mainnet, Solana). On mainnet it is SPL Token with 6 decimals.
- **Deploy:**
  - `AcTtHioeudEDQuaW6WaL5auXC2rv3jPNoNbPxPB7pHM9` at slot 469143284, tx `3PGpaEmz…S5E`.
  - The bytes dumped from mainnet match the reviewed build: 459,328 bytes, sha256 `5f13ba8bf5b154bb238d4b294fa47b31c96ad920a7fd3d1874c9d11c1ba077ec`.
  - Upgrade authority: `7kLmE4LX48zphahkWgMXD1ZAYd4RWxThHnbo8S8WESZY`, the owner's key.
  - Program data rent: 2.33426508 SOL. No buffer was left open.
- **Config:** tx `5xSaXXZA…oV9N`, slot 469145241.
  - Admin is `7kLm…WESZY`.
  - The treasury is `6DDyY4bVh1W7rURPB9qmCwdUKmN8StHuZMN5REruyTmM`, the USDC account of `9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM`.
  - Fee 250 bps, minimum reward 1 USDC, not paused.
- **First job:** `25WsVhqqnRExuyiKweSD94XYp7cf4ng1K2WGWGSqo8gg`, 1 USDC, poster `5tpU…6dir`, machine `CARm…XZnH`.
  - Transactions: post `4uPnaAJf…`, claim `3MtToxxc…`, deliver `5fmgJTBz…`, accept `63UohZcf…` (slots 469145827–469145848).
  - Money checked on mainnet:
    - the treasury's USDC went from 0.015001 to 0.040001, **+0.025000, exactly 2.5%**;
    - the machine received **0.975000**;
    - the poster's SOL fell by two network fees only, because the job's rent came back;
    - the machine paid 0.00148844 SOL for its USDC account and 0.0009398 SOL for its record.
- **Index:** the worker on Railway logged all five events, `ConfigInitialized`, `JobPosted`, `JobClaimed`, `DeliverySubmitted` and `JobPaid`, within seconds. The job is `paid`, and hidden on the board, because its spec wasn't stored through the API.
- **Production around it:**
  - samite.fun runs on Vercel, closed by the access key;
  - `/api/v1/health` answers `ok` (database, RPC, storage);
  - the worker runs on Railway with the keeper **off**;
  - Postgres is on Neon, files are on Cloudflare R2, and there is no Redis (Postgres `kv`).
- **Next:**
  - the keeper, on a separate "go";
  - manual tests on the closed site with real wallets (Phantom, Solflare, Backpack, through Privy);
  - Squads for the upgrade authority, admin and treasury;
  - the launch: `SAMITE_PUBLIC=1`.

## M6 prep — security self-review (Nov 12, 2026)

`docs/SECURITY-REVIEW.md` is a self-review of the off-chain system, written for the owner. It is not an audit, and no external audit has been done. Every claim in it cites `file:line`. It found three places where the code did less than the docs said, plus two leaks. All five are fixed, each with a test that failed before the fix:

- **Deliveries:** a machine now sees only its own deliveries. Before, the next machine on a job could download the previous machine's work.
- **File deletion:** delivered files are now deleted 90 days after the job closes, as the privacy draft says. The worker does it hourly. The blob store moved to `packages/storage` so the worker can use it.
- **Relay:** `/tx/send` relays only escrow-program transactions.
- **Keys:** a delivery never carries a private key. The SDK refuses any key pair in a file, text, URL or note before any request. The MCP server refuses its own keypair file.
- **Logs:** logs and `/health` never carry a failed query's parameters.

The remaining risks are listed with severity and a suggested fix. The largest are:

- **R1:** the browser signs server-built transactions after checking the fee payer and the amount.
- **R3:** there is no full CSP yet.
- **R4:** preview deployments run on local defaults.

The "Before launch" checklist is the owner's.

**Lighthouse (mobile, `next start` on the local harness, live data):** `/jobs`, a job page, a machine page and `/landing` all score performance 100, accessibility 100 and best practices 100. Best practices was 96 before a hydration mismatch in the wallet chip was fixed (React #418: the server rendered its placeholder, the browser the connect button). The M3 acceptance now fails on any page error. SEO is 66 on these previews by design, because they are `noindex` until launch (§14 M6).

The landing now shows live numbers where real data exists, and keeps the labelled example otherwise (DECISIONS, "M6 prep — live landing numbers").

Also on Nov 12:

- **CI:** the visual checks on Linux CI now pass with a 5% bound. The failing checks attach both images, and the difference is font rasterisation and system fallback glyphs, not layout. The strict bounds stay on macOS.
- **Phone layout:** the M3 screens are shot at 390×844 too, and a long CSV line no longer widens the job page on phones.

## M5 — mainnet, prepared (Nov 12, 2026)

**Status: ready for the owner. Nothing has been sent to mainnet.** `scripts/mainnet/` holds four scripts: `deploy-program.ts`, `initialize-config.ts`, `first-job.ts` and `keeper-secret.ts`.

- **What every script does:**
  - starts with what it sends, from which key, and what it costs, read live from mainnet;
  - is dry by default, and sends only with `--go` and a typed `GO`;
  - refuses any network but mainnet (genesis hash);
  - reads keys only from files named on the command line.
- **The review fixes from #3 are merged:** a machine that left a job can't reclaim it, `earned` excludes donations, and the treasury is always the treasury owner's USDC ATA. The program builds to the same sha256 twice.
- **Rehearsal on the local validator** (`--rehearse-local`, which accepts only `127.0.0.1:8899`):
  - `initialize_config` from the script;
  - the first job: post, claim, deliver, accept;
  - machine +0.975 USDC, treasury +0.025 (exactly 2.5%);
  - the worker's index shows the job `paid`.
- **Read-only dry runs against mainnet** with a key that holds no funds:
  - the program address is free;
  - the USDC mint is SPL Token with 6 decimals.
- **Deploy cost:** the program is deployed at its exact size, which locks 2.33 SOL; about 4.67 SOL is needed at the peak, while the buffer exists. An upgrade extends the account automatically.
- **The owner's steps:** `docs/RUNBOOK.md`, "M5: mainnet". Decisions first (program address, upgrade authority, treasury owner, USDC check), then deploy, initialize, index, the first job, and, with a separate "go", the keeper.

**Accept when** (§14 M5) the owner has run the first mainnet job, the treasury received exactly 2.5%, and the index shows it.

## M4 — the machine interface (Nov 12, 2026)

**Acceptance (§14 M4): passed.** The MCP end-to-end test (§13) passes, and a machine does the whole flow over plain HTTP with local signing (the M3 acceptance run and the API integration test).

- **`@samite/mcp`**, driven by a scripted MCP client over stdio as the machine: lists the nine tools, `find_jobs` (reward, what the machine receives, conditions, the poster's record), `get_job` (spec verified against the chain; an injection line planted in the spec comes back as labelled data), `claim_job`, `submit_delivery` with a local file, a scripted accept by the poster, and `get_balance` shows exactly +11.70 USDC. Posting is refused while off; with `SAMITE_CONFIRM=1` nothing is signed until `confirm: true`. 3/3.
- **`@samite/sdk`**: a poster and a machine, each with only its own key and RPC: a dry run signs nothing; post; find and get (spec verified on-chain); claim; deliver a file; accept; the machine gets exactly 39.00 and the treasury 1.00. 3/3, plus 4 unit tests (a lying API's spec is refused; request signatures verify; error codes).
- **Security choice**: the SDK and the MCP server never sign a transaction the API built; they build every transaction from the chain through the machine's own RPC and check every hash they rely on.
- **Found and fixed on the way**: the indexer stopped for good when the RPC no longer had its cursor's transaction (the local validator keeps minutes of history); it now re-reads from the cursor's slot, and logs a gap if history is missing (production needs an archival RPC).
- **Docs**: the Quickstart shows the real SDK, MCP settings and HTTP calls.

Publishing `@samite/sdk` and `@samite/mcp` to npm waits for the owner to confirm the `@samite` scope (§16).

## M3 — the app on the local validator (Nov 12, 2026)

**Acceptance (§14 M3): passed.** `pnpm --filter @samite/local run up`, then `pnpm --filter web e2e:m3` (3 green runs, two of them on the same harness):

1. A person connects a wallet in the browser (a Wallet Standard test wallet injected into the page; it signs with a local harness key, in the test process) and posts a job: spec → moderation (local pass) → unsigned `post_job` from the API → the wallet signs → relayed → the job page. One sign-in, one transaction.
2. The job page checks itself against the chain in the browser: status, machine, reward and hashes match; the spec served by the API hashes to the on-chain `spec_hash`.
3. A scripted machine, over plain HTTP with signed requests and local signing: claim, upload a CSV, store the manifest (hashes checked server-side), `submit_delivery`.
4. The person opens the delivery: the browser re-hashes the stored manifest and it matches the on-chain hash; the first rows preview. Accept and pay: one transaction.
5. Every number against the chain: machine +78.00 USDC, treasury +2.00 (2.5%), poster −80.00; the poster's SOL moved by exactly its two network fees (the job's and the vault's rent came back); the job page's escrow numbers; the machine page equals `MachineStats` (accepted, earned); the board's "N open · X USDC in escrow" equals the program's live `Job` accounts; the live feed shows the payout; My jobs shows the job as paid.

| Suite                                                                                                                  | Result                          |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Unit (formats 275, config 17, ui 29, program-client 15, db 6, local 3, worker 22, web 49)                              | all pass                        |
| Indexer on a recorded validator session: replay, re-sync, lost cursor, small pages, kill at every fetch, growing chain | 15/15                           |
| Keeper on LiteSVM at exact boundary seconds (+ `Job` size check)                                                       | 8/8                             |
| API on the local validator (post → claim → upload → deliver → accept, exact balances)                                  | 6/6                             |
| `@samite/db` schema on Postgres 17 via postgres-js                                                                     | 6/6                             |
| Playwright, design and behaviour (example data)                                                                        | 88 passed, 18 skipped by design |
| M3 acceptance (live data)                                                                                              | 1/1                             |

Screens from the acceptance run: [job, open](progress/m3/job-open.png) · [job, delivered](progress/m3/job-delivered.png) · [job, paid](progress/m3/job-paid.png) · [board](progress/m3/board.png) · [machine](progress/m3/machine.png) · [my jobs](progress/m3/me.png).

Not live yet, and labelled as example where it shows: the "Escrow, last 24 h" print (no escrow series in the index yet). Example data otherwise appears only with `?example`.

Reviews: the M1 review's Critical (the production gate could be undone by Vercel's Turbo cache) and Important findings are fixed on `m1-landing` (PR #2); the M2 security review found no way to move escrowed funds elsewhere, and its Important findings (claim squatting, `earned` inflation, treasury liveness) are being fixed on `m2-escrow-and-formats` (PR #3); see DECISIONS.

## M2 — Escrow program, local (2026-11-12)

**Built:** `programs/samite_escrow` (Anchor 1.2.2): `Config`, `Job`, `MachineStats`; 14 instructions (§4.3, with the admin
change as `propose_admin` + `accept_admin`); one payout path (`settle.rs`); an `emit_cpi!` event for every state change.
`packages/program-client`: the Codama client for `@solana/kit`, generated from the committed IDL. `packages/formats`:
`samite/job@1`, `samite/delivery@1` and rejection reasons: schemas, NFC + RFC 8785 canonical bytes, sha256.

| Check                                                  | Result                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program tests (LiteSVM, `cargo test -p samite_escrow`) | **167 passed** (141 before the review fixes of Nov 12): every happy path and every must-fail case of §13 by name, exact balances (poster, machine, treasury, rent back to the poster), pause, clock edges |
| Fee maths                                              | every reward 1…10,000,000 at 5 fee levels (unit) and 216 full payouts on-chain: `to_machine + fee == reward`, `fee == floor(reward·bps/10000)`                                                            |
| Mutation                                               | fourteen guards removed one at a time (three at M2, eleven for the Nov 12 fixes); the matching tests failed each time                                                                                     |
| Compute                                                | every instruction under 70k compute units (the default budget is 200k)                                                                                                                                    |
| Formats (`@samite/formats`)                            | **267 tests**: RFC 8785 vectors, golden specs/deliveries hashed independently (Python stdlib, `shasum`), schema limits, NFC                                                                               |
| Codama client                                          | 8 tests tying it to the IDL; CI checks the IDL and client don't drift                                                                                                                                     |
| Self-review                                            | `docs/PROGRAM-REVIEW.md`: every instruction, its signer, each check and the test that proves it. **A self-review, not an audit.**                                                                         |

**Please read `docs/PROGRAM-REVIEW.md`** (M2 is accepted when you have).

**Owner decisions** (logged in `DECISIONS.md`, none block): USDC sent straight into a vault above the reward goes to the
machine on a payout (or the poster on a refund), but never counts as `earned` — say if you prefer the poster;
`initialize_config` must be signed by the program's upgrade authority (so at M5 the deploy key or multisig signs it).

**Review fixes (Nov 12):** six findings fixed (claim squatting by one key, `earned` inflation, treasury liveness, a
zero-address admin proposal, vault front-running, weak tests); four open questions for you (removing `claim_window = 0`,
a claim bond, harder `Proven`, cancelling an admin proposal). See "Review findings (Nov 12)" in `PROGRAM-REVIEW.md`.

## M1 — Design system + landing (2026-11-12)

**Built:** every §11.7 component (`@samite/ui/components`, `@samite/ui/app`), the landing (§11.10), the app's screens
with labelled example data (board, post a job, job page with the reject dialog, machine page, my jobs), and the docs
skeleton (MDX: overview, quickstart, escrow, fees, job spec, delivery, signed requests, errors, FAQ). All of it is
preview-only: on Vercel production every page but `/` returns 404 until you approve the landing.

**Where to look:** a Vercel preview deployment of this branch (or `pnpm --filter web build && pnpm --filter web start`):
`/landing`, `/jobs`, `/jobs/new`, `/jobs/0415`, `/machines/9be2Kq7xR4mW1pZ8vN3tL6yB5cH2dJ0sFgTn04aa`, `/me`, `/docs`.

| Check                                                                   | Result                                                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing first screen vs `landing-hero.png` / `landing-mobile-hero.png`  | 0.16% / 0.36% of pixels differ (t = 3 s)                                                                                                       |
| Whole landing vs `landing-desktop-full.png` / `landing-mobile-full.png` | above the footer 0.45% / 0.36%; footer art band 0.03% / 0.9% (the footer's link columns differ on purpose: dead links are hidden)              |
| Hero vs `landing-hero.mp4`                                              | frame for frame at t = 1.4 + n/30 (t ± 1 s and ± 2 s are clearly worse)                                                                        |
| Footer word vs `landing-footer-word.mp4`                                | matches within the capture's jitter (the video is a real-time capture compressed to 7.2 s; t ≈ 0.749 + 0.159·n)                                |
| App screens vs `app-*.png`                                              | board 0.84%, post 0.33%, job 0.55%, machine 0.16%; phones 0.10% / 0.38% / 0.20%                                                                |
| Lighthouse mobile (`next start`)                                        | landing 100 / 100 (×3), board 100 / 100, job 100 / 100, post 100 / 100                                                                         |
| axe (WCAG 2.2 AA)                                                       | 0 violations on landing, app screens and docs, desktop and phone                                                                               |
| Behaviour                                                               | filters, sort, live summary in base units, validation, reject dialog, tabs, menu, code tabs, reduced motion, no sideways scroll at 390–1440 px |
| Production gate                                                         | forced-production build: `/` 200, every preview page 404                                                                                       |

**Side by side** (left: reference, right: ours) in `docs/progress/m1/`:

![landing hero](progress/m1/landing-hero.png)
![landing](progress/m1/landing-desktop-full.png)
![board](progress/m1/app-board.png)
![post a job](progress/m1/app-new.png)
![job](progress/m1/app-job.png)
![machine](progress/m1/app-machine.png)

**Owner questions** (also in `DECISIONS.md`, none block): whole-number example aggregates ("48,210 USDC") vs 2 decimals;
one refunded glyph everywhere (crossed square on the landing, dashed square in the app).

## M0 — Repo + placeholder (2026-11-12)

**Built:** pnpm + Turborepo monorepo, CI (typecheck, lint, unit tests, build, Playwright e2e, gitleaks), `packages/config`
(brand, Solana constants, env parsing), `packages/ui` (tokens, base styles, **the press ported to TypeScript**, the mark,
`<Press>`), `apps/web` with the placeholder at `/`, favicons, OG/X card, manifest, robots.

**Checks (§2):**

| Check                                                                   | Result                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Press port = reference engine                                           | **Pixel-identical**: 4 variants (dot/cycle, bayer/breathe in ink, square/breathe, bayer/still) × 2 sizes × 8 values of t, plus the mark itself. A 1.12→1.13 mutation of the dot radius fails the test. (`e2e/press-parity.spec.ts`) |
| 1440×900 vs `placeholder-desktop.png`                                   | 0.28% of pixels differ by more than 48/255 (threshold 0.5%; a wrong t gives 6–9%)                                                                                                                                                   |
| 390×844 vs `placeholder-mobile.png`                                     | 0.39%                                                                                                                                                                                                                               |
| Print cycle vs `placeholder-press-cycle.mp4` / `placeholder-mobile.mp4` | **Frame for frame**: video frame n = press t = 1.4 + n/30 s. Scatter frames (unique per t) pick out exactly that t; every other frame is within 0.5 of the best possible error. Off by one frame fails. (`e2e/motion.spec.ts`)      |
| `?shot&t=7`                                                             | freezes the press, the blink and the entrance                                                                                                                                                                                       |
| Reduced motion                                                          | still print, nothing moves (`e2e/placeholder.spec.ts`)                                                                                                                                                                              |
| Lighthouse mobile (`next start`, 3 warm runs)                           | performance **97 / 97 / 97**, accessibility **100**, best practices 100, SEO 100; TBT 10–30 ms, CLS 0                                                                                                                               |
| axe (WCAG 2.2 AA)                                                       | 0 violations, desktop and phone                                                                                                                                                                                                     |
| Contrast of every text token pair                                       | ≥ 4.5:1 (`packages/ui/test/contrast.test.ts`)                                                                                                                                                                                       |
| No photos, no forms                                                     | checked in e2e                                                                                                                                                                                                                      |
| OG card in X's validator                                                | after deploy (owner)                                                                                                                                                                                                                |
| `samite.fun` over HTTPS, `www` → apex                                   | after DNS (owner), see `RUNBOOK.md`                                                                                                                                                                                                 |

**Side by side** (left: reference, right: ours, `?shot&t=7`):

![desktop](progress/m0/placeholder-desktop.png)
![phone](progress/m0/placeholder-mobile.png)
