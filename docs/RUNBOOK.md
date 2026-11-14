# Runbook

Steps only the owner runs. Claude Code prepares them; it never runs them.

## Vercel: deploy `apps/web` (closed until launch)

There is no placeholder (the owner's decision, Nov 13). samite.fun serves the real site, closed to everyone but the team until launch. Strangers get a plain 404 for every page, the API and every file, and nothing is indexed. The team opens it once per browser with a secret link (apps/web/lib/gate.ts).

1. Vercel → **Add New → Project** → import `trappalfy/samite` (GitHub).
2. **Root Directory:** `apps/web`. Framework preset: **Next.js** (detected). Leave Build / Install / Output on their defaults: Vercel installs the pnpm workspace from the repo root and builds with Turborepo.
3. **Node.js version** (Settings → Build and Deployment): 24.x.
4. **Environment variables → Production:**
   - `SAMITE_ACCESS_KEY`: run `openssl rand -hex 32` in a terminal and paste the 64 characters. Keep it like a password. It is the key to the closed site; shorter than 32 characters, the site stays closed to everyone, you included.
   - `NEXT_PUBLIC_PRIVY_APP_ID`: the Privy App ID (also for Preview).
   - The services for the app come later (section "Production services" below). Never add the admin, upgrade-authority or treasury keys to Vercel, ever.
5. Deploy. The production branch is `main`; every PR gets a preview URL, which Vercel keeps behind its own login (Deployment Protection, on by default). Keep **Automatically expose System Environment Variables** on (the default): the gate reads `VERCEL_ENV`.
6. Check on the `….vercel.app` production URL:
   - in a private window, `/`, `/jobs` and `/api/v1/health` answer **404 Not found**, and `/robots.txt` says `Disallow: /`;
   - open `https://<production URL>/?access=<your SAMITE_ACCESS_KEY>`: the site opens, and the key leaves the address bar. The browser keeps access for 30 days (a cookie holding a hash of the key). Do it once per browser and device.
7. If the install step fails on the pnpm version: add the env var `ENABLE_EXPERIMENTAL_COREPACK=1` (the repo pins `pnpm@12.14.0` in `packageManager`) and redeploy.

**Machines before launch** (SDK, MCP): they send the key in an `x-samite-access` header. In the SDK, pass `accessKey`; for the MCP server, set `SAMITE_ACCESS_KEY` in its `env`. The key goes to samite.fun only, never to storage.

**To change the key:** set a new `SAMITE_ACCESS_KEY` and redeploy. Every browser has to open the new secret link again.

**If a wallet stops working after a deploy** (its window doesn't open, or a request is blocked): the site's Content-Security-Policy may be blocking something it needs. Set `SAMITE_CSP_REPORT_ONLY=1` in Vercel → Production and redeploy: the browser then only logs what the policy would block (DevTools → Console, "Content Security Policy") and blocks nothing. Send Claude those lines, then remove the variable once the policy is fixed.

## Domain: samite.fun at Spaceship → Vercel

1. Vercel project → **Settings → Domains** → add `samite.fun`, then add `www.samite.fun` and choose **Redirect to `samite.fun`** (308).
2. Vercel then shows the exact DNS values **for this project**. Copy them from there, not from a guide:
   - apex `samite.fun`: an **A** record, host `@`, value = the IP Vercel shows;
   - `www`: a **CNAME** record, host `www`, value = the `…vercel-dns…` target Vercel shows.
3. Spaceship → Domains → `samite.fun` → **DNS records**: remove any parking/default A, AAAA or CNAME records on `@` and `www`, add the two records above, save. (Keep the nameservers on Spaceship.)
4. Wait until Vercel shows both domains as **Valid Configuration** (minutes to a few hours). Vercel issues the HTTPS certificate itself.
5. Write the two exact records here once set:

   | Type  | Host | Value           |
   | ----- | ---- | --------------- |
   | A     | @    | _(from Vercel)_ |
   | CNAME | www  | _(from Vercel)_ |

6. Check: in a private window `https://samite.fun` answers 404; `https://samite.fun/?access=<key>` opens the site; `https://www.samite.fun` redirects to `https://samite.fun`.

## Launch (the owner's "launch")

1. Vercel → Settings → Environment Variables → Production: add `SAMITE_PUBLIC` = `1`.
2. Deployments → the latest production deployment → **Redeploy**. The flag is read at build time too (robots.txt and the pages' robots tags), so a redeploy is needed.
3. Check in a private window: `https://samite.fun` opens for everyone; `/robots.txt` allows crawling; paste `https://samite.fun` into X's post composer and check the card shows.

## Production services (before testing on mainnet)

The app on samite.fun needs these in Vercel → Environment Variables → **Production**. Give **Preview** its own database and bucket, and no production secrets.

| Variable                                                                 | What                                                                                                               | Where from                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `SOLANA_RPC_URL`                                                         | the server's mainnet RPC                                                                                           | an RPC provider (e.g. Helius)                                                                                                   |
| `NEXT_PUBLIC_RPC_URL`                                                    | the browser's RPC: a read-only, rate-limited key, ideally another provider                                         | an RPC provider                                                                                                                 |
| `DATABASE_URL`                                                           | Postgres (the index)                                                                                               | e.g. Neon                                                                                                                       |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                     | **optional**: rate limits, replay protection and sign-in nonces live in Postgres (table `kv`) unless these are set | Upstash, only if Postgres ever becomes the bottleneck (then name Upstash on the privacy page again)                             |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | deliveries and attachments                                                                                         | Cloudflare R2: a **private** bucket; a token with read and write on that bucket only; CORS `GET` from `https://samite.fun` only |
| `ANTHROPIC_API_KEY`, `MODERATION_MODEL`                                  | the spec moderation                                                                                                | console.anthropic.com; model `claude-opus-5-5` (or `claude-sonnet-5-5`, cheaper)                                                |
| `SESSION_SECRET`                                                         | signs sessions                                                                                                     | `openssl rand -base64 48`, set only here; changing it signs everyone out                                                        |
| `NEXT_PUBLIC_SITE_URL`                                                   | `https://samite.fun`                                                                                               |                                                                                                                                 |
| `NEXT_PUBLIC_PROGRAM_ID`                                                 | the program, after M5                                                                                              | the deploy output                                                                                                               |
| `SAMITE_ACCESS_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID`                          | see above                                                                                                          |                                                                                                                                 |

The worker (indexer and keeper) runs on Railway with the same `DATABASE_URL`, `SOLANA_RPC_URL` and `R2_*` (section "Worker on Railway").

## Worker on Railway (indexer and keeper)

The worker indexes the program into Postgres, runs the keeper once you say "go", and deletes delivery content 90 days after a job closes. Railway builds it from the `Dockerfile` at the repo root (Node 24.21, pnpm 12.14; CI builds the same image on every push).

1. Railway → **New Project** → **Deploy from GitHub repo** → `trappalfy/samite`.
2. The service's **Settings**: leave **Root Directory** empty (the image needs the whole workspace). The build log should say `Using detected Dockerfile!`.
3. **Region**: the same as the Postgres database (the worker talks to it constantly).
4. **Variables** (service variables, never in git):
   - `DATABASE_URL`: the same production Postgres as Vercel's. The worker migrates it on start.
   - `SOLANA_RPC_URL`: a mainnet RPC (a separate key from the web app's is fine).
   - `SAMITE_PROGRAM_ID`: the program address, after M5's deploy.
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`: the same bucket as Vercel's.
   - `KEEPER_ENABLED=false`. The keeper is its own "go" (M5, step 6), and only then does `KEEPER_SECRET` go here.
   - `INDEXER_POLL_MS` (optional): how often the indexer checks the chain, in ms (1000–20000, default 2000). Each check is one RPC call: every 2 s is about 1.3M calls a month, more than Helius's free plan (1M credits); `5000` (about 0.5M) fits it while the site is closed. On a paid plan, remove it before launch.
   - Railway sets `PORT` itself.
5. **Health check**: in the service settings, set the health endpoint to `/health`. Railway checks it after each deploy. It answers 200 once the indexer has synced with the chain in the last 30 seconds, and 503 otherwise.
6. **Networking**: do **not** generate a public domain. Nothing outside needs the worker, and its `/health` stays private.
7. Deploy. The logs show JSON lines: `"worker up"`, then the indexer's progress. `"keeper on"` appears only once the keeper is enabled.

## Privy: the wallet connect modal

The app connects wallets through Privy's modal when `NEXT_PUBLIC_PRIVY_APP_ID` is set. It is wallets only: no email or social login and no Privy-made wallets. Without the ID (local runs, tests), or if Privy fails to load within 10 s, the app's own Wallet Standard dialog is used instead.

1. Create an app at https://dashboard.privy.io (free tier).
2. Login methods: enable **Wallet** only. External wallets: **Solana** on (Ethereum off). Embedded wallets: off.
3. Allowed domains (Settings → Domains): `https://samite.fun`, `https://www.samite.fun`, and `http://localhost:3000` for local checks.
4. Copy the **App ID**. It is public, not a secret. In Vercel → Project → Settings → Environment Variables set `NEXT_PUBLIC_PRIVY_APP_ID` to it (Production and Preview), then redeploy. The App Secret is not needed: Samite keeps its own Sign-In With Solana session.
5. Check: on `/jobs`, "Connect wallet" opens Privy's modal in Samite's colours (black, cream, square corners) and lists Phantom, Solflare and Backpack.

Locally real wallets can't sign: the local chain is `solana:localnet`, which Phantom and the other wallets don't serve. The test wallet can, through Privy: build with the App ID, serve it on `localhost:3000` against the local harness with a worker running, then `pnpm --filter web e2e:privy`. Real wallets through Privy are checked on mainnet after M5.

## Run everything locally (no real money, no network)

Needs: Node 24, pnpm, the Solana CLI 4.4 and Anchor 1.2.2 (for `anchor build`), and Postgres on PATH (Homebrew `postgresql@17` works; the harness runs its own cluster on port 55473 and never touches yours).

1. `pnpm install` and `anchor build` (the program's `.so` is not committed).
2. `pnpm --filter @samite/local run up`: a fresh `solana-test-validator` with the program and USDC at its real address (a local mint), funded test wallets (`.data/local/keys`), and a fresh, migrated database. `pnpm --filter @samite/local run down` stops both.
3. The worker (indexer + keeper):
   `DATABASE_URL=postgres://postgres@127.0.0.1:55473/samite SOLANA_RPC_URL=http://127.0.0.1:8899 pnpm --filter @samite/worker start`
4. The web app: `pnpm --filter web build`, then
   `DATABASE_URL=postgres://postgres@127.0.0.1:55473/samite SOLANA_RPC_URL=http://127.0.0.1:8899 pnpm --filter web exec next start`
   and open `http://localhost:3000/jobs`. A wallet must support `solana:localnet` to sign here.

The end-to-end checks, each against that harness: `pnpm --filter web e2e:m3` (a person in the browser, a machine over HTTP), `pnpm --filter @samite/sdk test:int`, `pnpm --filter @samite/mcp test:int`, `pnpm --filter web test:int`.

## M5: mainnet (the owner runs every step)

**Done Nov 14, 2026** (docs/PROGRESS.md, "M5 — mainnet: accepted").

- Program `AcTtHioeudEDQuaW6WaL5auXC2rv3jPNoNbPxPB7pHM9`, upgrade authority and admin `7kLmE4LX48zphahkWgMXD1ZAYd4RWxThHnbo8S8WESZY`.
- Treasury: the USDC account `6DDyY4bVh1W7rURPB9qmCwdUKmN8StHuZMN5REruyTmM` of `9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM`.
- First job paid. The keeper is still off: step 6 below.

Run the scripts from `scripts/mainnet/` (`cd ~/Desktop/samite/scripts/mainnet` first; elsewhere `pnpm exec tsx` isn't found). Put the RPC URL in double quotes: the `?` in it trips the shell otherwise.

Nothing here runs without you. Every script in `scripts/mainnet/` is dry by default: it prints what it would send, from which key and what it costs (read live from mainnet), and sends only with `--go` after you type `GO`. Each refuses any network but mainnet (checked by genesis hash). Keys are read only from the files you name on the command line. The admin key, the upgrade authority and the treasury key never go into any `.env`.

Run the scripts from `scripts/mainnet/`: `cd scripts/mainnet && pnpm exec tsx <script>.ts …`.

### Before you start: your decisions (answered Nov 13)

1. **Program address:** keep `AcTtHioeudEDQuaW6WaL5auXC2rv3jPNoNbPxPB7pHM9`. Its keypair is `target/deploy/samite_escrow-keypair.json`: gitignored, never committed. Keep a backup of it.
2. **Upgrade authority = first admin:** a new keypair file of yours. `initialize_config` must be signed by the program's upgrade authority, which becomes the admin. Moving both to a Squads multisig comes after the launch checks. I prepare those steps: `solana program set-upgrade-authority` for the program, then `propose_admin` followed by `accept_admin` from Squads.
3. **Treasury owner:** `9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM`, your wallet. `initialize-config.ts` creates its USDC account if missing.
4. **USDC:** check `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` on Circle's page (https://developers.circle.com/stablecoins/usdc-contract-addresses). Mainnet itself confirms it is SPL Token with 6 decimals, and the init script checks that again.
5. **The program review's open items:** decided (`docs/PROGRAM-REVIEW.md`, "Decided (Nov 13)"). Every claim now lapses, there is no claim bond in v1, and `Proven` stays a hint.

### Rehearse first (local validator, no money)

```
pnpm --filter @samite/local run up --no-config        # a fresh local chain with no Config yet
cd scripts/mainnet
pnpm exec tsx initialize-config.ts --rehearse-local --rpc http://127.0.0.1:8899 \
  --authority ../../.data/local/keys/authority.json --treasury-owner <treasury address printed by up> --go
pnpm exec tsx first-job.ts --rehearse-local --rpc http://127.0.0.1:8899 \
  --poster ../../.data/local/keys/poster.json --machine ../../.data/local/keys/machine2.json --reward 1 --go
```

`--rehearse-local` accepts only `http://127.0.0.1:8899`, and refuses if that URL answers with mainnet's genesis.

I ran this on Nov 12. Config was created; the first job ran post → claim → deliver → accept; the machine got +0.975 USDC and the treasury +0.025 USDC (exactly 2.5%); the worker's index showed the job `paid`.

### 1. Build

`anchor build` from the repo root. Note the `.so`'s sha256: `deploy-program.ts` prints it, and it should match the build you reviewed. On Nov 13 the source (with every claim lapsing) built to `5f13ba8b…077ec` (459,328 bytes), the same on two separate builds (after `cargo fmt`: Anchor errors carry their source line, so reformatting changes the hash; it was `57eb46de…e7d00` before). The Nov 12 build was `39fd505a…0b609`.

### 2. Deploy the program

```
pnpm exec tsx deploy-program.ts --rpc <mainnet RPC> --authority <upgrade-authority.json> \
  --program-keypair ../../target/deploy/samite_escrow-keypair.json [--cu-price <micro-lamports>]
```

- **Dry run with a no-funds key on Nov 12:**
  - program data rent: 2.334 SOL, locked while the program exists;
  - buffer: 2.334 SOL while it runs, then returned;
  - fees: about 0.0023 SOL for 460 write transactions;
  - the authority needs about 4.67 SOL at the peak.
- **Program size:** the program is deployed at its exact size. A later, bigger upgrade extends the account automatically (Solana CLI ≥ 2.x; the script checks), paying only the difference.
- **`--cu-price`** adds a priority fee if writes don't land.
- **If it fails halfway:** `solana program close --buffers` returns the buffer's rent.

### 3. Initialize the config

```
pnpm exec tsx initialize-config.ts --rpc <mainnet RPC> --authority <upgrade-authority.json> --treasury-owner <address>
```

- **One transaction.** It creates the treasury's USDC account if missing, then runs `initialize_config`: fee 250 bps, minimum reward 1 USDC, the signer as admin.
- **Cost:** about 0.00216 SOL, plus about 0.00204 SOL if the treasury's USDC account doesn't exist yet.

### 4. Index it

Run the worker against mainnet with the keeper off: on Railway (section "Worker on Railway", with `SAMITE_PROGRAM_ID` set), or on your machine with your own Postgres and RPC. It migrates the database on start:

```
DATABASE_URL=<postgres URL> SOLANA_RPC_URL=<mainnet RPC> pnpm --filter @samite/worker start
```

`GET http://localhost:8787/health` reports the last indexed slot. In production the worker also needs the web app's `R2_*` keys: it deletes delivered files 90 days after their job closes. This can run on your machine for M5. Production hosting (Fly.io or Railway, next to the database) is a later step.

### 5. The first job

```
pnpm exec tsx first-job.ts --rpc <mainnet RPC> --poster <poster.json> --machine <second-wallet.json> --reward 1
```

- **Four transactions:** post, claim, deliver and accept, with 1–5 USDC.
- **Net cost:** the 2.5% fee, about 0.00002 SOL in fees, and the machine's one-time record rent of about 0.0013 SOL. The machine also pays about 0.002 SOL for its USDC account if it has none.
- **The script checks the money.** The machine must get exactly 97.5% and the treasury exactly 2.5%; it stops loudly otherwise.
- **Accept M5 when:**
  - both checks say ✓;
  - the worker's database shows the job `paid` (`select display_no, status from jobs`).

  The job stays hidden on the board, because its spec isn't stored through the API. Its money rules are unchanged.

### 6. The keeper (a separate "go")

- **What it sends.** Once on, the worker sends `release_after_review`, `refund_after_deadline` and `expire_claim` by itself, every minute, from the keeper key. Each costs 0.000005 SOL.
- **What it can't do.** It never pays rent and has no authority over anything.

To turn it on:

1. `solana-keygen new -o keeper.json` (a new key, only for this), and fund it with at most 0.5 SOL.
2. `pnpm exec tsx keeper-secret.ts keeper.json` prints `KEEPER_SECRET`.
3. Railway → the worker's **Variables**: set `KEEPER_SECRET` to what step 2 printed and `KEEPER_ENABLED` to `true`; Railway redeploys. The logs then show `"keeper on"` with the keeper's address.
