# Decisions

Small, reversible choices made while building, and where the installed packages disagreed with CLAUDE.md.
Newest at the bottom. Owner questions are marked **(owner)**.

## 2026-11-12 — M0

- **Repo layout.** The kit's `CLAUDE.md`, `brand/` and `design/` sit at the repo root as the kit README asks; the kit README itself moved to `docs/KIT.md` so it doesn't become the repo README.
- **TypeScript 6.0.3, not 7.x.** TS 7 (the native port) is `latest` on npm, but `typescript-eslint` 8.72 supports `>=4.8.4 <6.1.0` and Next.js type-checks through the TS JS API. Stay on 6.0.x until both support 7.
- **ESLint 9.39, not 10.** `eslint-plugin-react` and `eslint-plugin-import` (pulled in by `eslint-config-next`) declare peers up to ESLint 9.
- **Placeholder bracket button follows the prototype, not §11.7.** `placeholder.html` (and the acceptance screenshot) draws 12px mask corners in a 1px line, 7px outside a solid 52px cream button, with no centre ticks. §11.7's 8-gradient bracket with 48px ticks is the landing/app variant (M1).
- **Placeholder grain opacity .07** (prototype) instead of §11.4's .06 (site). The landing keeps .06.
- **Fonts for canvases.** `next/font` hashes family names, so the press reads the family from the CSS variables next/font sets (`--ff-montserrat`, `--ff-space-mono`) and calls `document.fonts.load()` for the exact faces it draws before `layout()`. The reference engine draws once before fonts are ready and again after; the port only draws after, which §11.3 asks for. Same pixels once fonts are loaded.
- **The motion references start at t = 1.4 s.** `placeholder-press-cycle.mp4` and `placeholder-mobile.mp4` frame n show press t = 1.4 + n/30 (found by matching the scatter frames, whose flicker pattern differs for every t; the match is exact). §2's "frame for frame at the same t" is checked with that offset.
- **Reduced motion skips the press intro.** The reference engine still fades the print in over 1.2 s under `prefers-reduced-motion`; the port draws the still frame at once and runs no loop (§11.8: "presses still").
- **Visual acceptance thresholds.** Screenshots: < 0.5% of pixels may differ by more than 48/255 from `design/screenshots/` on macOS (where the references were made), < 1.5% on Linux CI (different text anti-aliasing: 0.54% / 0.95% measured); a wrong t gives 6–9%. Motion: mean error at the matched t within 0.5 of the best t.
- **Engine parity is tested in the browser.** A `SAMITE_HARNESS=1`-gated page exposes the TS press to Playwright, which loads the reference `samite-press.js` next to it and compares pixels. The page 404s on Vercel.
- **`#fff` on the placeholder button's hover** stays, as in the prototype (it's the hover of a cream fill, not a colour).
- **Fonts for presses: `allSettled`, then `document.fonts.ready`.** next/font's fallback face is `local("Arial")`, which Linux and Android lack; `document.fonts.load()` of the family list rejects at once for it while the real face is still downloading. The press waits for every load to settle and then for `ready`, so it never prints with a fallback (e2e with a 1.5 s font delay proves it).
- **Supply chain: pnpm's `minimumReleaseAge`.** pnpm 12 refuses packages published within the last day. turbo 2.11.11 and prettier 3.10.1 were too new, so the repo pins turbo 2.11.10 and prettier 3.9.10 instead of exempting them.
- **The placeholder slug** is hidden until the press places it, and shown by CSS after 3 s if the script never runs.

## 2026-11-12 — M1

