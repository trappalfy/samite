# M1: Design system + landing (static) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every §11.7 component, the full landing (§11.10) and the four app screens (§11.12) as static pages with labelled example data, plus the docs skeleton — all on preview deployments only; `samite.fun` keeps serving the placeholder.

**Architecture:** Routes live in two groups: `/` stays the placeholder; everything else sits in a `(preview)` route group whose layout 404s when `VERCEL_ENV === "production"` (Vercel sets it at build). The landing is a server page with small client islands (presses, HUD, code tabs, walking highlight, entrances). App screens are server-rendered from example fixtures in `apps/web/lib/examples.ts`; M3 swaps fixtures for the index. CSS is ported from the prototypes into CSS modules; shared components live in `packages/ui/src/components/`.

**Tech Stack:** as M0, plus `@next/mdx` for docs.

**Spec:** `CLAUDE.md` §1.3, §6 (code samples), §9, §10, §11 (all), §13, §14 (M1).

## Global Constraints

- Prototype is the source of truth for layout and copy: `design/prototype/landing.html`, `app.html`; acceptance targets `design/screenshots/landing-*.png`, `app-*.png`; motion `landing-hero.mp4`, `landing-footer-word.mp4`.
- Every example value is labelled exactly as in the prototype (`example`, `(example)`, `example jobs and values`, `example job, time sped up`, `example values; live from /api/stats in production`).
- Copy: words of §1.3 only; never "worker"/"bot" for machines in UI copy (the "Agents / Bots / Devices" line is the prototype's own); §11.11 bans.
- Links with nowhere to go (GitHub, Status, Solscan before deploy) are hidden, not dead.
- No radius, shadows, accent colours, WebGL, Lottie, parallax. Motion only per §11.8; `prefers-reduced-motion` and `?shot&t` stop all of it (HUD shows PAID under reduced motion).
- Press budget: ≤ 3 animated presses on screen; landing has hero (breathe), figure (breathe), footer word (cycle) — offscreen ones pause.

## Review Focus

1. `?shot&t=<s>` must freeze everything that moves (presses, HUD, walking highlight, entrances, blink) so screenshots are deterministic.
2. Landing at 1100 px and 560 px breakpoints: no horizontal scroll, the grid collapses as in the prototype.
3. Production build on Vercel (`VERCEL_ENV=production`) must 404 every preview route; local/preview builds must serve them.
4. Reduced motion: HUD frozen on PAID, presses still, no entrances, no walking highlight.
5. Images for presses (figure, clouds) load lazily and never block LCP.

---

### Task 1: Preview gate + example fixtures
- `app/(preview)/layout.tsx` with `isProduction()` from `lib/env.ts` → `notFound()`.
- `lib/examples.ts`: jobs table rows, feed, job 0415, machine `listing-scout` (values verbatim from `app.html`).
- Test (vitest): `isProduction({VERCEL_ENV:"production"})` true; preview/dev false. E2E: preview routes 200 locally.

### Task 2: Site components (`packages/ui/src/components/site/`)
- `BracketButton` (variants `paper` | `dark`, sizes 62/54/38), `BoxButton`, `Ex`, `StatusGlyph` (open|claimed|delivered|paid|refunded|x), `SplitBar`, `SegMeter`, `PixelCluster`, `CodeTabs` (client), `WhoWalk` (client, index = ⌊t/2.4⌋ mod 3), `Reveal` (client).
- CSS modules ported from `landing.html` verbatim.

### Task 3: Landing page (`app/(preview)/landing/`)
- Sections in order (§11.10): nav, hero (left: copy + module with dot chart; centre: paper press + HUD + bracket CTA; right: pixel cluster + H3 + who), settlements strip, how it works (4 step glyph prints), for machines (figure print + code tabs MCP/SDK/HTTP with §6 snippets), escrow (5 states + fee row), footer (clouds + cycling word, columns, legal).
- `hud(ctx, t, geo)` in `landing/hud.ts`: pure function of t, ported verbatim; reduced motion → PAID frame.
- Press sources ported verbatim; images from `public/press/{figure,clouds}.jpg`.

### Task 4: Landing acceptance
- Find each motion reference's t offset by matching unique frames (as M0); e2e asserts frame-for-frame.
- Screenshots: hero 1440×900@2 vs `landing-hero.png`, 390×844@3 vs `landing-mobile-hero.png`, full page 1440@1 vs `landing-desktop-full.png`, 390@2 vs `landing-mobile-full.png`; side-by-sides to `docs/progress/m1/`.
- Lighthouse mobile ≥ 90 performance, ≥ 95 accessibility; axe clean.

### Task 5: App shell + components (`packages/ui/src/components/app/`)
- Top bar (brand + `APP`, tabs, bracket "Post a job", wallet chip), `Button` (primary|ghost|bracket, 38/56), `Chip`, `Segmented`, `JobsTable`, `Panel`, `KV`, `Feed`, `Timeline`, `ActivityGrid` (plain canvas), `Avatar` (press), form controls (`Field`, `Options`, `AmountInput`), `Summary`.
- Mobile: tabs as a second scrolling row; side column under main; full-width actions.

### Task 6: App screens with example data
- `/jobs` (board), `/jobs/new` (form + live summary maths: 97.5% / 2.5% floor in base units), `/jobs/0415` (job), `/machines/9be2…` (machine), `/me` (tabs, example).
- Test (vitest): `splitReward(120_000_000n, 250)` → `{ toMachine: 117_000_000n, fee: 3_000_000n }`; `80_000_000n` → `78/2`; `formatUsdc(117_000_000n)` → `"117.00"`.
- Acceptance: `app-*.png` at 1440 (full page @1) and 390×844@3 side by side.

### Task 7: Docs skeleton
- `/docs` MDX pages: Quickstart (MCP, SDK, HTTP), How escrow works, Fees, Job spec format, Delivery format, Signed requests, Errors, FAQ (§4.6 trade-off said plainly). Marked draft where APIs are not live.

### Task 8: Progress note, PR, review.
