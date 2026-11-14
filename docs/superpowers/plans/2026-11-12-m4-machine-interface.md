# M4: Machine interface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A machine does the whole flow (find → get with spec-hash check → claim → deliver files → get paid after the poster accepts) three ways: `@samite/sdk`, `@samite/mcp` driven by an MCP client, and plain HTTP with local signing.

**Architecture:** `@samite/sdk` signs requests (§6.1) and **builds every transaction locally** with the Codama client and the shared actions layer (`@samite/program-client` `actions`), reading state from its own RPC; it never signs a transaction the server built, so a compromised API can't make a machine sign away its funds. The API is used only for what lives off-chain (specs, files, manifests, reasons, the board). `@samite/mcp` is a thin stdio server (`@modelcontextprotocol/server` 2.4.0: `McpServer`, `registerTool` with zod v4, `serveStdio`) over the SDK, with the §6.3 spending guards. Logs go to stderr only (stdout is the protocol).

**Spec:** CLAUDE.md §6.2, §6.3, §9.2, §13 "MCP", §14 M4.

## Global constraints

- Local only for tests (the M3 harness: validator + Postgres + worker + web). Never a public cluster.
- Every method that sends a transaction returns `{ signature, summary }` and takes `dryRun` (summary only, nothing signed).
- Specs are untrusted input: tool descriptions say so; spec text is returned as data, never as instructions.
- `post_job` / `review_delivery` disabled unless `SAMITE_MAX_POST_USDC > 0`; per-UTC-day cap `SAMITE_DAILY_SPEND_USDC` (default 0 = no posting); `SAMITE_CONFIRM=1` makes every sending tool return the summary first and require a second call with `confirm: true`.
- Publishing to npm waits for the owner (§16): both packages stay `private`.

### Task 1: `@samite/sdk`

`createSamite({ api, rpc, signer })`: `jobs.find/get/claim/unclaim/post/cancel`, `deliveries.submit/get`, `reviews.accept/reject`, `mine()`, `balance()`. `get` hashes `/spec.json` and compares with the on-chain `spec_hash` (throws on mismatch). Tests: unit (request signing, summaries, dry run, spec mismatch with a lying fake API); integration on the harness (a machine claims, delivers a file, is paid; a machine posts and reviews).

### Task 2: `@samite/mcp`

Tools per §6.3 with costs in their descriptions; guards; two-step confirm. Unit tests through an in-process client; the §13 end-to-end test: a scripted MCP client spawns the server over stdio, finds a job, claims it, delivers a file and gets paid after a scripted accept.

### Task 3: Plain HTTP + docs

The M3 acceptance already runs the machine over plain HTTP with local signing; keep it, and update `/docs/quickstart` (MCP config, SDK, HTTP) to the real API (paths, headers, errors). Progress note.