- **Preview-only pages.** Everything but `/` lives in the `(preview)` route group, whose layout 404s when `VERCEL_ENV=production` (Vercel sets it at build). Preview deployments and local builds serve them; samite.fun keeps the placeholder until the owner approves the landing (§0, M6). `SAMITE_FORCE_PRODUCTION=1` reproduces the production gate locally.
- **The landing references were taken at t = 3 s** (hero 0.16% off at t = 3 vs 1.3% at 2.8–3.3, found by search).
- **`landing-hero.mp4` frame n = t 1.4 + n/30** (same as the placeholder's). **`landing-footer-word.mp4` is a real-time capture compressed to 7.2 s**: frame n ≈ t 0.749 + 0.1591·n (least squares over 11 scatter frames; residuals ≤ 0.11 s), so the footer is checked within ±0.15 s of that line.
- **Footer word position.** In the prototype `.foot-art canvas{inset:0}` beats `.word{bottom:-2px}`, so the word sits at the top of the band. The screenshot shows that; we keep it.
- **Hidden footer links.** Status, Program on Solscan and GitHub are not rendered until they have somewhere to go (§11.10). The reference footer has them, so the full-page check compares the page above the footer and the footer art band (both start at the same height) and not the link columns.
- **Example aggregates without decimals.** The prototype shows "48,210 USDC" and "46,920 USDC in escrow"; §11.11 says USDC always has 2 decimals. Kept as in the prototype for the example values **(owner)**: live values will use 2 decimals unless you prefer whole numbers for aggregates.
- **Stats URL in the example caption** reads `/api/v1/stats` (the real route) instead of the prototype's `/api/stats`.
- **Refunded glyph.** The landing's escrow section uses the crossed square (as the prototype); the app's status glyph for refunded is the dashed square (§11.7) **(owner)**: say if you want one shape everywhere.
- **Visual checks on Linux CI compare at 1/4 size.** The references are macOS renders; Linux rasterises and advances text differently (2.7–5% of pixels on text-heavy screens at full size). At 1/4 size anti-aliasing averages out (mac: 0.01–0.8%) and a wrong t still fails (7–9%). Full-size strict checks stay on macOS (`SAMITE_DOWNSCALE` overrides). **Revised (Nov 12):** at 1/4 size CI still measured 2.2–3.9% on the board, the job page and the landing, against a 2% bound. The failing checks now attach both images: the layout is the same, and the rest is Linux text rasterisation (worse at the phones' 3× scale) plus the glyphs our two fonts lack (`→`, `…`), which come from different system fonts and re-wrap a line (e.g. a feed item). The Linux bound is 5% (the app and landing checks, and the landing's footer band); a wrong t still gives 7–9%. The strict bounds stay on macOS, where the references were made, and are run there before every UI PR.
- **Shot mode disables entrances** (they had a 1 s transition even when shown at once).
- **Headings.** The prototype's h4/h5/h6 became h3/h2 for a correct outline; same styles.
- **The menu box** opens the site links (Jobs, Machines, Escrow, Docs, Launch app); on desktop it repeats the nav.
- **App screens use example data** from `apps/web/lib/examples.ts` (values verbatim from `app.html`), labelled on every screen. The top bar's wallet chip shows the prototype's example wallet until wallet connect lands in M3 (its accessible name says "Example wallet").
- **App tabs.** "My jobs" is current on job pages (the example job is "posted by you", as in the prototype); "Machines" points at the example machine until M3 has a machines index.
- **Preview actions.** Accept, reject and post explain that they need a wallet and the program (next build) instead of doing nothing. The reject dialog is complete (public reason, 10–1,000 characters, Esc closes).
- **Production gate verified** with `SAMITE_FORCE_PRODUCTION=1 next build`: `/` 200; `/landing`, `/jobs`, `/jobs/new`, `/jobs/0415`, `/me`, `/machines/…`, `/dev/press-parity` 404.

### M1 review (Nov 12) — rulings

- **Production gate per request** (Critical): `proxy.ts` 404s everything but the placeholder and its assets when `VERCEL_ENV=production`; `turbo.json` declares `VERCEL_ENV` and `SAMITE_FORCE_PRODUCTION` for the build so Vercel's Remote Cache can't reuse a preview build for production. Proven by building as preview and serving as production.
- **Money in the post form**: rewards are typed to cents at most (`parseUsdc(…, { maxDecimals: 2 })`), and the split's parts are shown exactly (`formatUsdc(…, { decimals: "exact" })`: at least 2 decimals, up to 6, never rounded), so 1.00 shows 0.975 + 0.025 and the parts always add up. This departs from "USDC always with 2 decimals" (§11.11) only where 2 decimals would show numbers that don't add up.
- **`Agents / Bots / Devices`** wraps and tightens its gap below 1200px (it overflowed the 26fr cell at 1101–1125px, as in the prototype).
- **Docs**: the draft notice is in the docs layout, on every page; the token question is gone from the FAQ (§1.5).
- **Minor, fixed**: the landing's HTTP snippet quotes the URL; example explorer links are plain text (hidden, not dead); only `/` canonicalises to `/`.
- **Minor, deferred**: reduced motion is read once at mount (a mid-session change freezes the HUD mid-state); the two landing photos load after `load` even if nobody scrolls (LCP unaffected).

## M2 — formats

- **"Characters" are Unicode code points after NFC**, not UTF-16 units and not graphemes: 😀 is 1, a decomposed é is 1, 👍🏽 is 2. Every character limit in §5 uses `charCount`, and the UI should use it too so its counters agree with the API.
- **KB and MB are binary.** 16 KB = 16,384 bytes, 64 KB = 65,536, 200 MB = 209,715,200 (the §5.1 example's `max_bytes`). Byte limits count UTF-8 after NFC (`byteCount`).
- **NFC applies to keys as well as values**, so two specs that look the same always hash the same. Keys that collide after NFC (`"é"` and `"e\u0301"`) are refused. It is NFC, not NFKC: ligatures and full-width letters stay. URLs are normalised too, which only matters for raw non-ASCII URLs; percent-encoded ones are unchanged.
- **NFC runs before JCS, never inside it.** RFC 8785 §3.1 says JCS must keep strings as they are, so `jcs()` is plain RFC 8785 and `canonicalJson()` = `jcs(normalizeNfc(x))`. One visible effect: in the RFC's §3.2.3 sorting sample, U+FB33 (a composition exclusion) becomes U+05D3 U+05BC under NFC and sorts earlier. The RFC vectors are tested against `jcs()` alone.
- **JCS written in-house** (about 90 lines; `String(n)` is ECMAScript's Number::toString), checked against RFC 8785 Appendix B, §3.2.3 and §3.2.4. It refuses NaN, ±Infinity, lone surrogates (TextEncoder would quietly write U+FFFD, so two strings could share a hash), cycles, holes in arrays, non-plain objects and nesting past 100 levels. An `undefined` property is left out, as `JSON.stringify` does. An own `__proto__` key is an ordinary key.
- **Integers must be safe integers** (≤ 2^53 − 1), checked by the schemas. JCS itself serialises any finite double, as the RFC says.
- **Unknown fields are refused** in `samite/job@1` and `samite/delivery@1`. The hash covers everything a machine reads, so a new field means a new version.
- **Choices §5 leaves open:** a file deliverable must give `max_bytes` (1 to 200 MB). Text and url deliverables take no other fields. The title is one line. Blank strings are refused. Attachments may be `[]`. sha256 must be lowercase hex, so each hash has one spelling. URLs must be https with a host, no spaces or credentials, at most 2,048 characters. File names are 1–255 characters with no `/`, `\` or control characters, and are not `.` or `..`. A delivery has 1–100 files of 0 to 200 MB each, with unique names. `note` is optional and may be empty.
- **`job` is checked as base58 that decodes to 32 bytes.** Proving it is a PDA needs curve maths and the seeds, so that check belongs to the API against the chain. Strings over 44 characters are refused before decoding, because base58 decoding is quadratic.
- **`attempt` 1..3 is a constant in formats**, with a test that it equals `@samite/config` `LIMITS.maxDeliveries`. formats has no runtime dependency on config, so the SDK can publish it on its own.
- **Hashing does not validate; parsing does.** `parseJobSpec`, `parseDelivery` and `parseRejectionReason` apply NFC, check the result and return it. `specHash`, `deliveryHash` and `reasonHash` only canonicalise and hash, so a stored spec always re-hashes to its on-chain value even if a check is tightened later.
- **Warnings are three objective checks:** instructions under 40 characters, an acceptance criterion under 12 characters, and a criterion that repeats an earlier one. There are no vagueness heuristics.
- **Errors are one sentence per field**, "<Label> <predicate>", for example "Acceptance criterion 2 must be 1–280 characters (it has 281).", with a path like `attachments[0].sha256`.
- **sha256 comes from `@noble/hashes` 2.4.0** (synchronous, no I/O, works in Node and browsers; published 2026-08-27). It declares `node >= 20.19`, while the root `engines` says `>= 20`. CI runs Node 24.
- **Golden expectations come from Python, not from this code.** `scripts/golden.py` (stdlib `unicodedata`, `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`, `hashlib`; run with `-I`) writes `<name>.canonical` and `<name>.sha256`. It refuses inputs where that `json.dumps` call would differ from JCS: floats, unsafe integers, keys whose code-point and UTF-16 orders differ, and duplicate keys. The expected-bytes files use a `.canonical` extension so `prettier --write .` can't reformat them, which leaves the root `.prettierignore` alone.
- **Not checked here:** whether a delivery fits its spec (the same kind as `deliverable`, file sizes ≤ `max_bytes`). That needs both documents, so it belongs to `POST /deliveries` (M3).

## M2 — escrow program

Toolchain and libraries (the installed crates won where they and CLAUDE.md differed):

- **Anchor 1.2.2 everywhere.** `anchor-cli`, `anchor-lang` and `anchor-spl` 1.2.2 (2.0.0-rc.2 is out; not used). crates.io lists `github.com/otter-sec/anchor` as the repository. `Anchor.toml` pins `anchor_version`; avm picks it per project.
- **No `solana_version` in `Anchor.toml`.** With it, Anchor runs `agave-install init <version>`, which switches the machine-wide Solana release (and back) on every command. Built with Solana (Agave) 4.4.0 by putting its `bin/` first on `PATH`; CI installs 4.4.0.
- **Host Rust 1.99.0 in `rust-toolchain.toml`.** LiteSVM 0.18.2 needs Rust ≥ 1.97.1 (Anchor's own template pins Rust 1.89 with LiteSVM 0.15). The program crate keeps `rust-version = 1.89` (anchor-lang's MSRV); `cargo build-sbf` uses the platform-tools Rust (1.95, platform-tools v1.57).
- **`anchor-spl` needs its `token_2022` feature for `idl-build`.** Its IDL code references `token_interface`, which that feature gates; without it the IDL build fails. The feature is on, but the program only uses the classic `anchor_spl::token` (`Program<Token>`, `Account<TokenAccount>`, `transfer_checked`); passing Token-2022 fails with `InvalidProgramId` (tested).
- **Anchor 1.x rejects duplicate mutable accounts** (`ConstraintDuplicateMutableAccount`). In a payout the treasury may be the machine's own USDC ATA (e.g. the owner runs a machine from the treasury wallet); without `dup` on `treasury` that payout fails forever and the job's money is stuck in `Delivered`. `dup` is safe here because token accounts are never serialised by our program. A mutation test showed the failure without it.
- **The program keypair is local and gitignored.** `declare_id!` and `Anchor.toml` carry `AcTtHioeudEDQuaW6WaL5auXC2rv3jPNoNbPxPB7pHM9` from `target/deploy/` with `TODO(M5): owner's program id`. CI has no keypair and builds with `anchor build --ignore-keys`; the tests load the `.so` under `samite_escrow::ID`, so the keypair never matters to them.

Program choices (smallest safe reading of §4):

- **`initialize_config` is restricted to the program's upgrade authority** (checked through the `ProgramData` account). §4.3 says "deployer (becomes admin)"; the upgrade authority is how the program knows the deployer, and it stops anyone from initialising first between deploy and init. At M5 the key (or Squads multisig) that deploys must also sign `initialize_config`, and becomes the admin.
- **USDC mint is a constant** (`USDC_MINT`, `TODO(verify)` before M5) because `initialize_config(treasury, fee_bps, min_reward)` has no mint argument; init checks the mint account is at that address with 6 decimals and stores it in `Config.usdc_mint`. Every instruction that moves tokens checks `usdc_mint == Config.usdc_mint`.
- **The treasury is passed as an account, not a `Pubkey`,** to `initialize_config` and `update_config`, so the program can check it. A wrong treasury would block every payout. `update_config` takes `Option`s for fee, min reward and pause. _(Revised Nov 12: the treasury must be the USDC ATA of a stored `treasury_owner`; see "M2 — review fixes".)_
- **`Config.pending_admin: Option<Pubkey>`** was added (after §4.2's fields) for the two-step `set_admin`: `propose_admin(new)` by the admin, `accept_admin` by the new key. A second proposal replaces the first.
- **`min_reward` must be ≥ 1 base unit**; zero would allow zero-reward jobs.
- **Zero hashes are refused**: `spec_hash`, `delivery_hash` and `reason_hash` must be non-zero (§4.2 uses an all-zero `delivery_hash` to mean "none"; §4.6 needs a reason for every rejection).
- **Allowlist shape**: with `Allowlist` it holds 1–10 addresses; with `Any` or `Proven` it must be empty.
- **Anything above `reward` in a vault leaves with the main transfer.** Anyone can send USDC to a vault, and a token account only closes when empty, so a 1-unit donation would otherwise block cancel, refund and payout forever. The extra goes to the machine's ATA on a payout and to the poster on a refund or cancel; the fee is always on `reward` only. In the normal case `to_machine + fee == reward` exactly. _(Revised Nov 12: the extra is no longer counted in `MachineStats.earned`; see "M2 — review fixes".)_
- **A rejection restarts the claim** (`claimed_at = now`), and once a job has had a delivery `expire_claim` waits `max(claim_window, MIN_RESUBMIT)`. Without this, a job with a short claim window could be expired by the keeper right after a rejection, which breaks "a rejected machine always gets at least 24 h" (§4.6).
- **`deliveries` counts per job, not per machine** (§4.2): a machine that claims after another machine's rejected deliveries has the remaining attempts. `delivery_hash` keeps the last delivery.
- **The third rejection emits `DeliveryRejected { refunded: true }` and then `JobRefunded { deliveries: 3 }`.** `JobRefunded` always carries `deliveries`, so the indexer can count "refunded after a delivery" (§4.6) without replaying history.
- **Events carry the facts the indexer needs** (job, poster/machine, amounts, timestamps), and config changes emit events too (`ConfigInitialized`, `ConfigUpdated`, `AdminProposed`, `AdminAccepted`). §4.3 named only the job events.
- **The permissionless instructions take no signer** (`expire_claim`, `release_after_review`, `refund_after_deadline`): the fee payer signs the transaction and nothing is paid by the caller. Rent always goes to `job.poster`.
- **Poster and machine token accounts must be their USDC ATAs** (post, refund, claim, payout), as §3.1 and §4.5 say. If one is closed later, anyone can re-create it (ATA creation is permissionless); the keeper should prepend `CreateIdempotent` before a release or refund.
- **`accept_delivery` has no time limit while `Delivered`**, even after the review window or the deadline, until someone calls `release_after_review`. The poster can always pay.
- **Time boundaries**: claim needs `now < deadline`; deliver `now ≤ deadline`; refund `now > deadline`; reject `now ≤ delivered_at + review_window`; release `now > delivered_at + review_window`; expire `now > claimed_at + hold`.
- **`Job` is always sized for 10 allowlist entries** (`InitSpace`, 535 bytes; 568 since `previous_worker`); the rent comes back at close.

Client and tests:

- **Codama client** (`packages/program-client`): `codama` 1.11.0, `@codama/nodes-from-anchor` 1.5.6, `@codama/renderers-js` 2.9.0 for `@solana/kit` 8.6.0, rendered with `kitImportStrategy: "rootOnly"` so `@solana/kit` is the only runtime dependency, and `syncPackageJson: false` so versions stay pinned by hand. The Anchor IDL is committed in `idl/` (prettier-ignored: it must stay byte-identical to `anchor build`'s output, which CI diffs).
- **LiteSVM harness**: every transaction is paid by a separate fee payer so balances move only by what the program moves (exact-balance asserts); LiteSVM loads programs with no upgrade authority, so the tests write one into the `ProgramData` header; USDC is a mint written at the real address with a test mint authority (§3.2).
- **`anchor build` also compiles the tests** (the IDL step runs `cargo test` with a filter), so a test that references a missing instruction breaks the IDL build; `anchor build --no-idl` builds just the `.so`.

## M2 — review fixes (Nov 12)

A review of the M2 build found six issues (`docs/PROGRAM-REVIEW.md`, "Review findings (Nov 12)"). What was decided:

- **A machine that left a job can't claim it again.** `Job.previous_worker: Option<Pubkey>` (appended after `bump`) is set by `unclaim_job` and `expire_claim`; `claim_job` refuses that key with `CannotReclaim`. It holds one address, the latest to leave: enough to stop a single key from renewing its claim (`[expire_claim, claim_job]` or `[unclaim_job, claim_job]` in one transaction), not a squatter with several keys (that needs a claim bond, an owner decision). It is never cleared, so a machine that drops a job gives it up for good unless another machine holds and leaves it after.
- **`earned` counts `reward − fee` only.** A donation to a vault still goes to the machine's ATA on a payout (the vault must be empty to close), and `JobPaid.to_machine` is still the amount actually sent; `MachineStats.earned` is credited with the split alone. Indexers that sum earnings should use `reward − fee`, not `to_machine`. This replaces "the extra goes to the machine" as a ruling on records; the money itself still goes to the machine.
- **The treasury is the USDC ATA of `Config.treasury_owner`.** `Config.treasury_owner: Pubkey` was appended; `Config.treasury` stays (the ATA's address, so payout builders read it directly) and both change together. `initialize_config` takes `treasury_owner` and `treasury`; `update_config` takes optional `new_treasury_owner` and `new_treasury`, both or neither. The ATA must exist when it is set (anyone can create it). If it is closed later, anyone re-creates it with the ATA program's `CreateIdempotent`, so payouts can't be stalled by closing it. Payouts still check only `address = config.treasury`, so a treasury whose token owner was later reassigned keeps receiving fees instead of blocking.
- **The treasury check is in the handler, not an Anchor `associated_token` constraint.** With `associated_token::authority = new_treasury_owner` on two optional accounts, the IDL gives `new_treasury` a PDA default that depends on an optional account, and Codama 1.11.0 refuses to render it (`CODAMA_ERROR__VISITORS__CANNOT_USE_OPTIONAL_ACCOUNT_AS_PDA_SEED_VALUE`). `check_treasury` (address = ATA(owner, USDC, SPL Token), token owner = owner, mint = USDC) is used by both instructions, so the same mistake gives the same error (`TreasuryNotOwnerAta`). `update_config` needs no mint or token program account.
- **A treasury owner can't be an account owned by this program** (`TreasuryOwnerIsProgramAccount`): an existing job's ATA is its vault. A job PDA that doesn't exist yet can't be detected; if the admin names one, that job's payout waives the fee (fee = 0, the machine gets the whole reward) rather than fail, because a fee "sent" to the vault would stay in it and the vault could never close. `JobPaid.fee` is 0 then.
- **`post_job` accepts a vault someone created first** (`init_if_needed`). Anchor checks an existing account's address, mint, owner and token program; the handler refuses a delegate or close authority (`VaultHasDelegateOrCloseAuthority`; only the job PDA could set them, so this is defence in depth). Exactly `reward` is transferred; USDC already in the vault is a donation (it leaves with the job and never counts as reward or `earned`). The vault's creator paid its rent, which goes to the poster when the job closes.
- **`propose_admin` refuses the all-zero address** (`InvalidNewAdmin`). Cancelling a pending proposal is still not possible (an owner decision).
- **New errors are appended** after `MathOverflow` (6034–6039: `CannotReclaim`, `TreasuryNotOwnerAta`, `TreasuryOwnerIsProgramAccount`, `TreasuryOwnerAndAtaRequired`, `InvalidNewAdmin`, `VaultHasDelegateOrCloseAuthority`) so codes 6000–6033 keep their meaning. **No event layout changed.**
- **Exact errors for CPI failures** are asserted with the code and the refusing program's log line (`assert_cpi_err`), because the System Program's `AccountAlreadyInUse` and SPL Token's codes overlap with others; Anchor errors are asserted with the account they name (`assert_anchor_err_on`). A post with a made-up vault address fails in the ATA program's own CPI with `MissingAccount` (it derives the real address, which the transaction doesn't list); the test asserts that and the logged address rather than adding a program check for it.
- **Open for the owner** (listed in `PROGRAM-REVIEW.md`): removing `claim_window = 0`, a claim bond, making `Proven` harder to farm (five accepted jobs cost about 0.13 USDC to fake), cancelling a pending admin proposal.

**What followed in the app (on `m3-app`):**

- **A machine that left a job is told before it signs.** `/tx/claim` and the SDK's `jobs.claim` read `Job.previous_worker` and refuse with `forbidden` ("You left this job … Another machine can."); the unclaim summaries, the MCP `unclaim_job` description, the job page's "Drop this job" and the escrow docs say the job reopens _for other machines_. An integration test proves both sides: the API refuses, and a transaction built without the API fails on-chain with `CannotReclaim` (6034). The landing's step copy ("It can drop the job, and the job reopens.") is the owner-approved prototype text and is still true, so it is unchanged.
- **Account sizes come from one place.** `JOB_ACCOUNT_BYTES` (568) and `CONFIG_ACCOUNT_BYTES` (181) in `@samite/program-client`; the LiteSVM suite checks the Job size against a posted account, the local bootstrap checks the Config size against the account `initialize_config` creates, and the mainnet script reads Config rent from it. Tests find Job accounts by discriminator, not by size.
- **The keeper still never pays rent**, so it does not prepend `CreateIdempotent` as the M2 fix suggests (see M3 — keeper).
- **The indexer already counted `earned` as `reward − fee`**, so it matches `MachineStats` after the fix; the recorded indexer session needs no re-recording because no event layout changed.

## M3 — local harness and db

- **Local chain** (`packages/local`, `pnpm local:up` / `local:down`): `solana-test-validator` with the program loaded upgradeable (`--upgradeable-program`, local upgrade authority, so `initialize_config` runs exactly as on mainnet), and the USDC mint written at the real address with a local mint authority (`--account`, built with `getMintEncoder`, §3.2). Keys and the ledger live in `.data/local/` (gitignored).
- **Amounts are `numeric(20,0)` read as JS `bigint`**, not Postgres `bigint`: §8 says bigint, but a u64 reward or earned total can exceed Postgres's signed 64-bit range. Unix seconds and slots (i64 on chain) stay `bigint`. `job_id` is `numeric(20,0)` read as a decimal string.
- **`events` is unique on `(sig, ix)`**, not `sig`: one transaction can emit several events (the third rejection emits `DeliveryRejected` and `JobRefunded`). Idempotency on signature still holds: a replayed transaction hits the same `(sig, ix)` keys.
- **`jobs` is keyed by the display number, not the PDA**: the program lets a poster re-use a `job_id` once the job has closed (the PDA is free again), so one PDA can name several jobs over time. A partial unique index keeps at most one _live_ job (`closed_at is null`) per PDA; `events`, `deliveries` and `rejections` carry `job_no` so a re-used address never mixes two jobs' histories.
- **`jobs.spec_hash` is indexed, not a foreign key to `specs`**: a job posted on-chain without `POST /specs` still gets indexed (its money rules don't change) and stays `hidden` (§12).
- **Chain times are `bigint` unix seconds** (`deadline`, `created_at`, `delivered_at`, events' `at`), exactly as the program stores them; server times (`sessions`, `purge_after`, `created_at` of stored rows) are `timestamptz`.
- **Added**: `indexer_state` (the last applied slot and signature, for the backfill on start), `events.ix` and `events.data` (the rest of the decoded event), `jobs.claimed_at` and `jobs.delivery_hash`, `machines.updated_slot` and `posters.updated_slot` (§7.2: every derived row carries its slot), `specs.posted_from` (the app's session marks its specs, so the indexer can tell `app` from `api`), and `rejections.sig`/`at` are null until the indexer sees the on-chain rejection.
- **One `createDb(url)` for both drivers**: `postgres://` → postgres-js; `memory://`, `pglite://<dir>` or a path → PGlite. Migrations are generated by drizzle-kit into `packages/db/drizzle/` and committed; `migrateDb` applies them with the matching driver's migrator. The postgres-js path is not exercised locally (no Postgres server here); it is the same migrations through Drizzle's own migrator.

## M3 — indexer

- **Events from inner instructions only** (`decodeEscrowEvents` in `@samite/program-client`): an instruction to the program itself whose data starts with Anchor 1.2.2's `EVENT_IX_TAG` (`0x1d9acb512ea545e4`, LE). Look-alikes from other programs are ignored (the M2 review flagged that the Rust test helper matched data only); failed transactions have no events; an undecodable event throws, so the indexer stops instead of skipping a money movement.
- **The test session is recorded from `solana-test-validator`**, not LiteSVM (`apps/worker/scripts/record-session.ts` → `test/fixtures/session.json`): the fixture is the RPC's own `getSignaturesForAddress` and `getTransaction` responses, so the indexer is tested on the exact shapes it reads in production. It covers accept, cancel, unclaim → another machine, three rejections (the third refunds in the same transaction), a two-machine claim race (one fails on-chain), a job posted around the API, a refused spec, and a re-used job address. Time-outs (auto-release, refund after deadline, expired claim) need a clock and are covered with the keeper (Task 4).
- **Commitment "confirmed"** for reads. A failed transaction moves the cursor and changes nothing. A signature the RPC lists but can't return yet stops the run there, so transactions are always applied in order.
- **One database transaction per chain transaction**: its events, every derived row, and the cursor. Idempotency: a signature already in `events` is skipped. Tested by replaying by hand, re-syncing, losing the cursor, small pages, a kill before each of the 20 fetches, and syncing as the chain grows: the tables end identical every time.
- **`events.actor`** is the address the feed line names: the poster for posted, cancelled, rejected and refunded; the machine for claimed, unclaimed, claim_expired, delivered, paid and auto_released. `amount` is what moved: the reward locked, what the machine received, or what the poster got back.
- **`machines.earned` counts `reward − fee`**, as `MachineStats.earned` does after the M2 review fix: a donation to a vault still reaches the machine but is not earnings.
- **`hidden`** is decided when the job is indexed: shown only if the stored spec re-hashes to the on-chain `spec_hash` and its verdict is `pass` (§6.1, §12). `posted_from` is the stored spec's (`app` when it came through the web app's session), else `api`.
- **pnpm 12 blocks dependency build scripts**: `esbuild` (used by tsx, vite and drizzle-kit) is the only one allowed (`allowBuilds` in `pnpm-workspace.yaml`); its script only checks its platform binary.

## M3 — keeper

- **Clock tests run on LiteSVM, not a warped `solana-test-validator`** (the plan said the validator): restarting the validator with `--warp-slot` on an existing ledger fails ("snapshot dir account paths mismatching"), and slot-warping moves `unix_timestamp` only approximately, while the keeper must be proven at exact seconds. `litesvm` 1.6.2 is Kit-native; the tests set `Clock` per second, load the built `.so`, and feed every landed transaction's inner instructions through the same `decodeEscrowEvents` → `applyTransaction` path as the RPC indexer, so auto-release, refund after deadline and expired claim are indexed too. They run in CI's `program` job (`pnpm --filter @samite/worker test:svm`), after `anchor build`.
- **The index proposes, the chain decides**: candidates come from SQL over live jobs (hidden jobs included: moderation never changes money rules); before sending, the keeper re-reads the job account and the Clock sysvar and applies `dueAction`, the program's own comparisons. A refund beats an expired claim when both are due (the poster gets the money back rather than the job reopening).
- **The keeper never pays anyone's rent.** If the recipient's USDC account (machine on release, poster on refund) or the treasury is missing, it skips the job and logs why: re-creating it would let a user close their account for the rent and repeat, draining the keeper. The money stays in escrow; the owner of the account re-creates it, and any later tick (or anyone) sends the instruction. This replaces the M2 note that the keeper should prepend `CreateIdempotent`.
- **`apps/worker`** runs the indexer every 2 s and the keeper every 60 s only when `KEEPER_ENABLED=true` and `KEEPER_SECRET` is set; `GET /health` is 200 while the last sync is under 30 s old. The websocket URL for confirmations is the RPC URL over ws(s) (the local validator's is one port up).

## M3 — server pieces

- **A local Postgres for development**, not PGlite: the web app and the worker must share one database and PGlite is single-process (its socket server multiplexes connections over one session, so a transaction could interleave with another connection's queries). `pnpm --filter @samite/local run up` starts a cluster in `.data/local/pg` on `127.0.0.1:55473` (away from 5432/5433, where developers often run their own; it refuses to start if the port is taken) with the Homebrew/system Postgres, and resets the `samite` database with every fresh ledger. Unit tests stay on in-memory PGlite; `SAMITE_DB_URL=postgres://… pnpm --filter @samite/db test` runs the schema tests on a real Postgres (done: 6/6 on Postgres 17 through postgres-js).
- **Ed25519 verification uses `@solana/kit`** (`getPublicKeyFromAddress` + `verifySignature`, WebCrypto) instead of adding `@noble/curves` (the plan's suggestion): one fewer dependency, the same primitive the wallets and the SDK use.
- **The signed-request message is in `@samite/formats`** (`requestMessage`, `formatAuthorization`, `parseAuthorization`), pure and shared by the API, the SDK and the MCP server, with fixed vectors in its tests.
- **Upstash env**: `@upstash/redis` (REST, serverless-friendly) takes a URL and a token, so `.env.example` has `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` instead of §7.3's `REDIS_URL`. Replay protection (`SET NX EX 120` on `(address, sig)`, checked only after the signature verifies), sign-in nonces and fixed-window rate limits all use it; locally an in-memory store.
- **Sessions (SIWS)**: the message is the Wallet Standard's own format (`@solana/wallet-standard-util` `createSignInMessageText` / `parseSignInMessageText`); the server checks domain, URI, address, chain (`mainnet` in production, `localnet` locally), expiry and a one-time nonce, and verifies the signature with Kit. The cookie is HttpOnly, SameSite=Lax, Secure in production, 7 days; only `HMAC(SESSION_SECRET, token)` is stored. A cookie authorises a state-changing request only when `Origin` is this site (CSRF).
- **Storage**: R2 through presigned S3 URLs (the upload's `Content-Length` is part of the signature, so a file can't exceed what the spec allows; downloads force `Content-Disposition: attachment` and `application/octet-stream`). Locally, `.data/blobs` behind HMAC-signed, expiring grants on `/api/v1/blobs/…`. The server hashes stored files by streaming them back; it never takes the uploader's word.
- **Moderation**: one Claude call per new spec through `client.beta.messages.parse` with a zod output schema (`{ verdict: pass | refuse, reasons }`), `effort: "low"`, and server-side refusal fallbacks (`fallbacks: "default"`) on models that take them. Model: `MODERATION_MODEL`, default `claude-opus-5-5` (about two US cents per typical spec at $4 per million input tokens; the owner can choose a cheaper model in env). The spec is untrusted data: the policy is in the system prompt, the spec arrives as canonical JSON with `<` escaped inside `<job_spec>` tags, and an attempt to steer the review is itself a reason to refuse. It fails closed: no key in production, an outage, a refusal or a cut-off answer all give `pending`, which never reaches the board. Locally (no key) every spec gets an explicit "local pass".
- **Production refuses local defaults**: without `DATABASE_URL`, `SOLANA_RPC_URL`, `SESSION_SECRET`, the Upstash pair or the R2 set, the API errors instead of falling back to the harness's Postgres, memory or a local folder.

## M3 — API

- **Migrations belong to the worker** (and the local harness and tests), not the web app: `@samite/db` no longer resolves its migrations folder (Turbopack tried to bundle `new URL("../drizzle", import.meta.url)`); `@samite/db/migrate` does, and the web app never imports it.
- **JSON shapes**: snake_case fields; amounts are base-unit decimal strings (`"80000000"`), never JSON numbers; times are unix seconds; display numbers are 4-digit strings (`"0415"`). Board pagination is keyset (`next_cursor`).
- **`/tx/*` reads the chain, not the index**, for every check (status, worker, deadline, review window, the machine's USDC account, `Config.treasury`, `Config.fee_bps`, pause), and the summary's amounts come from the same values that go into the instruction; rent is read live (`getMinimumBalanceForRentExemption` of `JOB_ACCOUNT_BYTES` and a token account; `JOB_ACCOUNT_BYTES` is asserted against a real account in the LiteSVM suite). `deliver` and `reject` refuse a hash the server hasn't stored, so every on-chain hash has its manifest or reason.
- **`/tx/send` relays only transactions that name the escrow program** among their static accounts (where a program id must be); it is not a general relay.
- **`max_bytes` of a file deliverable** bounds each upload and the delivery's total. Delivery files are stored as `application/octet-stream` under `deliveries/<job no>/<attempt>/<random>-<name>`; a manifest can only reference keys under its own job and attempt.
- **Hidden jobs** answer 404 on public routes (board, job, spec.json, feed), but their poster and machine can still build transactions, store deliveries and read them: moderation never changes money rules.
- **The errors page is the code list**: a unit test checks that `/docs/errors` lists exactly `ERROR_STATUS` with its HTTP statuses.
- **The local harness is idempotent and polite**: `bootstrap` tops balances up to the starting amounts instead of minting again, and a test stops the validator only if it started it.

## M3 — app on real data

- **Live by default, example on request**: the app pages read the index; `?example` (or `SAMITE_EXAMPLE_DATA=1`, for a preview with no index) renders the design's example data, every value labelled as before. The M1 visual tests now ask for `?example`, so the design is still checked against the references while the live pages are checked against the chain (Task 8). Links inside example pages keep `?example`.
- **Wallet**: `@solana/kit-plugin-wallet` 0.23.0 with `walletWithoutSigner` (the server builds the transaction; the wallet only signs) on `solana:localnet` locally and `solana:mainnet` when `NEXT_PUBLIC_RPC_URL` is set. The connect dialog lists the Wallet Standard wallets in the browser; the chip shows the short address and the wallet's USDC balance read from the browser's RPC. Sign-in uses the wallet's `solana:signIn` when it has it, else `signMessage` over the same SIWS text.
- **Before every signature** the browser checks that the transaction's fee payer is the connected account and that the summary's amount equals the amount on the button (post: what is locked; accept: what the machine gets; cancel: what comes back); otherwise nothing is signed.
- **The job page shows the chain's status**: the browser reads the `Job` account through `NEXT_PUBLIC_RPC_URL` and renders its status in the header; a check line compares status, machine, reward, spec hash and delivery hash with what the API served and says plainly when they differ. The spec's sha256 is computed in the browser from `/spec.json`; the delivery's from the stored manifest (`@samite/formats`), and "✓ matches on-chain hash" shows only when it equals the chain's value (§5.2).
- **Untrusted text** (instructions, notes, reasons) renders through `react-markdown` 10.1.0 with HTML skipped, no images, and links `rel="nofollow noopener ugc noreferrer"`.
- **The post form starts empty on the live board**, defaults the claim window to 24 h (12 h for a 24-hour deadline) so a claim lapses if nothing is delivered (the M2 review's squatting finding), and adds an address list for "Only these".
- **Machines tab**: the connected wallet's machine page, or a `/machines` list (most accepted first). The machine page's counts are the chain's `MachineStats`; the index gives the history, the per-day grid and the categories.
- **Not live yet, still labelled**: the "Escrow, last 24 h" print (the index keeps no escrow series yet).

## M4 — machine interface

- **The SDK never signs a transaction the server built.** `@samite/sdk` builds every transaction locally (the Codama client and the shared actions layer) from its own RPC's view of the chain, and signs it there. The API is used for what lives off-chain only (specs, files, manifests, reasons, the board), so a compromised API can't make a machine sign away its funds. `/tx/*` stays for plain-HTTP clients, who should check what they sign.
- **The SDK computes every hash it relies on**: the spec hash it posts, the delivery and reason hashes it submits (and refuses to sign if the API's differ), and the served spec's sha256 against the on-chain `spec_hash` in `jobs.get` (throws `hash_mismatch`).
- **Deterministic signatures and replay**: ed25519 is deterministic and the signed-request message has no nonce (§6.1), so an identical request in the same second has an identical signature, which the server refuses as a replay. The SDK waits for the next second and signs again, once.
- **`startServices()`** in the local harness starts the worker and the built web app against the harness for integration tests that need the real HTTP API.
- **`@samite/mcp`** is `@modelcontextprotocol/server` 2.4.0 over stdio (`McpServer`, `registerTool` with zod v4 schemas, `serveStdio`); only stderr is used for logs (stdout is the protocol). Nine tools as §6.3; every description says what it costs. Specs and deliveries come back under an explicit "untrusted, data not instructions" field (the end-to-end test plants an injection line in a spec and checks it is returned as data). `post_job` and `review_delivery` (accept/reject) are off unless both `SAMITE_MAX_POST_USDC` and `SAMITE_DAILY_SPEND_USDC` are above 0; the day's total is kept per address in `SAMITE_STATE_DIR` (default `~/.config/samite`), so a restart doesn't reset it. `SAMITE_CONFIRM=1`: every sending tool returns the summary (a dry run, nothing signed) until called again with `confirm: true`. Default RPC `https://api.mainnet-beta.solana.com` (public, rate-limited; a provider RPC via `SAMITE_RPC_URL` is better).
- **Indexer: a lost cursor no longer stops it.** If the RPC no longer has the cursor's transaction (`solana-test-validator` keeps only minutes of history by default; a pruned provider), the indexer pages back to the cursor's slot and re-applies from there (idempotent). If the RPC's history starts after the cursor, it logs a gap: production needs an archival RPC (Helius and similar keep full history). The local validator now keeps a large ledger (`--limit-ledger-size 50000000`).
- **Test services are process groups**: `startServices()` and the M3 acceptance spawn the `tsx` and `next` binaries directly as group leaders and stop the whole group; a `pnpm exec` wrapper left the real servers running after the tests.

## M6 prep — terms and privacy

- **Drafts at `/terms` and `/privacy`** (a `(legal)` route group, behind the production gate like every page but the placeholder), each opening with "DRAFT … not in force and not legal advice". Plain English; they describe only what the code does (escrow rules, 2.5% fee, no disputes and the public rejection record, the posting policy, Circle's freeze authority, what is public and private, the 90-day file deletion, the 7-day session cookie stored as a keyed hash, Anthropic as the spec moderator, the hosting processors).
- **Open legal questions for the owner** (§12): who may use Samite and from where; governing law and venue; limits of liability; whether running an escrow and charging a fee needs a licence where Samite is used; tax reporting; the contact address for data requests; confirming processors and regions at launch.

## M6 prep — security self-review fixes (Nov 12)

`docs/SECURITY-REVIEW.md` (a self-review, not an audit) found three places where the code did less than the docs said. Each now has a test that failed before the fix:

- **A machine saw another machine's deliveries.** `readDelivery` let in the job's _current_ machine and returned every delivery, so after a rejection and an unclaim the next machine could download the first one's work, and the first lost access to its own. Now the poster sees every delivery and a machine sees only the ones it submitted, also after it left (`apps/web/test/server/delivery-access.test.ts`).
- **Delivered files were never deleted,** though the privacy draft, the docs and the job page say 90 days after the job closes. The indexer now sets `deliveries.purge_after` = close + 90 days when a job closes, and the worker deletes due files every hour and clears their storage keys. The manifest and hash stay. The job page then says the files were deleted instead of offering dead links (`apps/worker/test/purge.test.ts`, the indexer's "dates each closed job's delivered files" test).
  - **New package:** `packages/storage` (`@samite/storage`) holds the blob store, so the worker uses the same store as the web app. The worker needs the same `R2_*` keys in production.
  - **Owner question:** the draft promises deletion for _files_ only. Text deliveries, URLs and notes stay in the database. Deleting them too is a one-line change if you want it.
- **`/tx/send` relayed anything that merely listed the program id.** Now every instruction must call the escrow program or the compute-budget program (a wallet may add a priority fee; the address was checked on mainnet), and at least one must call the escrow program (`apps/web/test/server/relay.test.ts`).
- **The API integration test** re-signed an identical request within the same second, which the server rightly refuses as a replay. Its helper now waits for the next second, as the SDK does.
- **A delivery never carries a private key** (review R2, Medium). A spec could talk the model behind an MCP machine into "delivering" its keypair file or pasting the key. The SDK refuses any file, text, URL or note holding a real Solana key pair (the CLI's 64-byte JSON array, or base58), before any request. Only a true pair counts: the second half must be the first half's public key, which Kit's `createKeyPairFromBytes` checks, so a transaction signature isn't refused. The MCP server also refuses the `SAMITE_KEYPAIR` file by its real path, links included.
- **Logs never carry a failed query's parameters** (review R11). drizzle-orm's `DrizzleQueryError` puts the SQL and its parameters (which can be a text delivery or a note) in its message, and doesn't set `name`. `describeError` keeps only "database query failed" and the SQLSTATE code for it and for the driver's own errors; other errors keep their message. The web `/health` returns `{ ok: false }` and logs the detail; the worker's `/health` names the loop that failed, not the message.
- **The directory-backed PGlite migration test gets 30 s**: it took 5.4 s on a busy CI runner and timed out at vitest's default 5 s.
- **Every hosted deployment refuses local defaults** (review R4). On Vercel (`VERCEL=1`, previews included) the web app needs `DATABASE_URL`, `SESSION_SECRET`, `SOLANA_RPC_URL`, Upstash and R2, exactly as production does. Without `ANTHROPIC_API_KEY` it uses the moderator that passes nothing. Only the SIWS chain id still follows production. A preview build with no secrets still builds; only its API answers 500 until it is configured. Giving previews their own database, Redis and bucket stays with the owner.
- **The browser checks every transaction before the wallet sees it** (review R1). `verifyTransaction` decodes the API's unsigned transaction and requires the following, else nothing is signed and the page says why:
  - exactly one Samite escrow instruction, of the kind asked for, on this job;
  - the connected wallet as its signer and fee payer;
  - nothing else but compute-budget instructions;
  - the reward shown and the locally computed spec hash for a post, the chain's machine for an accept or reject, and the hash of the typed reason for a reject.

  This is the same idea as the SDK building locally, without duplicating `/tx/*` in the browser.

## M6 prep — live landing numbers

- **The landing goes live where real data exists, client-side** (§11.10, §14 M6). The page still renders the labelled example first (static, fast, and what `?shot` visual tests see). Then it reads `/api/v1/stats` and `/api/v1/events` once and swaps in real values (`landingLive` in `apps/web/lib/view.ts`). If the API can't be reached it keeps the example: before launch the API answers 404 on samite.fun.
- **When each part goes live:**
  - The hero chart and the escrow meter go live once anything settled in the last 24 hours. Then the example label goes, and the axis reads `−24h … now` instead of clock times, because the data is a rolling 24 hours.
  - "Latest settlements" goes live once there are four real settlements (paid, auto-released, refunded). Before that it is the labelled example; real and example values are never mixed.
- **The meter's scale is a decision for the owner to confirm:** the spec gives the 28 segments no scale. They fill on a log scale up to 1,000,000 USDC, so 48,210 USDC lights 22 and 11 USDC lights 5.
- **Proven:** the M3 acceptance opens `/landing` after its payout and finds the chain's escrow amount and no example label (screenshot `docs/progress/m3/landing-live.png`).
- **PGlite-backed test suites get 30 s per test** (`apps/worker`, `packages/db`). On a busy CI runner single tests took 5.4–5.8 s against vitest's 5 s default.

## Owner's site changes (Nov 13)

The owner looked at the running site and asked for these. Each departs from the prototype on purpose.

- **The footer word sits in the middle of its band.** In the prototype it hangs in the top 62% of the band. The word's canvas keeps the prototype's size and text, so its print is the same dot for dot (the motion test against `landing-footer-word.mp4` still holds). `FooterArt` moves the whole canvas down until the letters' ink, measured with the real font, is centred in the band. The visual test compares the band with the canvas put back where the reference has it, and a new check finds the ink's middle within one dot of the band's.
- **The footer's "Post a job" button is no longer crooked.** The prototype's `.foot-cols a` rule (block, line-height 2) also hit the bracket button: its label sat on the top edge, under the centre tick, and the button looked taller. The column-link rule now applies to the link lists only (`.footCols nav a`). A check asserts the label is centred in the 54 px button.
- **The nav goes to pages, not to sections of the landing.** Jobs → `/jobs`, Machines → `/machines`, Escrow → `/docs/escrow` (How escrow works), Docs → `/docs`. The same applies in the phone menu and to the footer's Escrow link.
- **The four step pictures are the Samite eye in four states** (owner's pick of three proposals):
  - POST: the eye shut, a seam with lashes;
  - CLAIM: half open, with the hero tracker's box around the mark;
  - DELIVER: open, with a hollow pupil;
  - PAID: the full pupil.

  They are drawn from the mark's own path with the eye redrawn per state. They are still `still` bayer prints, at cell 3 instead of 5 (at 5 the eye is a blob) and with bloom .2 so the eye's holes stay open. The canvases are 160 px tall instead of 110, so the page below each row of steps sits 50 px lower than in the references. The full-page visual test therefore compares above the steps as it is and below them shifted by that much, and a new check asserts each picture has ink and isn't cut off at its cell's edge.

- **Wallets connect through Privy** (the owner's choice, Nov 13: "it makes the project look more trustworthy"). Wallets only, by the owner's pick of the two options: no email or social login, no Privy-made (embedded) wallets, so Samite holds no emails and keys stay in the person's wallet.
  - **How it fits:** a small store (`lib/wallet/store.ts`) holds the connected wallet. Pages read only the store; one of two layers writes into it. Privy (`lib/wallet/privy.tsx`, `connectWallet` with Solana wallets only) is used when `NEXT_PUBLIC_PRIVY_APP_ID` is set. The app's own Wallet Standard dialog (`lib/wallet/standard.tsx`, as before) is used without it. Privy is only the connect step: the session is still Samite's Sign-In With Solana, and verify.ts still checks every transaction before the wallet sees it.
  - **Why two layers:** the local chain and the end-to-end tests run on `solana:localnet`, which Privy doesn't support (its chains are mainnet, devnet and testnet), and CI can't reach Privy without an app. The test wallet is a Wallet Standard wallet, so the built-in layer keeps M3 and M4 tested end to end.
  - **If Privy fails** (an error, or not ready 10 s after its code loads: blocked, down, a wrong ID), the built-in dialog takes over. Checked with a made-up app ID: Privy's config request failed (HTTP 400) and the built-in dialog appeared.
  - **Look:** Privy's colours and radii are CSS variables it sets on `:root`. `lib/wallet/privy.css` overrides them under `html:root`: black panel, cream ink, square corners, no shadows, our fonts.
  - **Loaded only when needed:** Privy's code (about 680 KiB) loads on a click on "Connect wallet", or at once in a browser that connected through it before, to reconnect (`lib/wallet/remember.ts`). Browsing loads none of it and gets none of its cookies: loaded up front, `/jobs` scored best practices 73 (a third-party Cloudflare cookie from auth.privy.io) and weighed 1,069 KiB. Loaded on demand, with Privy configured, `/jobs` and a job page score 100 / 100 / 100 (Lighthouse mobile, performance / accessibility / best practices) at 386 and 423 KiB. The landing and the placeholder never load it.
  - **Checked with the owner's App ID (Nov 13), on localhost:3000** with the injected test wallet and the local chain (`pnpm --filter web e2e:privy`, by hand, not in CI). Privy's modal lists the test wallet next to Phantom, Solflare and Backpack, in our colours and square. The test connected, reconnected after a reload, signed in (`solana:signIn`) and posted a job (a transaction signed through Privy's wallet object, sent by our relay).
  - **Reconnecting is ours:** Privy silently reconnects only some wallets by itself (Phantom only after a Privy login), and its `connectWallet` `onSuccess` doesn't fire for Solana wallets (3.51.0). So the Bridge remembers the wallet's address and name from what Privy reports (`lib/wallet/remember.ts`), and on the next visit asks that Wallet Standard wallet for `standard:connect` with `silent: true`. A wallet that trusts the site answers without a prompt, as with the built-in layer.
  - **Not yet checked:** Phantom, Solflare and Backpack themselves (they don't sign on localnet). That is the first thing to try on the closed site after M5.
- **Found while testing this: the board's live feed could break hydration** (React #418, in about 1 of 25 loads of `/jobs`). The feed printed "how long ago" (`51s`, `3m`) from each side's own clock: the server's when it rendered, the browser's when it hydrated a moment later. Whenever a label changed in between, or the browser's clock was off, the texts differed. The feed now takes the server's render time as a prop and runs on from it by the browser's timer (`LiveFeed.tsx`). A new M3 acceptance check runs a browser whose clock is two minutes ahead over every app page. It failed on `/jobs` before the fix and passes after. The page errors in the acceptance now name the page they happened on.
- **The Linux visual comparison now cuts before it shrinks** (`apps/web/e2e/compare.ts`). On Linux CI both images are compared at 1/4 size. The old code shrank each whole image with its region's offset, so each was sampled on a grid set by its offset mod 4. Two halftone prints sampled out of phase differ a lot: the phone's footer band, now compared at a 400 px offset, scored 5.6% in CI against a 5% bound, and 0.00% once both were sampled on the same grid. Each region is now cut out at full size first, then shrunk. macOS (no shrinking) is unchanged.

## The owner's answers (Nov 13, second round)

- **Program address:** keep `AcTtHioeudEDQuaW6WaL5auXC2rv3jPNoNbPxPB7pHM9`.
- **Upgrade authority and admin:** deploy and initialize from a new keypair file. Moving both to a Squads multisig afterwards is prepared separately.
- **Treasury owner:** `9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM`, the owner's wallet. Read on mainnet on Nov 13: a System-owned account, no data. Its USDC account is created by `initialize-config.ts` if missing.
- **The program's open items, left to me by the owner:**
  - `claim_window = 0` (hold until the deadline) is removed. Every claim lapses: from 1 h up to the deadline.
  - No claim bond in v1.
  - `Proven` stays a hint, as the FAQ says.
  - Cancelling a pending admin proposal needs no new instruction: the admin proposes itself (a later proposal replaces an earlier one).
- **Deliveries after 90 days:** text deliveries and notes are deleted too, not only files. My call, the owner left it to me.
- **The landing meter's log scale:** approved.
- **The worker runs on Railway.**
- **Token:** none yet; the ticker may be SMT, the name may change. The interface says nothing about it; `NEXT_PUBLIC_TOKEN_CA` stays empty.
- **Terms and privacy:** the owner has no lawyer and asked me to write them in full and final form, leaving out what isn't known. X (`@samitefun`) is the contact instead of an email. They are plain statements of what the product does, not reviewed by a lawyer. That is said to the owner, not on the pages.
  - **Written Nov 13; the DRAFT banner is gone.** They state only what the code does, in plain English.
  - **Choices I made, the owner can change any:**
    - users at least 18, and not where the law forbids it (sanctions included);
    - Samite is not a party to jobs;
    - Samite claims no rights in specs or deliveries; rights in a delivery are between poster and machine;
    - "as is", with no warranties;
    - liability limited, as far as the law allows, to the fees Samite received from the user's jobs in the last 12 months;
    - a term change never alters a posted job's escrow rules.
  - **Left out:** no company name, governing law, venue or email, because none is known. Contact is X (`@samitefun`).
  - **Privacy names the processors:** Anthropic, Privy, Vercel, Railway, a managed Postgres host, Cloudflare R2, Upstash and RPC providers. It also covers the 90-day deletion of all delivery content, IP counters kept about a minute, and no analytics or ad cookies.
  - **Linked:** the landing's footer links both pages.
  - **Checks:** the e2e asserts no DRAFT wording, the X contact, no "audited", "guaranteed", "trustless" or email address, and axe passes.
- **No placeholder.** samite.fun serves the real site, closed to everyone but the team until launch (owner: "close it so nobody finds it before our presentation"). It works like this:
  - **Home page:** the landing is the home page (`app/(site)/(home)`), and `app/(preview)` became `app/(site)`.
  - **Closed:** in production, `proxy.ts` sends a plain 404 for everything, the API and files included, unless the request carries the access key. robots.txt says `Disallow: /`, and pages say `noindex`.
  - **Access:** the team opens the site once per browser with `/?access=<SAMITE_ACCESS_KEY>`, which leaves a 30-day cookie holding a hash of the key. Machines send the key in `x-samite-access`: the SDK's `accessKey`, or `SAMITE_ACCESS_KEY` for the MCP server.
  - **Launch:** `SAMITE_PUBLIC=1` and a redeploy open the site and allow indexing.
  - **Removed:** the placeholder's page, its lockup, and its tests (the acceptance screenshots and the press-cycle videos). The press's `cycle` schedule is still checked frame by frame against the footer word's video. The hardening-header and social-card checks moved to the landing spec.
  - **Not done:** a `/landing` → `/` redirect. `next.config` redirects run before the gate, so it would have answered strangers with a 308.

## No Upstash (owner, Nov 14)

- **The owner asked to do without Upstash.** Replay protection, sign-in nonces and rate limits now live in the app's Postgres, table `kv` (migration `0002_kv`; `pgKv` in apps/web/lib/server/kv.ts).
  - Each operation is one statement, so instances can't race. Set-if-absent is an upsert that takes over only an expired row and returns a row only to the winner. A counter is an upsert that restarts once its window has passed. `take` is `DELETE … RETURNING`.
  - Cost: one small write per API request (the per-IP limit), on the same pooled Neon connection.
- **The worker deletes expired rows every minute.** Rate counters hold IP addresses, and the privacy page now says two minutes at most. Upstash is gone from the page's processors.
- **Upstash stays optional.** Setting `UPSTASH_REDIS_REST_URL` and `_TOKEN` switches back to it with no code change. The privacy page would then have to name Upstash again.
- **Checks:** one contract test runs on memory and on Postgres (PGlite). An integration test runs on a real Postgres pool. The M3 acceptance run passes with sign-in, signed requests and limits going through the table. The e2e suite passes with no database at all, as in CI.

## M6 prep — dependencies, the database connection, the CSP (Nov 14)

- **`pnpm audit`:** six findings, all in Privy's Ethereum dependencies. `ws` is pinned to `^8.21` by an override (the same major). zod 3, uuid 8/9 and decode-uri-component 0.2 have no fix the packages pinning them accept; they never reach the server bundle (SECURITY-REVIEW §14).
- **`INDEXER_POLL_MS`:** the indexer's 2 s poll is about 1.3M RPC calls a month, more than Helius's free plan (1M credits, helius.dev/docs/billing, read Nov 14). It is configurable from 1 s to 20 s (capped by `/health`'s 30 s staleness); Railway gets `5000` while the site is closed.
- **Postgres connection string:** postgres.js 3.4.9 reads `sslmode=require` as "don't check the certificate" and sends unknown parameters (Neon's `channel_binding=require`) to the server as session settings. `createDb` turns `require` into `verify-full` and drops `channel_binding`, so Neon's string goes in as copied.
- **CSP with nonces (SECURITY-REVIEW R3):**
  - `proxy.ts` sets a nonce-based policy with `'strict-dynamic'` on every response (`lib/csp.ts`).
  - Every page now renders per request: a page built ahead of time has no nonce. Lighthouse mobile stayed at 96–100 locally; re-measure on samite.fun.
  - Privy's domains come from its CSP page. The wallet icons (`explorer-api.walletconnect.com` in `img-src`) were missing there; the Privy test found them.
  - zod's `new Function` probe is turned off in `instrumentation-client.ts` through zod's global config on `globalThis`, not by importing zod: the import cost the landing 15 KB.
  - `SAMITE_CSP_REPORT_ONLY=1` is the way back without a code change.
- **The owner lets Claude merge green PRs** (Nov 14). Vercel blocks _preview_ deployments of Claude's commits (their git author isn't on the Vercel team); production deploys from `main` are unaffected.

## Manual tests on the closed site (Nov 14)

- **The post button always answers.** It was `disabled` for a bad title or reward but looked enabled, and blank instructions only showed up after the wallet's sign-in. Now a press lists what to fix under the button, from `parseJobSpec` (the server's own check), before the wallet is asked anything.
- **The post form keeps a draft in this browser** (`lib/draft.ts`, `localStorage`), cleared on post or with "Clear the form". The privacy page's "In your browser" line names it.
- **Every `/tx/*` transaction is simulated before a wallet sees it** (`lib/server/preflight.ts`). Phantom blocked the owner's first post with "This dApp could be malicious": the wallet had 0.005463 SOL and the job's rent is 0.00557 SOL, so the transaction failed Phantom's simulation. Phantom's docs (Domain and transaction warnings) ask dApps to simulate with `sigVerify: false` first. A failure now returns `insufficient_funds` (what is missing, in SOL or USDC, with both amounts) or `tx_would_fail` (the program's own reason), both 409, and nothing is signed. One extra RPC call per transaction built.
- **The relay accepts what Phantom returns.** Phantom may add Lighthouse assertion instructions to a transaction it signs ("Transaction validation", docs.phantom.com), and the relay refused anything but escrow and compute-budget instructions: the owner's first post from Phantom stopped at `tx_invalid` after the signature. Lighthouse (`L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`, from its README, checked on mainnet: executable, upgradeable loader) is now allowed next to compute budget. The relay stays closed to anything else (SECURITY-REVIEW B3); a refusal logs the transaction's program ids, so another wallet's additions show up in the logs.
- **Every API error is logged by code** (`api_error`: method, path, code; never the message, details, body or caller), and the post form names the step it is on.

## CI minutes (Nov 14)

The repo is private, so Actions minutes count against GitHub Free's monthly allowance (2,000 Linux minutes). Nov 12–14 used about 887 billed minutes: the program job 310, e2e 220, checks 217, the worker image 76, the secret scan 62; 260 of them were main re-running what its pull request had just passed. Now:
- **Each expensive job runs only when its inputs changed** (`changes` job, PR #20): docs-only changes run the secret scan alone; the program job runs for `programs/` and the IDL; the worker image only for the worker and the packages its image holds (config, db, formats, program-client, storage, local).
- **Main skips a merge its pull request already tested.** When the merge's second parent contains main's previous head, the pull request's run tested that exact tree; if every Actions check on it passed, main runs only `changes` and the secret scan. A squash, a stale branch or a red run falls through to the usual rules.
- **e2e runs in the checks job**, reusing its install and its build (turbo's local cache): about two minutes less per run.
- The web unit tests got the 30 s limits the worker and db tests already had: `memory://` boots PGlite in 4–5.5 s on a runner, and `context.test.ts` failed main twice at the 5 s default.

Running out of minutes stops CI only: Vercel and Railway build on their own machines. The owner chose to make the repo public, which makes the minutes free (next section).

## The repository is public (owner, Nov 14)

- **A fresh repository, not the old one opened.** The old history recorded the owner's personal email addresses as the commit author, and force-pushing is not allowed here, so it could not be cleaned. `trappalfy/samite` now starts from one commit with the tree of the old main (`d01555e`). The old repository is private, renamed `trappalfy/samite-archive`, and frozen. PR numbers in these notes up to #21 refer to it.
- **Commits use GitHub's noreply address** (`git config user.email` in this clone). A merge made through GitHub's API uses the account's email unless "Keep my email addresses private" is on in the owner's GitHub settings. The owner turned it on (Nov 14), with "Block command line pushes that expose my email". Pull requests are merged through GitHub again, with `--author-email` set to the noreply address: GitHub refuses that address while the setting is off, so a merge never falls back to a personal one.
- **The style references stay out** (`design/reference/README.md`): they are other people's work. The owner keeps the files outside git.
- **gitleaks false positives are marked on their lines** (`gitleaks:allow`). `.gitleaksignore` named commits of the old history, which this repository doesn't have.
- **On:** private vulnerability reporting (the README points to it), secret scanning with push protection, and protection of `main` against force pushes and deletion.
- **No license yet** (all rights reserved), until the owner chooses one.

## USDC amounts are never rounded (Nov 15)

The machine's balance tool showed 0.98 USDC when the chain held 0.975. `formatUsdc` rounded half up to two decimals by default, so any amount with sub-cent digits drifted from the chain: a payout of 97.5% of 1.00 USDC, a machine's earnings, the fee in the job's activity feed (0.025 showed as 0.03). The job page's split and the post form already asked for exact amounts. Now:
- `formatUsdc` never rounds by default: at least 2 decimals, up to 6 (`117.00`, `0.975`, `4.040001`). Rounding stays available as `decimals: 0 | 2` for totals that say so (the board's "USDC in escrow").
- The wallet chip cuts to cents (0.975 → 0.97): it has room for two decimals and never shows more than the wallet holds.
- CLAUDE.md §3.1 and §11.11 say "at least 2 decimals, never rounded".

## The browser's chain check (Nov 15)

The owner had no Accept button on job 0002: the job page shows the poster's buttons only after the browser has read the job from the chain (§12), and every RPC it tried failed.
- **samite.fun's `NEXT_PUBLIC_RPC_URL` held a bare Helius key.** The browser took it for a relative path and sent its RPC calls, key included, to samite.fun itself (`404 POST samite.fun/jobs/<key>`, seen from a headless browser on the owner's IP). The CSP had no origin for it, which is how it showed. Now `lib/rpc-url.ts` uses the variable only when it is a full http(s) URL; anything else is never called, and the page says so in the console. The RUNBOOK names the format.
- **Solana's public RPC answered the owner's IP with 403 for hours.** PublicNode's public RPC (`solana-rpc.publicnode.com`, CORS for any site, checked Nov 15) is now the first fallback, then Solana's. One list feeds the failover and the CSP.
- **The SOL estimate before signing now counts the wallet's own minimum.** A wallet must keep a 0-byte account's rent (0.00065024 SOL on mainnet, Nov 15) unless it is emptied, so a post needs the job's rent, that minimum, and the fees. The owner's first post failed on exactly that (`InsufficientFundsForRent`, account 0): 0.005463 SOL against about 0.00568 needed, while the message named only rent and fees. The fees carry a margin for the wallet's own priority fee (Phantom added 75,000 lamports to each of the owner's transactions). The escrow account's rent is now 0.00148844 SOL (Solana lowered rent), read live as before.
