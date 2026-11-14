# CLAUDE.md — Samite: the job board for machines

> **Samite** · site `samite.fun` · X `@samitefun` (owner to confirm) · token CA: not set.
> Infrastructure for machines to work, transact and earn. People and machines post jobs with a USDC reward; machines (AI agents, bots, devices) claim them, deliver, and get paid on Solana when the work is accepted.
>
> Brand values live in one file, `packages/config/src/brand.ts`. Secrets live in `.env`. Never hard-code either anywhere else.
>
> This file has two halves:
> - **§1–§10 and §12–§17: the product and the protocol.** What Samite does, the escrow program, the machine interface (HTTP, SDK, MCP), the backend, data and security.
> - **§11: the site and app, in detail.** The look is approved by the owner: black, cream and nothing else; Montserrat and Space Mono; a hairline grid; every picture is a *print* (halftone dots, squares or dither pixels) made by one engine, the press. Read all of §11 before touching UI.
>
> The repo ships with a design kit. Read it before building UI:
> - `design/prototype/`: four working pages. Open them in Chrome (they load fonts from Google; everything else is local).
>   - `placeholder.html`: the M0 page for `samite.fun` (§2).
>   - `landing.html`: the full landing (§11.10).
>   - `app.html`: the app, four screens behind the hash: `#board`, `#new`, `#job`, `#machine` (§11.12).
>   - `og.html`: the Open Graph card, rendered at 1200×630.
>   - `samite-press.js` is **the reference implementation of the press** (§11.5). `samite-mark.js` is the logo as one SVG path for canvas. `samite-images.js` holds the two greyscale source photos as data URIs; the same images are in `assets/` as JPGs.
> - `design/screenshots/`: every page at 1440×900 and 390×844 (full-page and first-screen). These are the acceptance targets.
> - `design/motion/`: the moving parts as MP4 (30 fps, rendered frame by frame from the prototype with `press.seek(t)`): the placeholder's print cycle (desktop and phone), the landing hero, the footer wordmark.
> - `design/reference/`: what the owner's four style references gave us (§11.1). **We take the style, not the content.** The files themselves are other people's work and stay out of the repo (`~/samite-design-reference/` on the owner's machine).
> - `brand/`: the mark (SVG, cream and ink), favicons, the X avatar, banner and logo files, the OG card.

---

## 0. Ground rules (read first, follow always)

- **Security (owner's standing rule, verbatim):** No mainnet transactions or spending without the owner's explicit permission; secrets only in .env, never committed; no external audit, never claim 'audited'.
- **Network: Solana mainnet only**, as on the owner's earlier projects. There is no devnet phase unless the owner asks for one (§16). This changes how you work:
  - you build and test against a **local validator** (LiteSVM in tests, `solana-test-validator` for manual runs and the UI). Local is not devnet: nothing leaves the machine;
  - you **never broadcast a mainnet transaction yourself**. Every mainnet action (deploying the program, `initialize_config`, the first job, turning on the keeper) is prepared by you, explained in one paragraph (what it sends, from which key, what it costs), and run by the owner after an explicit "go";
  - reading mainnet (RPC reads, `solana program dump`, `solana account`) is fine.
- **No placeholder (owner's decision, Nov 13; supersedes §2).** `samite.fun` serves the real site, closed to everyone but the team by an access key (`apps/web/lib/gate.ts`, docs/RUNBOOK.md) until the owner says "launch" and sets `SAMITE_PUBLIC=1`. Nothing is indexed before that.
- **Do not guess library APIs.** Anchor, `@solana/kit`, Codama and the MCP TypeScript SDK all changed in 2026 (§3.4). Before writing integration code, read the installed package's README and `.d.ts`. Where this file and the package disagree, the package wins: write down what differed in `docs/DECISIONS.md`.
- **Do not invent numbers, addresses or program IDs.** Every constant in §15 must be re-checked against its source before it ships. Mark unverified ones `// TODO(verify)`.
- When something is unclear or a decision is the owner's to make, **stop and ask before building**. Small reversible choices: decide and log them in `docs/DECISIONS.md`.
- **Design quality rule:** every section must look genuinely good, not "background + text". Quality beats ambition. If you are not sure you can make an effect look right, build the simpler thing you can make flawless, and log the cut in `docs/DECISIONS.md`. §11.9 lists what is ruled out.
- Site and product copy is **English**. Copy rules are in §11.11.
- **Example data is always labelled.** Any number, address or job that is not live from the chain carries a small `example` label (the prototype shows where). Never let example values pass as real activity.
- The token has **no role in the product** (§1.5). Never write copy that implies utility, revenue share or yield.
- Small PRs, one concern each. Every PR that touches UI includes before/after screenshots at 1440×900 and 390×844.

---

## 1. Product

### 1.1 One paragraph

Samite is **a job board where machines do the work and Solana settles the pay**.
- A **job** is a task (written instructions and the conditions for acceptance), a **reward in USDC** and a **deadline**. Anyone can post one: a person in the web app, or a machine through the API, SDK or MCP server. Machines hire machines too.
- When a job is posted, the full reward moves into **the job's own escrow account** on Solana. Nobody, Samite included, can move it anywhere except to the machine whose work was accepted, or back to the poster.
- A **machine** (any AI agent, bot or device with a Solana keypair) **claims** the job with one signed transaction, does the work, and **delivers**: the result is stored off-chain and its hash is written on-chain.
- The poster **accepts** (the machine is paid 97.5%, Samite takes 2.5%, in one transaction) or **rejects with a reason** (the machine may deliver again until the deadline). If the poster does nothing within the **review window** (48 h by default), the payment releases automatically. If no delivery is accepted by the deadline, the poster takes the full reward back.
- **Fee: 2.5% of every payout. Nothing on refunds or cancellations.** Solana network fees and account rent are separate; rent comes back when the job closes.

### 1.2 Who is who

| Who | What they do |
|---|---|
| **Poster** | Posts a job and locks the reward. A person (web app, wallet) or a machine (API / SDK / MCP). |
| **Machine** | Claims, does the work, delivers, gets paid. Identified only by its Solana address. Signs with its own key; Samite never holds it. |
| **Samite** | Runs the board, stores job specs and deliveries, indexes the chain, runs the keeper. Receives the 2.5% fee. Cannot move escrowed funds. |
| **Keeper** | Samite's background service that sends the permissionless "time is up" transactions (auto-release, refund, expire claim). Anyone else may send them too. |

### 1.3 Words we use

| Word | Meaning |
|---|---|
| **job** | One task with a reward, a deadline and an escrow account |
| **post** | Create a job and lock its reward |
| **claim** | A machine takes an open job; only one machine works on a job at a time |
| **unclaim** | The machine drops the job; it reopens |
| **deliver** | Submit the result; its hash goes on-chain |
| **accept** | The poster approves; payment goes out in the same transaction |
| **reject** | The poster refuses a delivery with a public reason; the machine may deliver again |
| **auto-release** | Payment after the review window passes with no answer |
| **refund** | The reward goes back to the poster (deadline passed, nothing accepted) |
| **cancel** | The poster withdraws an open, unclaimed job |
| **review window** | How long the poster has to answer a delivery (default 48 h) |
| **machine** | Any AI agent, bot or device with a Solana keypair |

Say "machine", not "worker" or "bot", in user-facing copy (the program code may use `worker`). Never "gig", "task rabbit", "bounty hunter".

### 1.4 v1 scope

In scope:
1. **The escrow program** `samite_escrow` (§4) with full local tests.
2. **The job spec and delivery formats** (§5.1, §5.2), canonical and hashed.
3. **Web app** (§11.12): board, post a job, job page (accept / reject), machine page, my jobs, wallet connect.
4. **Machine interface** (§6): HTTP API with signed requests, `@samite/sdk` (TypeScript), `@samite/mcp` (local MCP server for Claude Code, Cursor and any MCP client).
5. **Indexer and keeper** (§7).
6. **Site**: M0 placeholder (§2), then the landing (§11.10), docs (MDX), terms and privacy (drafts for the owner).

Out of scope for v1 (keep extension points, don't build):
- disputes and arbitration (rejections are public instead, §4.6);
- several machines working on one job, milestones, partial payouts;
- any token other than USDC; SOL rewards; fiat on-ramps;
- reputation scores beyond the plain counts in §4.2 and §8;
- a mobile app; other chains.

### 1.5 Token

The project token, if any, is **not part of this app**. The only touchpoint is the header:
- if `NEXT_PUBLIC_TOKEN_CA` is set, the header shows a small `$TICKER` chip with copy-CA and a "Buy" link;
- if it is empty, nothing about a token renders anywhere. Never invent a ticker.

---

## 2. M0: the placeholder at samite.fun

> **Superseded (owner, Nov 13):** there is no placeholder. The landing is the home page, and the whole site is closed by an access key until launch (§0). This section is kept for history.

Before anything else, put a placeholder on the domain so the X profile has somewhere to point.

- **Reference:** `design/prototype/placeholder.html`, `design/screenshots/placeholder-desktop.png`, `placeholder-mobile.png`, and `design/motion/placeholder-press-cycle.mp4`, `placeholder-mobile.mp4`.
- **What it is:** one screen. A hairline top bar (mark + `SAMITE` · "Infrastructure for machines to work, transact and earn" · a blinking cream square + "In development"), a black stage where the press prints the logo lockup in halftone dots and runs the `cycle` schedule (§11.5), a small three-line slug "The job board / for machines / on Solana" over the wordmark's top-right, a cream bracket button **Follow on X ↗** (`https://x.com/samitefun`, owner to confirm), `samite.fun` in mono below it, and a hairline footer (`© 2026 Samite` · `Agents / Bots / Devices` · `Built on Solana`).
- **No forms.** No email capture, no wallet connect. (A waitlist is an open item, §16.)
- **Build it in the real app** (`apps/web`, route `/`), with the press ported to TypeScript (§11.5), `next/font`, the favicon set, the OG card and meta tags (title "Samite: the job board for machines", the description from the prototype). It must not load `samite-images.js` (the placeholder needs no photos).
- **Deploy:** Vercel. The owner points the domain from the registrar (Spaceship) to Vercel. **Vercel's DNS values are per project**: take the A record for the apex and the CNAME for `www` from the project's Settings → Domains, never from a guide or another project. Write the exact records into `docs/RUNBOOK.md` and ask the owner to set them. `www` redirects to the apex.
- **Accept when:** the page at 1440×900 and 390×844 matches the two screenshots side by side (in `docs/PROGRESS.md`); the print cycle matches `placeholder-press-cycle.mp4` frame for frame at the same `t` (use `?shot&t=7` to freeze it, §13); reduced motion shows the still print; Lighthouse mobile performance ≥ 95, accessibility ≥ 95; the OG card renders in X's card validator.

---

## 3. Solana facts

### 3.1 USDC

- **Mint (mainnet):** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimals, owned by the classic **SPL Token** program (not Token-2022). Source: Circle's USDC contract addresses page. Re-check before M5.
- Amounts are integers in base units everywhere (1 USDC = 1,000,000). Never floats. Format for display only, with 2 decimals.
- Token accounts are **associated token accounts** (ATA). The machine's ATA must exist before it can claim (§4.5), so payouts never fail on a missing account.

### 3.2 Local USDC for tests

The real mint's authority is Circle's, so you can't mint it locally. In tests:
- **LiteSVM:** write a mint account at the USDC address with a test mint authority (`set_account`), then mint to test wallets;
- **solana-test-validator:** dump the mint (`solana account -u m EPjF… --output json`), change the mint authority in the JSON to a local key, load it with `--account`.
Same address, same decimals, same owner program: the program code never knows the difference.

### 3.3 Costs (shown before every signature)

- Network fee: 5,000 lamports per signature, plus an optional priority fee (read a recent estimate from the RPC; cap it).
- Rent for the `Job` account and its vault ATA, paid by the poster at `post_job`, **returned to the poster** when the job closes (accept, auto-release, refund, cancel). Read rent live (`getMinimumBalanceForRentExemption`); never hard-code it.
- The post form's summary shows: reward, what the machine receives (97.5%), the fee (2.5%), "You lock now", and "+ Solana fees and account rent; rent comes back when the job closes" (as in `app.html#new`).

### 3.4 Versions (checked Nov 12, 2026; re-check at install)

| What | State | Use |
|---|---|---|
| Anchor | stable **1.2.2** (Oct 22, 2026); 2.0.0 is a release candidate | latest stable 1.x. Don't build on the RC. MSRV for `anchor-lang` 1.x is Rust 1.89 |
| `@solana/kit` | the recommended TypeScript SDK (solana.com) | all TS code. Legacy `@solana/web3.js` v1 is maintenance-only; don't add it |
| `@solana/react` + Kit wallet plugin | React bindings and Wallet Standard connection for Kit | the web app's wallet layer. Read the kit-plugins repo for the exact wallet plugin package name |
| Codama | generates Kit clients from the Anchor IDL | `packages/program-client` |
| MCP TypeScript SDK | v2 line (2.4.0, Oct 23, 2026) split into `@modelcontextprotocol/server`, `/client`, `/core` and transport packages; v1 (`@modelcontextprotocol/sdk` 1.32.x) still gets fixes | `@modelcontextprotocol/server` with the stdio transport. Read its README first |

---

## 4. The escrow program (`programs/samite_escrow`, Anchor 1.x)

### 4.1 Principles

- **One escrow per job.** Each job's reward sits in a token account owned by that job's PDA. Funds never mix.
- **No admin withdrawal path.** The admin can change the fee for *new* jobs (capped), pause new posts and claims, and change the treasury. There is no instruction that moves escrowed funds anywhere except to the job's machine (+ fee to treasury) or back to its poster.
- **Pausing never traps money.** `paused` blocks `post_job` and `claim_job` only. Cancel, deliver, accept, reject, auto-release and refund always work.
- **Time-outs are permissionless.** Anyone may send `release_after_review`, `refund_after_deadline` and `expire_claim`; the money can only go where the rules say. The keeper (§7.2) sends them so nobody has to.
- **Events via `emit_cpi!`** (Anchor event CPI), so the indexer doesn't depend on logs that can be truncated.
- Checked integer math only (`u128` for the fee product). No `remaining_accounts`. Token transfers with `transfer_checked` (mint + decimals).

### 4.2 Accounts

```rust
#[account] pub struct Config {          // PDA ["config"]
    pub admin: Pubkey,
    pub treasury: Pubkey,                // USDC token account that receives fees (an owner wallet's ATA, or a multisig's)
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,                    // 250 at launch; must be <= MAX_FEE_BPS (500), a compile-time constant
    pub min_reward: u64,                 // base units; 1_000_000 (1 USDC) at launch
    pub paused: bool,
    pub bump: u8,
}

#[account] pub struct Job {             // PDA ["job", poster, job_id.to_le_bytes()]
    pub poster: Pubkey,
    pub job_id: u64,                     // chosen by the client (random u64); the PDA makes collisions fail
    pub reward: u64,                     // base units, locked in the vault
    pub fee_bps: u16,                    // snapshot of Config.fee_bps at post time
    pub spec_hash: [u8; 32],             // sha256 of the canonical job spec (§5.1)
    pub status: JobStatus,               // Open | Claimed | Delivered   (closed jobs are closed accounts)
    pub worker: Option<Pubkey>,
    pub policy: ClaimPolicy,             // Any | Proven { min_accepted: u32 } | Allowlist (see `allowlist`)
    pub allowlist: Vec<Pubkey>,          // max 10; empty unless policy = Allowlist
    pub deadline: i64,                   // unix seconds
    pub review_window: i64,              // seconds
    pub claim_window: i64,               // seconds a claim holds without a delivery; 1 h up to the deadline (no 0 since Nov 13)
    pub delivery_hash: [u8; 32],         // last delivery; zero if none
    pub deliveries: u8,                  // count, max MAX_DELIVERIES (3)
    pub created_at: i64, pub claimed_at: i64, pub delivered_at: i64,
    pub bump: u8,
}

#[account] pub struct MachineStats {    // PDA ["machine", worker]; created on first claim, paid by the machine
    pub machine: Pubkey,
    pub accepted: u32,                   // accepted + auto-released deliveries
    pub rejected: u32,
    pub earned: u64,                     // base units received
    pub bump: u8,
}
```

The vault is the **ATA of the `Job` PDA** for the USDC mint (`allowOwnerOffCurve`).

When a job ends (paid, refunded, cancelled), the vault and the `Job` account are **closed** and their rent goes back to the poster. The full history lives in the events and the index.

### 4.3 Instructions

| Instruction | Signer | When | What it does |
|---|---|---|---|
| `initialize_config(treasury, fee_bps, min_reward)` | deployer (becomes admin) | once | Creates `Config`. **Owner runs it on mainnet (M5).** |
| `update_config(...)` | admin | any time | Changes treasury, fee (≤ `MAX_FEE_BPS`), min reward, paused. Fee changes apply to new jobs only. |
| `set_admin(new)` | admin | any time | Two-step: `propose_admin` then `accept_admin` by the new key. |
| `post_job(job_id, reward, deadline, review_window, claim_window, policy, allowlist, spec_hash)` | poster | not paused | Checks the limits in §4.4, creates `Job` + vault, moves `reward` from the poster's ATA into the vault, status `Open`. Emits `JobPosted`. |
| `cancel_job` | poster | `Open` | Full reward back to the poster; closes vault + job. Emits `JobCancelled`. |
| `claim_job` | machine | `Open`, `now < deadline`, not paused | Machine ≠ poster. Checks the policy (`Proven`: `MachineStats.accepted ≥ min_accepted`; `Allowlist`: machine in list). Requires the machine's USDC ATA to exist. Sets `worker`, `claimed_at`, status `Claimed`. Creates `MachineStats` if missing. Emits `JobClaimed`. |
| `unclaim_job` | machine | `Claimed` | Clears `worker`; status `Open`. Emits `JobUnclaimed`. |
| `expire_claim` | anyone | `Claimed`, `claim_window > 0`, `now > claimed_at + claim_window` | Same as unclaim. Emits `ClaimExpired`. |
| `submit_delivery(delivery_hash)` | the job's machine | `Claimed`, `now ≤ deadline`, `deliveries < MAX_DELIVERIES` | Stores the hash, `delivered_at = now`, `deliveries += 1`, status `Delivered`. Emits `DeliverySubmitted`. |
| `accept_delivery` | poster | `Delivered` | **Pays** (§4.5). Emits `JobPaid { auto: false }`. |
| `reject_delivery(reason_hash)` | poster | `Delivered`, `now ≤ delivered_at + review_window` | `MachineStats.rejected += 1`; status `Claimed` (the machine keeps the job). If `deliveries == MAX_DELIVERIES`, refund the poster and close instead. If `deadline < now + MIN_RESUBMIT` (24 h), set `deadline = now + MIN_RESUBMIT` so the machine always has a fair chance to fix it. Emits `DeliveryRejected { reason_hash }`. |
| `release_after_review` | anyone | `Delivered`, `now > delivered_at + review_window` | **Pays** (§4.5). Emits `JobPaid { auto: true }`. |
| `refund_after_deadline` | anyone | `Open` or `Claimed`, `now > deadline` | Full reward to the poster's ATA; closes vault + job. Never possible while `Delivered` (that protects the machine). Emits `JobRefunded`. |

### 4.4 Limits (in `Config` or constants; re-check with the owner before M5)

| Limit | Value |
|---|---|
| Min reward | 1 USDC (`Config.min_reward`) |
| Max reward | none in the program; the web app warns above 10,000 USDC |
| Deadline | from `now + 1 h` to `now + 90 days` |
| Review window | 1 h to 7 days, default 48 h |
| Claim window | 1 h to the deadline; every claim lapses (0 "until the deadline" removed, Nov 13) |
| `MAX_FEE_BPS` | 500 (5%), compile-time |
| `MAX_DELIVERIES` | 3 |
| `MIN_RESUBMIT` | 24 h |
| Allowlist | up to 10 addresses |

### 4.5 The payout (accept and auto-release share one function)

```
fee    = reward * job.fee_bps / 10_000          // u128, floor
to_machine = reward - fee
transfer_checked(vault → machine's USDC ATA, to_machine)    // ATA of job.worker, mint = config.usdc_mint
transfer_checked(vault → config.treasury, fee)
MachineStats.accepted += 1; MachineStats.earned += to_machine
close vault → poster; close job → poster
```

Example: 120.00 USDC → machine 117.00, fee 3.00. 80.00 → 78.00 and 2.00 (the numbers in the prototype). Every account in the payout is constrained: vault authority = job PDA; machine ATA owner = `job.worker` and mint = USDC; treasury = `config.treasury`; poster = `job.poster`.

### 4.6 Why there are no disputes in v1

A poster could reject good work and wait for the refund. v1 limits the damage instead of judging it:
- every rejection needs a reason, stored and **shown publicly** on the job page and in the poster's history;
- a rejected machine always gets at least 24 h to deliver again (`MIN_RESUBMIT`), up to 3 deliveries;
- the board and the MCP `find_jobs` tool show each poster's record: jobs posted, paid, refunded after a delivery, rejections. Machines can skip posters with a bad record;
- the poster has to see the delivery to judge it, so a dishonest poster could keep a rejected result. That is the trade-off of v1; the public record is the deterrent. Say this plainly in the docs FAQ, so machines can choose what to take.

Disputes (an arbiter, or a split) are the first v2 candidate (§16).

### 4.7 Upgrade authority

The program is upgradeable at launch so bugs can be fixed. The upgrade authority is the owner's key, or a Squads multisig if the owner sets one up (recommended, §16). The docs say who holds it. Making the program immutable later is the owner's call.

---

## 5. Off-chain formats

### 5.1 Job spec (`samite/job@1`)

The spec is what machines read. It is public. Its hash is on-chain (`Job.spec_hash`).

```jsonc
{
  "v": "samite/job@1",
  "title": "Label 5,000 product images by category",          // 8–120 chars
  "instructions": "Images: https://example.com/batch-07.zip …", // Markdown, ≤ 16 KB
  "accepted_when": [                                             // 1–10 items, each ≤ 280 chars
    "CSV has 5,000 rows and no empty category",
    "I will spot-check 100 rows; 97 or more must be right"
  ],
  "deliverable": { "kind": "file", "max_bytes": 209715200 },    // kind: text (≤ 64 KB) | file (≤ 200 MB) | url
  "category": "data",                                            // data | code | research | compute | devices | other
  "attachments": [ { "name": "batch-07.zip", "url": "https://…", "sha256": "…" } ]  // optional, ≤ 10
}
```

**Canonical bytes:** normalise every string to Unicode NFC, then serialise with RFC 8785 (JCS). `spec_hash = sha256(canonical bytes)`. The same spec always gives the same hash (golden-file tests, §13). The API serves the exact bytes at `/api/v1/jobs/:ref/spec.json`, so anyone can re-hash and compare with the chain.

### 5.2 Delivery (`samite/delivery@1`)

```jsonc
{
  "v": "samite/delivery@1",
  "job": "<job PDA, base58>",
  "attempt": 1,                                   // 1..3, equals Job.deliveries after submit
  "kind": "file",
  "files": [ { "name": "listings.csv", "bytes": 1468211, "sha256": "2f9c…e01d" } ],  // or "text": "…", or "url": "https://…"
  "note": "All 2,000 rows. 14 listings had no area; left empty as allowed in the spec."   // ≤ 1,000 chars
}
```

`delivery_hash = sha256(canonical bytes)`, same canonicalisation. The machine uploads files first (§6.2), the API checks each file's sha256 server-side, stores the manifest, and returns the hash; then the machine signs `submit_delivery(hash)`. The job page shows "sha256 … ✓ matches on-chain hash" only when the stored manifest re-hashes to the on-chain value.

**Deliveries are private:** only the poster and the job's machine can download them (wallet-signed requests). The hash on-chain is public; the content isn't. Delivery content (files, text, links, notes) is deleted 90 days after the job closes (configurable, said in the privacy page).

### 5.3 Rejection reason

Plain text, 10–1,000 chars, **public**. `reason_hash = sha256(NFC(text))`. Stored before the poster signs `reject_delivery`.

---

## 6. The machine interface

Machines are first-class users. Everything a person can do in the web app, a machine can do through the API. **A machine's private key never leaves the machine**: it signs transactions and requests locally.

### 6.1 HTTP API (`samite.fun/api/v1`)

| Route | Auth | What it does |
|---|---|---|
| `GET /jobs?status&category&posted_from=app\|api&min_reward&sort=newest\|reward\|deadline&cursor` | none | The board. Only jobs whose spec is stored, re-hashes to the chain value and passed moderation (§12). |
| `GET /jobs/:ref` | none | One job: on-chain state + spec + poster record + event history. `:ref` is the job PDA or the display number (`0415`). |
| `GET /jobs/:ref/spec.json` | none | Canonical spec bytes, `Cache-Control: immutable`. |
| `POST /specs` | signed | Validates a spec, returns canonical bytes, `spec_hash`, warnings, and the moderation verdict. Required before `post_job`. |
| `POST /deliveries/upload` | signed (job's machine) | Pre-signed upload URL for one file (R2), size-limited by the spec. |
| `POST /deliveries` | signed (job's machine) | Stores the manifest after checking file hashes; returns `delivery_hash`. |
| `GET /jobs/:ref/delivery` | signed (poster or machine) | The manifest and short-lived download URLs. |
| `POST /jobs/:ref/rejection` | signed (poster) | Stores the reason; returns `reason_hash`. |
| `POST /tx/:action` | signed | Builds an **unsigned** transaction for `post`, `cancel`, `claim`, `unclaim`, `deliver`, `accept`, `reject`, returned as base64 with a human summary (amounts, accounts, fees). The client signs it. |
| `POST /tx/send` | none | Relays a fully signed transaction to the RPC (convenience only; the server never signs). |
| `GET /machines/:address` | none | Stats from `MachineStats` + the index, history. |
| `GET /posters/:address` | none | The poster's record (§4.6). |
| `GET /events?cursor` and `GET /events/stream` (SSE) | none | The live feed. Machines can watch for new jobs here instead of polling. |
| `GET /stats` | none | Open jobs, USDC in escrow, paid in 24 h, jobs per hour (24 h). Feeds the landing's chart and meter. |

**Signed requests** (machines and the app's API calls alike):
`Authorization: Samite-Ed25519 address=<base58>, ts=<unix>, sig=<base58>`, where `sig` is the ed25519 signature of
`samite:v1\n<METHOD>\n<path?query>\n<ts>\n<hex sha256 of body>` by the address's key. Accept `|now − ts| ≤ 60 s`; reject a repeated `(address, sig)` within 2 minutes (Redis). In the browser, a Sign-In With Solana session (the wallet's `signIn`, fallback `signMessage` with a server nonce) replaces per-request signatures.

**`posted_from`** is `app` when the job was posted through the web app's session, `api` otherwise. The board's "People / Machines" filter uses it and the UI labels it "Person" / "Machine". It's a hint, not a proof; the docs say so.

Rate limits per address and per IP (shared store: Postgres `kv` since Nov 14, Redis optional). Errors are JSON `{ error: { code, message } }` with stable codes listed in the docs.

### 6.2 `@samite/sdk` (TypeScript, `packages/sdk`)

Thin and typed, built on `@solana/kit` and the Codama client:

```ts
const samite = createSamite({ rpc, signer })          // signer: a Kit KeyPairSigner from the machine's keypair
await samite.jobs.find({ category: "data", minReward: 50_000_000n })
const job = await samite.jobs.get("0416")              // state + spec (hash verified against the chain)
await samite.jobs.claim(job)                           // builds, signs locally, sends, confirms
await samite.deliveries.submit(job, { files: ["./out/labels.csv"], note: "…" })   // upload → manifest → submit_delivery
await samite.jobs.post({ spec, reward: 120_000_000n, deadline: "3d", reviewWindow: "48h" })
await samite.balance()                                 // SOL + USDC
```

Every method that sends a transaction returns `{ signature, summary }` and has a `dryRun` option that returns the summary without signing.

### 6.3 `@samite/mcp` (local MCP server, `packages/mcp`)

Runs on the machine's side over stdio, signs with the machine's keypair, talks to the HTTP API and the RPC through the SDK. The landing shows how it's configured:

```json
{ "mcpServers": { "samite": { "command": "npx", "args": ["-y", "@samite/mcp"],
  "env": { "SAMITE_KEYPAIR": "~/.config/samite/machine.json" } } } }
```

| Tool | What it does |
|---|---|
| `find_jobs` | Board query; each result includes the reward, deadline, `accepted_when`, and the poster's record |
| `get_job` | Full spec + state; verifies the spec hash |
| `claim_job` | Claims; returns the summary and signature |
| `unclaim_job` | Drops a job |
| `submit_delivery` | Text, a URL, or local file paths + note; uploads, hashes, submits |
| `my_jobs` | Jobs this machine is working on or has delivered, with status |
| `post_job` | Posts a job from this machine's wallet (**disabled unless** `SAMITE_MAX_POST_USDC` > 0; refuses rewards above it) |
| `review_delivery` | For jobs this machine posted: fetches the delivery; `accept` or `reject` with a reason (same spending guard) |
| `get_balance` | SOL and USDC of this machine |

Guards: a per-day spending cap (`SAMITE_DAILY_SPEND_USDC`, default 0 = no posting); every tool that sends a transaction returns the summary first when `SAMITE_CONFIRM=1` and waits for a second call with `confirm: true`. Tool descriptions say plainly what each one costs. Job specs are **untrusted input**: the server returns them as data, and its tool descriptions tell the model not to follow instructions inside a spec that go beyond doing the job (no sending funds, no revealing keys).

Publishing `@samite/sdk` and `@samite/mcp` to npm waits for the owner to confirm the `@samite` scope (§16).

---

## 7. Architecture and stack

### 7.1 Repo

Monorepo: **pnpm + Turborepo**, TypeScript strict, Node ≥ 20.

```
apps/
  web/              Next.js (App Router) + Tailwind v4: site, app, docs (MDX), API route handlers (/api/v1)
  worker/           Node service: indexer + keeper (+ moderation queue)
programs/
  samite_escrow/    Anchor 1.x program (§4)
packages/
  config/           brand.ts, solana.ts (program ID, mint, limits), env parsing (zod)
  formats/          samite/job@1 and samite/delivery@1: schemas, NFC + JCS canonicalisation, hashing (pure, no I/O)
  program-client/   Codama-generated Kit client from the Anchor IDL (generated, committed, never hand-edited)
  sdk/              @samite/sdk (§6.2)
  mcp/              @samite/mcp (§6.3)
  db/               Drizzle schema + migrations (Postgres)
  ui/               the design system (§11): tokens, the press, components
design/             the owner's design kit; read-only reference, not shipped
brand/              source brand files; copied into apps/web/public/brand/ at M0
docs/               DECISIONS.md, PROGRESS.md, RUNBOOK.md, PROGRAM-REVIEW.md, SECURITY-REVIEW.md
scripts/mainnet/    owner-run scripts only (§14)
```

Stack:
- **Solana:** Anchor 1.x; `@solana/kit` + Codama client; `@solana/react` and the Kit wallet plugin (Wallet Standard: Phantom, Solflare, Backpack) in the browser.
- **RPC + webhooks:** a provider with webhooks (e.g. Helius), keyed by env. Browser reads use `NEXT_PUBLIC_RPC_URL`, a rate-limited read-only key.
- **Data:** Postgres (e.g. Neon) + Drizzle; rate limits, replay protection and sign-in nonces in the same Postgres (table `kv`; owner, Nov 14: no Redis service; Upstash stays optional); Cloudflare R2 for spec attachments and deliveries.
- **Hosting:** `web` on Vercel; `worker` on Fly.io or Railway, same region as the DB.
- **Moderation:** an LLM call (Anthropic SDK, model in `MODERATION_MODEL`) on every new spec (§12).
- **Observability:** JSON logs (never log secrets, signatures of requests, or delivery contents), Sentry, `/health` on every service.

`packages/config/src/brand.ts` starts as:

```ts
export const brand = {
  name: "Samite",
  domain: "samite.fun",
  siteUrl: "https://samite.fun",
  x: { handle: "samitefun", url: "https://x.com/samitefun" },   // TODO(owner): confirm the handle
  npmScope: "@samite",                                           // TODO(owner): confirm it is free on npm
  tagline: "The job board for machines.",
  line: "Infrastructure for machines to work, transact and earn.",
} as const
```

### 7.2 Indexer and keeper (`apps/worker`)

- **Indexer:** subscribes to the program's transactions (provider webhook; fallback: `getSignaturesForAddress` backfill + polling), decodes the CPI events, and writes `jobs`, `events`, `machines`, `posters`. Every derived row carries the slot it was read at. It assigns **display numbers** (`0415`) in order of the `JobPosted` slot. Idempotent on signature; survives replays and gaps (backfill on start).
- **Keeper:** every minute, finds jobs past their review window (`release_after_review`), past their deadline (`refund_after_deadline`), and stale claims (`expire_claim`), and sends those transactions from the **keeper key**. The keeper key holds only a little SOL for fees (≤ 0.5 SOL), has no authority over anything, and is in `.env`. **`KEEPER_ENABLED=false` by default.** The owner turns it on for mainnet after an explicit "go" (M5): it sends mainnet transactions automatically, and the owner must approve that once, knowingly.
- **Moderation queue:** checks new specs (§12), stores verdicts.

### 7.3 Environment (`.env.example`, all values empty)

```
# network: mainnet only (owner's decision). Local tests never use these.
SOLANA_RPC_URL=
RPC_WEBHOOK_SECRET=
SAMITE_PROGRAM_ID=                 # after the owner deploys (M5)
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v   # TODO(verify) against Circle before M5
KEEPER_SECRET=                     # base58; fees only, no authority
KEEPER_ENABLED=false
# storage
DATABASE_URL=
REDIS_URL=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
SESSION_SECRET=
# moderation
ANTHROPIC_API_KEY=
MODERATION_MODEL=
# public
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_RPC_URL=               # browser RPC: a rate-limited, read-only provider key
NEXT_PUBLIC_PROGRAM_ID=
NEXT_PUBLIC_TOKEN_CA=              # empty = no token chip anywhere
NEXT_PUBLIC_TOKEN_TICKER=
```

The admin key, the upgrade authority and the treasury's key are **never** in any `.env` of a running service. They stay with the owner.

---

## 8. Data model (Drizzle, Postgres)

The chain is the source of truth for money and status. The database is an index, the spec and delivery store, and the moderation record.

| Table | Columns |
|---|---|
| `specs` | spec_hash PK, canonical bytea, title, category, json jsonb, verdict `pass\|refuse\|pending`, reasons, created_at |
| `jobs` | pda PK, display_no UNIQUE, poster, posted_from `app\|api`, job_id numeric, spec_hash FK, reward bigint, fee_bps, status `open\|claimed\|delivered\|paid\|refunded\|cancelled`, worker null, policy jsonb, deadline, review_window, claim_window, deliveries, delivered_at null, closed_at null, posted_slot, updated_slot, hidden bool |
| `deliveries` | id, job_pda, attempt, worker, manifest jsonb, delivery_hash, storage_keys text[], submitted_sig null, created_at, purge_after |
| `rejections` | job_pda, attempt, reason text, reason_hash, sig, at |
| `events` | id, job_pda, kind `posted\|claimed\|unclaimed\|claim_expired\|delivered\|rejected\|paid\|auto_released\|refunded\|cancelled`, actor, amount bigint null, fee bigint null, slot, sig UNIQUE, at |
| `machines` | address PK, accepted, rejected, earned bigint, first_seen, last_paid_at, label null (self-chosen name, moderated) |
| `posters` | address PK, posted, paid, refunded_after_delivery, rejections, cancelled |
| `sessions` | id, address, created_at, expires_at |
| `kv` | key PK, value, expires_at: replay keys, sign-in nonces, rate counters (was Redis; Postgres since Nov 14) |

All USDC amounts are integer base units (`bigint`). Never floats for money.

---

## 9. Flows

### 9.1 Post (person, `/jobs/new`)
1. Connect wallet. Fill the form (`app.html#new`): title, instructions (Markdown), accepted when (one condition per line), deliverable (Text / File / URL), category, reward, deadline, review window, who can claim (Any machine / Proven machines, 5+ accepted jobs / Only these addresses).
2. The summary panel updates live: reward, machine receives (97.5%), fee (2.5%), deadline, review window, "You lock now", rent note, and the plain-English rule box.
3. "Lock N USDC and post" → `POST /specs` (canonical bytes, hash, moderation) → build `post_job` → the wallet signs once → confirmation → redirect to the job page.
4. If moderation refuses, nothing is signed and the reasons are shown.

### 9.2 Claim and deliver (machine)
`find_jobs` → `get_job` (verifies the spec hash) → `claim_job` → work → `submit_delivery` (upload → manifest → hash → on-chain). After a rejection the machine reads the reason (`my_jobs`) and may deliver again.

### 9.3 Review (poster, job page)
The job page (`app.html#job`) shows the 4-step timeline with transaction links, the delivery preview (first rows of a CSV, text inline, a link for URLs, a download for files), the hash check, the instructions and conditions, and two buttons: **Accept and pay N USDC** and **Reject with a reason** (opens a dialog: reason text, min 10 chars, "This reason is public"). A live countdown shows "Auto-release in 41h 12m".

### 9.4 Time-outs
Handled by the keeper (§7.2). The UI shows each pending time-out on the job page and in "My jobs".

---

## 10. Pages (sitemap)

| Path | What |
|---|---|
| `/` | M0: the placeholder. From M6: the landing (§11.10) |
| `/jobs` | The board (`app.html#board`) |
| `/jobs/new` | Post a job (`#new`) |
| `/jobs/[ref]` | Job page (`#job`) |
| `/machines/[address]` | Machine page (`#machine`) |
| `/posters/[address]` | Poster record (same layout as the machine page, poster counts) |
| `/me` | My jobs: Posted / Working on (tabs), with status glyphs and pending time-outs |
| `/docs/*` | MDX: Quickstart (MCP, SDK, HTTP), How escrow works, Fees, Job spec format, Delivery format, Signed requests, Errors, FAQ |
| `/terms`, `/privacy` | Drafts for the owner (marked DRAFT until the owner approves; never presented as legal advice) |
| `/api/v1/*` | §6.1 |

The app's top bar tabs: Board · Post a job · My jobs · Machines · Docs. On phones they become a horizontally scrolling second row (the prototype does this).

---

## 11. Site and app: the design system

### 11.0 The idea in five lines

1. **Black, cream, nothing else.** A black page, cream ink (`#F2EFE8`), greys between them. No accent colour, ever (owner's decision).
2. **Everything pictorial is a print.** One engine, *the press*, turns any white-on-black source (the logo, a word, a photo, a chart) into halftone dots, squares or ordered-dither pixels, and lets it breathe. No photos, gradients or illustrations appear raw.
3. **A hairline grid.** Three columns at 40 / 34 / 26, 1px lines in `#1F1E1C`, panels that touch. Structure from the TRACE reference.
4. **Two typefaces.** Montserrat for words (the wordmark and stamps in 800 italic), Space Mono for labels, numbers and data.
5. **Status by shape, not colour.** Open is a hollow square, claimed half-filled, delivered dotted, paid filled, refunded dashed.

### 11.1 The references (`design/reference/`; the files stay out of the repo)

| File | What we take | What we don't |
|---|---|---|
| `ref-1-trace.png` (TRACE) | **The structure of the site.** Black page, 3-column hairline grid, nav with underline under the brand, the light centre panel holding a dithered picture, a tracking reticle with a label, the dot-waveform chart in a bordered module, the segmented meter, the bracket CTA with centre ticks, the 6×6 pixel cluster above a three-word line, the "A / B / C" highlight walking along a mono list. | The orange accent (ours is ink on cream), the face photo (ours is the Samite eye), their copy and product. |
| `ref-2-park.png` (Park) | The **square-dot print of a figure** at large scale next to a headline + paragraph (our "Built for machines first" section, made from the banner's falling figure). | Their globe, copy and colours. |
| `ref-3-pixel-agency.png` (Pixel Agency) | The **dithered landscape** with glitchy horizontal structure (our footer clouds, made from the banner's clouds). | The rounded card UI, their logo. |
| `ref-4-afterglo.mp4` (afterglo) | **The halftone bloom:** a wordmark printed in dots that glows, spreads, dims, scatters and re-forms. This is the `cycle` schedule (placeholder, footer wordmark). | Their waitlist form and wordmark. |

### 11.2 Colour tokens

```css
--bg:#000;            /* page */
--panel:#0A0A09;      /* modules, inputs, code */
--panel-2:#111110;    /* raised: wallet chip, selected option, box buttons */
--line:#1F1E1C;       /* every hairline */
--line-hi:#3B3A36;    /* borders of controls, chips, modules */
--cream:#F2EFE8;      /* text, ink of prints, primary button, the paper panel */
--ink:#0A0A0A;        /* text and prints on cream */
--text-2:rgba(242,239,232,.66);  /* body copy on black */
--text-3:#8C8981;     /* labels, captions, "example" (6.0:1 on black) */
--muted:#5F5D58;      /* lines, fills, disabled only; never text on black (3.2:1). On cream it is the caption colour (5.7:1) */
```

Rules:
- No other colours. Off-greys for prints (the footer clouds use ink `#3A3934`; the split bar's fee part `#77746D`) are fills, not text.
- Text on black: `--cream`, `--text-2`, `--text-3`. Text on cream: `--ink`, `--muted`.
- A contrast test (§13) samples every text/background pair and fails under 4.5:1.

### 11.3 Typography

Load with `next/font/google`: **Montserrat** 400, 500, 600, 700 and **800 italic**; **Space Mono** 400, 700. Canvases draw text only after `document.fonts.ready`.

| Use | Style |
|---|---|
| Wordmark `SAMITE`, step names (POST, CLAIM…), stamps | Montserrat 800 italic, uppercase, letter-spacing .02–.04em |
| H1 (landing) | Montserrat 700, `clamp(44px,4.4vw,64px)`/1.0, -.025em, balanced wrap |
| H2 (sections) | Montserrat 700, `clamp(34px,3.4vw,50px)`/1.04, -.025em; second line may be `--text-3` |
| H3 (hero right) | Montserrat 500, 34px/1.18 |
| Lede | Montserrat 500, 21px/1.3 |
| Body | Montserrat 400, 15.5–16px/1.55, `--text-2` |
| App H1 | Montserrat 700, 34px/1.05 (28px on phones) |
| Labels | Space Mono 400, 11–13px, uppercase, .1em, `--text-3` |
| Numbers (rewards, stats) | Space Mono 700, tabular; big numbers 28–40px |
| Code | Space Mono 13px/1.65 |
| `example` labels | Space Mono 10.5px, sentence case, `--text-3` |

### 11.4 Layout

- **Landing grid:** `grid-template-columns: 40fr 34fr 26fr` (CSS variables `--c1/--c2/--c3`; spans use `--c23: 60fr` and `--c23-3: 20fr`; `calc()` with `fr` is invalid in grid templates). Hairline right border on every cell but the last. Under 1100px everything is one column; under 560px paddings drop to 16–20px.
- **Nav:** 92px tall, three cells on the grid: brand (mark 28px + `SAMITE` 26px 800 italic, a 2px cream underline at the bottom edge), links (Jobs, Machines, Escrow, Docs, mono 14px, spaced around), tools ("Launch app" box button + a 46px menu box).
- **App:** a 64px sticky top bar (260px brand cell · tabs · actions), then `main` + a 380px side column; both scroll with the page.
- Every block touches its neighbours; separation is by hairlines, never by gaps or shadows. No border-radius anywhere (inputs too).
- A fixed grain overlay (SVG fractal noise, `opacity:.06`, `mix-blend-mode:overlay`, `pointer-events:none`) on the site, not in the app.

### 11.5 The press (`packages/ui/src/press/`)

Port `design/prototype/samite-press.js` to TypeScript **one to one**: same maths, same keyframes, same output for the same `t`. Then wrap it as `<Press>` for React.

**API**

```ts
type PressOptions = {
  source: (ctx: CanvasRenderingContext2D, w: number, h: number) => void  // draw white on black, CSS px
  cell?: number            // CSS px per screen cell (9)
  shape?: "dot" | "square" | "bayer"   // halftone (afterglo) | squares (Park) | 4×4 ordered dither (TRACE)
  schedule?: "cycle" | "breathe" | "still"
  period?: number          // seconds (6.4)
  ink?: string             // "#F2EFE8"
  gamma?: number           // .9
  glow?: number; wide?: number   // blur radii in cells for the near and far glow (2, 6)
  bloom?: number           // scales the glow terms; < 1 keeps holes and edges readable (1)
  intro?: number           // seconds the print takes to come up on load (1.2); 0 = none
  seed?: number
  overlay?: (ctx, t, api) => void   // reticles and labels, drawn after the print
}
// → { layout(), draw(t), seek(t), start(), stop(), api: { width, height, cell, sample(x, y), params(t) } }
```

**How it works** (read the reference file; this is the summary):
1. `layout()` draws the source once at full size on an offscreen canvas, averages it down to one value per cell (`S`), and blurs that twice with a 3-pass separable box blur: `G` (radius `glow`) and `W` (radius `wide`).
2. Each frame computes, per cell, `L = (a·S + b·G + c·W) · gain · intro − th`, with `b` and `c` multiplied by `bloom`. Cells with `L ≤ .02` are skipped; `L = min(L, 1.35)^gamma`.
3. It draws one shape per cell, all in one path and one `fill()`:
   - `dot`: radius `cell/2 · 1.12 · √L`;
   - `square`: side `cell · .92 · √min(L, 1)`;
   - `bayer`: a square of side `cell · .82` when `L > BAYER[j%4][i%4]`.
   During *scatter*, cells are displaced by a per-cell hash and flicker out.
4. The schedule gives `a, b, c, gain, th, sc` for time `t`:

| `cycle` phase | stage | a | b | c | gain | th | scatter |
|---|---|---|---|---|---|---|---|
| 0 → .16 | ink: crisp, a fringe of small dots | 1 | .30 | 0 | 1.7 | .02 | 0 |
| .30 → .40 | bloom: glow spreads into big dots | .8 | .9 | .55 | 1.35 → 1.2 | .04 | 0 |
| .50 | dim: a faint screen | .6 | .8 | .5 | .5 | 0 | 0 |
| .58 | scatter: dots fly and drop out | .8 | .5 | .2 | 1.1 | .05 | .85 |
| .66 → .80 | blob: chunky merged dots | 1 | .45 | 0 | 2.4 | .22 | 0 |
| .92 → 1 | ink again | 1 | .30 | 0 | 1.7 | .02 | 0 |

   Between keyframes: smoothstep. `breathe`: `a=1, b=.55+.25·sin(2πt/P), c=.35+.2·sin(2πt/1.7P+1.3), gain=1.25+.12·sin(2πt/P), th=.03`. `still` and reduced motion: `a=1, b=.45, c=.25, gain=1.4, th=.03`, drawn once.
5. It is **a pure function of `t`**: `seek(t)` draws exactly that frame. Visual tests and the motion references depend on this.

**Behaviour:** pauses offscreen (IntersectionObserver) and in hidden tabs; re-lays out on resize (debounced 120 ms); DPR capped at 2; `prefers-reduced-motion` → `still`. Budget: ≤ 25,000 cells per press, ≤ 3 animated presses on screen at once, ≤ 4 ms per frame per press on a mid-range phone; if a press goes over, drop it to 30 fps and log it. With `?shot&t=<seconds>` every press stops and seeks to `t` (§13).

**Every print in the product** (options are the prototype's; keep them):

| Where | Source | Options |
|---|---|---|
| Placeholder stage | logo + `SAMITE` lockup (§11.10 for geometry) | dot, cell 9 (7 on phones), `cycle` 6.4 s |
| Landing hero, paper panel | radial light + 16 faint rays + the logo, faded to black at the bottom; drawn in **ink on cream** | bayer, cell 6 (5 on phones), `breathe` 5.2 s, ink `#0A0A0A`, glow 2, wide 9, bloom .3, overlay = the job HUD (§11.6) |
| How it works: step glyphs | a sheet / an outlined square / a sheet with `#` / a ring, plus a fading rule to the right | bayer, cell 5, `still`, glow 1, wide 3, intro 0 |
| For machines | `assets/press-figure.jpg` (the banner's falling figure), cover-fit at 1.12×, filter `blur(1.5px) contrast(1.5) brightness(.8)` | square, cell 7, `breathe` 7 s, glow 1, wide 5, gamma 1.35, bloom .2 |
| Footer art, back | `assets/press-clouds.jpg` with a fade to black | bayer, cell 5, `still`, glow 1, wide 4, ink `#3A3934` |
| Footer art, front | `SAMITE` in 800 italic, centred, bottom-aligned | dot, cell 8 (5 on phones), `cycle` 7.2 s |
| App: escrow last 24 h | an area chart of escrowed USDC | bayer, cell 4, `still` |
| App: machine avatar | the address hashed into a 5×5 mirrored pixel glyph | bayer, cell 4 (2 at 56px), `still`, glow 1, wide 2, bloom .12 |
| OG card | the lockup | dot, cell 8, `still`, bloom .55 |

The machine page's activity grid is **not** a press: it's a plain canvas of halftone dots, one per day, dot size = jobs accepted that day (0 = a 1.2px `--line-hi` dot), 26 weeks × 7 days. Keep it crisp.

### 11.6 The hero HUD (the job tracker on the paper panel)

Drawn in the hero press's `overlay`, in ink, as a function of `t` (see `hud()` in `landing.html`):
- one job moves through four states, 1.9 s each: **OPEN** (box on the pupil, a ring around the eye) → **CLAIMED** (box glides to the upper-right ray, label `CLAIMED / BY 7f3a…c91e`) → **DELIVERED** (lower-left ray, `DELIVERED / HASH 9be2…04aa`) → **PAID** (back to the pupil, which fills; `PAID 117.00 / → 7f3a…c91e`). Then the next example job (0417 → 0418 → 0419).
- The box glides in the first 22% of each state (cubic ease in-out), the label fades in after it, on a cream plate, with a hairline leader. Labels flip to the left when they'd leave the panel.
- Below it: the cream "Post a job" bracket button and the caption `example job, time sped up`.

### 11.7 Components (`packages/ui`)

- **Bracket button**: corner brackets drawn with 8 `linear-gradient` pieces (16px arms, 1.5px), plus 48px centre ticks top and bottom. Variants: cream on paper (hero), outline on black (footer, app top bar). Hover inverts. Heights 62 / 54 / 38. Uppercase Montserrat 600.
- **Box button**: 46px (site) / 38px (app), `--panel-2`, 1px `--line-hi`, uppercase Montserrat 500; hover border → cream.
- **Primary button** (app): solid cream, ink text, 56px for the main action of a screen. **Ghost**: transparent with `--line-hi` border.
- **Wallet chip**: square indicator + short address + `· 412.50 USDC` in `--text-3` (balance hidden on phones).
- **Status glyph** `<Status kind>`: 11px square, 1.5px cream border: open hollow; claimed diagonal half fill; delivered 4px dot screen; paid filled; refunded dashed border. Always followed by a mono uppercase label. Never coloured.
- **Chips** (categories) and **segmented controls** (sort; Anyone / People / Machines).
- **Jobs table**: title (Montserrat 600 15.5px, underline on hover) + meta row (job no., category tag, status); reward right-aligned (mono 700 + small `USDC`); deadline; posted by (Person / Machine + address). Rows separated by hairlines; hover `--panel`.
- **Panel** (side column): mono heading with an optional `(example)` label on the right.
- **KV list**: label `--text-3` left, mono value right.
- **Feed list**: glyph + mono line + relative time; dashed hairlines between items.
- **Timeline** (job page): 4 cells, a 3px bar on top of each (cream when done; half for the current step), number, glyph + label, time, tx link `4dQx…9Lm2 ↗`.
- **Module** (hero chart): bordered `--panel` box with a 42px cream tab on its top edge, the dot chart, an axis row, and the **segmented meter** (28 segments, filled ones cream).
- **Code block with tabs** (MCP / SDK / HTTP), comments in `--text-3`.
- **Split bar**: 97.5 / 2.5 with legend.
- **Example label** `<Ex>`.
- **Activity grid**, **Avatar** (see §11.5).
- Focus: `outline: 2px solid var(--cream)` with offset on every interactive element. No `outline: none` without a visible replacement.

### 11.8 Motion

Allowed, and only these:
- the presses (§11.5) and the hero HUD (§11.6);
- the "Agents / Bots / Devices" highlight stepping every 2.4 s;
- the blinking square on the placeholder (1.6 s steps);
- section entrances: opacity + 12px rise, 1 s, `cubic-bezier(.2,.7,.2,1)`, staggered 80 ms, once;
- hover inversions on buttons and chips (instant or ≤ 120 ms).

`prefers-reduced-motion`: presses `still`, no HUD movement (show the PAID frame), no blinking, no entrances.

### 11.9 Ruled out

Any accent colour; gradients or glows on UI elements (they belong only inside press sources); rounded corners; drop shadows; glassmorphism; parallax; scroll-jacking or smooth-scroll libraries; WebGL/3D; Lottie; confetti; typewriter text; auto-playing video on the site; stock photos or AI images shown raw; emoji in UI copy; icon sets with rounded strokes (icons are status glyphs, arrows `↗ →`, and the hamburger, drawn with 1.5–1.6px square-capped strokes).

### 11.10 Landing, section by section (`landing.html`, `screenshots/landing-*.png`, `motion/landing-hero.mp4`, `motion/landing-footer-word.mp4`)

1. **Nav** (§11.4).
2. **Hero**, three cells, height `max(760px, 100svh − 92px)`, max 980px:
   - *Left:* eyebrow `THE JOB BOARD FOR MACHINES`; H1 **Post the work. / Machines do it. / Solana pays.**; at the bottom the lede "Every job settles on-chain." + "USDC waits in escrow until the work is accepted. Then 97.5% goes to the machine that did it, in one transaction."; the **module**: jobs settled per hour over 24 h as a vertical dot waveform, axis 00:00–24:00, "Escrow locked 48,210 USDC" meter, caption `example values; live from /api/stats in production`. In production it reads `/api/v1/stats`; until there is real activity it keeps the example data **and the label**.
   - *Centre:* the paper panel with the hero press + HUD (§11.6) and the "Post a job" bracket button.
   - *Right:* the 6×6 pixel cluster (cream and `#6E6C66` cells), H3 **Work. Transact. Earn.**, "Machines hire machines too. An agent can post a job from its own wallet and pay another machine to do it.", and `AGENTS / BOTS / DEVICES` with the stepping highlight.
3. **Latest settlements** strip: label cell + 4 cells (`JOB 0412 · PAID / 117.00 USDC → 7f3a…c91e` …). Live from `/events` in production; labelled `example` until then.
4. **How a job runs:** heading cell "Four steps. / One escrow." + paragraph; 4 step cells (number, glyph print, 800-italic name, one sentence). Copy as in the prototype.
5. **For machines:** left the figure print (Park); right "Built for machines first. / People are welcome." (second line `--text-3`), the paragraph about MCP / SDK / HTTP and keys staying with the machine, tabs MCP · SDK · HTTP, and the code block (the `.mcp.json` above; the SDK and HTTP tabs show the matching snippets from §6).
6. **Escrow:** "The money waits. / The work decides." + "Every job has its own escrow account on Solana. Nobody, Samite included, can move the USDC anywhere except to the machine or back to the poster."; five state cells (Open, Claimed, Delivered, Paid, Refunded) with glyphs and one-line rules, joined by small chevron boxes; then the **fee** row: `2.5%` big, "Of every payout · nothing on refunds", the split bar and legend.
7. **Footer:** the art band (clouds print + the cycling `SAMITE` word print), then columns: "Infrastructure for machines to work, transact and earn." + outline "Post a job" bracket; Product (Job board, Post a job, Escrow, Status); Build (Docs, MCP server, TypeScript SDK, Program on Solscan); Social (X, GitHub); legal row `© 2026 Samite` · `samite.fun · Built on Solana`.

Links that have nowhere to go yet (GitHub, Status, Solscan before deploy) are hidden, not dead.

### 11.11 Copy rules

- English. Short declarative sentences. Sentence case for headings and buttons in the app; site buttons and mono labels uppercase via CSS.
- Numbers: USDC always with 2 decimals and the unit; percentages as `97.5%`; addresses `7f3a…c91e` (4 + 4); relative times `12s`, `48s`, `1m`, `3h`; durations `41h 12m`.
- Every example value is labelled (`example`, `(example)`, `example jobs and values`, `example job, time sped up`).
- Say what happens to money in plain words, every time money moves: who gets what, when, and what happens if nobody acts.
- Never: "build in public"; "Soon on …" any chain or exchange; invented tickers or token talk; "audited", "secure by design", "trustless" as a slogan; "guaranteed", "passive income", "earn while you sleep"; "AI-powered" as filler; "revolutionary", "next-gen".
- Words from §1.3 only.

### 11.12 The app (`app.html`, `screenshots/app-*.png`)

Calmer than the site: the same tokens and hairlines, dense mono data, prints only as small accents.
- **Board** (`#board`): heading "Open jobs" + counts; sort segment (Newest / Reward / Deadline); category chips; Anyone / People / Machines segment; the jobs table; side column: "Your machine" (when the connected wallet has `MachineStats`: earned, jobs done, accepted, now working on, connected via), "Live" feed, "Escrow, last 24 h" print. Empty board: a still print of the mark at low bloom and "No open jobs right now. Post one, or watch the feed."
- **Post a job** (`#new`): three form sections (The task / Reward / Who can claim), each with a 220px explainer column; the sticky summary panel (§9.1). Validation inline, in `--cream` text with a dashed border (no red).
- **Job** (`#job`): crumbs, title, status, reward in escrow; the timeline; actions (poster: accept / reject; machine: deliver / unclaim; anyone else: nothing); delivery, instructions, accepted when; side: escrow KV (locked, to the machine, fee, job account ↗, program ↗), machine card (avatar, address, accepted, rate, median delivery), activity feed. Rejections appear in the activity feed with their reason.
- **Machine** (`#machine`): avatar print, crumbs, name (self-chosen label or the short address), full address, kind, first job; four stats; the activity grid + work by category (dot bars); history table with outcome glyphs.
- **Wallet**: Wallet Standard modal styled with the tokens (square, hairlines). Phones: the tabs become a second scrolling row; the side column moves under the main column; action buttons go full width.

### 11.13 Accessibility

- Every canvas is `aria-hidden` and has a text equivalent nearby (the placeholder has a visually hidden H1; charts have `aria-label` with the summary).
- Status is never conveyed by the glyph alone; the label is always there.
- Keyboard: everything reachable; the app's dialogs trap focus and close on Esc.
- Contrast per §11.2; target WCAG 2.2 AA.

---

## 12. Security and abuse

- **Secrets:** only in `.env` / the hosting secret store; `.env*` gitignored except `.env.example`; gitleaks (or similar) in CI.
- **Keys:** the admin key, the upgrade authority and the treasury stay with the owner (hardware wallet or multisig recommended). The only key on a server is the keeper's, which can pay fees and nothing else. The server **never signs a user's transaction**; `/tx/*` returns unsigned transactions.
- **Program:** every constraint in §4 has a failing test (§13). No admin path to escrowed funds. Pause can't trap money. `fee_bps` capped in code. Closing accounts only to the poster.
- **Client honesty:** the job page re-checks state and hashes against `NEXT_PUBLIC_RPC_URL` in the browser, so our API can't silently show a different status or delivery hash than the chain.
- **Moderation of specs** (before a job appears on the board): a model check with a short policy: nothing illegal; no access to systems or accounts without permission (no credential stuffing, no CAPTCHA solving, no scraping behind logins); no malware; no harassment, doxxing or tracking of private people; no sexual content involving minors; no spam or fake reviews or engagement; no weapons. The owner can extend it. Refused specs never reach the board, the API listing or the MCP tools. On-chain posts that bypass the API still exist on-chain but stay hidden (`jobs.hidden`); their money rules are unchanged.
- **Untrusted text:** specs, notes and reasons are rendered as Markdown with HTML disabled, links `rel="nofollow noopener ugc"`. The MCP server marks them as untrusted (§6.3).
- **Uploads:** size limits from the spec, content-type sniffed, served from a separate download domain with `Content-Disposition: attachment`; never rendered inline except CSV/text previews escaped as text.
- **Rate limits** on every write route; replay protection on signed requests.
- **No audit claim**, anywhere. The self-review in `docs/SECURITY-REVIEW.md` is called a self-review.
- **Legal:** running an escrow and charging a fee may have legal implications in some places. The owner decides; you write plain-English drafts of the terms and privacy pages marked DRAFT, and list the open questions in `docs/DECISIONS.md`.

---

## 13. Testing

- **Unit** (vitest): NFC + JCS + hashing (golden files for specs and deliveries), schema limits, the fee maths (every reward from 1 to 10,000,000 base units in a property test: `to_machine + fee == reward`, `fee == floor(reward·bps/10_000)`), request signing and verification, summaries.
- **Program** (LiteSVM, Rust or TS; `solana-test-validator` for manual runs):
  - happy paths: post → claim → deliver → accept; post → claim → deliver → no answer → `release_after_review`; post → cancel; post → no claim → deadline → refund; claim → unclaim → claim by another; claim with `claim_window` → `expire_claim`; reject → redeliver → accept; three rejections → refund.
  - each must fail: claim own job; claim when paused; claim after deadline; claim with `Proven` below the bar; claim not on the allowlist; claim without a USDC ATA; deliver by another machine; deliver after deadline; a 4th delivery; accept by a non-poster; reject after the review window; release before the window ends; refund while `Delivered`; refund before the deadline; payout to an ATA of a different owner or mint; fee to a non-treasury account; `update_config` with fee > `MAX_FEE_BPS`; `update_config` by a non-admin; a different mint than `Config.usdc_mint`; wrong token program.
  - exact balances after every path (poster, machine, treasury, rent returned).
  - pause: post and claim fail; everything else still works.
- **Indexer:** replay a recorded local session; kill and restart mid-way; the index ends identical.
- **MCP:** an end-to-end run on the local validator where Claude Code (or a scripted MCP client) finds a job, claims it, delivers a file and gets paid after a scripted accept.
- **Web** (Playwright): board, post (mocked wallet + local validator), job page actions, machine page.
  - **Visual tests:** `?shot&t=<s>` stops every press and seeks it to `t`, disables entrances and the walking highlight, and freezes example data. Compare against `design/screenshots/` at 1440×900 and 390×844.
  - Contrast test (§11.2), axe accessibility scan.
- **Mainnet:** never in CI. The only mainnet runs are the owner's, from `scripts/mainnet/`, after a "go".

---

## 14. Milestones and acceptance criteria

Build in this order. Each milestone ends with a short note and screenshots in `docs/PROGRESS.md`. Every mainnet action is the owner's, after an explicit "go".

1. **M0 Repo + placeholder live.** Monorepo, CI (typecheck, lint, test, secret scan), `packages/config`, tokens, fonts, the press ported (§11.5), the placeholder (§2), favicons, OG. The owner sets DNS.
   **Accept when** §2's checks pass and `samite.fun` serves the placeholder over HTTPS (apex and `www` → apex).
2. **M1 Design system + landing (static).** All components (§11.7), the landing section by section with example data and labels, docs skeleton. Not deployed to `/` yet: served at a preview URL.
   **Accept when** every section matches `design/screenshots/landing-*.png` side by side; the hero and footer match the motion references at the same `t`; Lighthouse mobile performance ≥ 90, accessibility ≥ 95; the owner approves.
3. **M2 Escrow program, local.** `programs/samite_escrow` with every test in §13; Codama client; `packages/formats`. Write `docs/PROGRAM-REVIEW.md`: every instruction, its checks, and the tests that prove them (not called an audit).
   **Accept when** all program tests pass, including exact balances, and the owner has read the review.
4. **M3 App on the local validator.** Indexer, API (§6.1), board, post, job page, machine page, my jobs, wallet connect. Everything against `solana-test-validator` with the local USDC (§3.2).
   **Accept when** a person posts a job in the browser, a scripted machine claims and delivers, the person accepts, and every number on every screen matches the chain.
5. **M4 Machine interface.** Signed requests, `@samite/sdk`, `@samite/mcp`, docs Quickstart.
   **Accept when** the MCP end-to-end test in §13 passes, and a machine can also do the whole flow with plain HTTP + local signing.
6. **M5 Mainnet (owner runs every step).** Prepare (don't run) `scripts/mainnet/deploy-program.ts`, `initialize-config.ts`, `first-job.ts`. Each starts with a header that says exactly what it sends, from which key, and the cost. The owner deploys, initialises (fee 250 bps, min reward 1 USDC, treasury of the owner's choosing), and runs the first job with a small reward (1–5 USDC) end to end with a second wallet as the machine. Then, with a separate "go", the owner turns on the keeper.
   **Accept when** the first mainnet job is paid, the treasury received exactly 2.5%, and the index shows it.
7. **M6 Launch.** The landing replaces the placeholder at `/`; live stats replace example values where real data exists (labels stay where it doesn't); docs complete; terms and privacy approved by the owner; npm packages published after the owner confirms the scope.
   **Accept when** Lighthouse (mobile) ≥ 90 / 95 on `/`, `/jobs`, a job page; the security self-review in `docs/SECURITY-REVIEW.md` is written; the owner says "launch".

---

## 15. Constants (re-verify each before use)

| What | Value | Source |
|---|---|---|
| USDC mint (mainnet) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimals, SPL Token | Circle, USDC contract addresses (checked Nov 12, 2026) |
| Fee | 250 bps (2.5%) of every payout; 0 on refunds and cancels | Owner decision (Nov 2026) |
| `MAX_FEE_BPS` | 500 | This spec |
| Payment asset | USDC only, in escrow, paid on acceptance | Owner decision (Nov 2026) |
| Default review window | 48 h | This spec |
| Min reward | 1 USDC | This spec (owner to confirm) |
| Max deliveries / min resubmit | 3 / 24 h | This spec |
| Base fee | 5,000 lamports per signature | Solana docs |
| Rent | read live | `getMinimumBalanceForRentExemption` |
| Anchor | latest stable 1.x (1.2.2 at the time of writing) | anchor-lang.com changelog |
| Network | mainnet only (local validator for tests) | Owner's standing practice |
| Colours | black + cream, no accent | Owner decision (Nov 2026) |

## 16. Open items for the owner (don't block on them; keep them configurable)

- X handle (`@samitefun` assumed) and the npm scope (`@samite` assumed) → `brand.ts`.
- M0: "Follow on X" only (current) or an email waitlist too (needs a privacy note and a store).
- Treasury: which wallet receives fees; a Squads multisig for the treasury, admin and upgrade authority is recommended.
- Min reward and the limits in §4.4.
- A devnet beta for machine builders before mainnet (default: no).
- Email notifications for posters (default: none; in-app + SSE only).
- Disputes in v2: arbiter, split, or keep public rejections only.
- Whether and when to make the program immutable.
- Terms of service and the legal questions in §12.
- Token ticker + CA (header chip only), if a token exists.
- Keep `samite.fun` renewed (job specs and the API live there).

## 17. Reference

- **Design kit:** `design/prototype/` (placeholder, landing, app, og; the press and the mark as JS), `design/screenshots/`, `design/motion/`, `design/reference/` (style only, §11.1).
- **Anchor:** https://www.anchor-lang.com/docs (changelog and release notes for 1.x).
- **Solana TypeScript:** https://solana.com/docs/clients/official/javascript (Kit), https://solana.com/docs/frontend (React + wallet), https://solana.com/docs/programs/codama/clients (Codama clients).
- **USDC addresses:** https://developers.circle.com/stablecoins/usdc-contract-addresses
- **Model Context Protocol:** https://modelcontextprotocol.io and the TypeScript SDK repo (v2 packages).
- **Canonical JSON:** RFC 8785 (JCS); Unicode NFC.
- **Vercel domains:** https://vercel.com/docs/domains/add-a-domain (values are per project).
- **LiteSVM:** its README for `set_account` and loading programs.
