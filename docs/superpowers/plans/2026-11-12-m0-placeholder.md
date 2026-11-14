# M0: Repo + placeholder live — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm/Turborepo monorepo with CI, `packages/config`, `packages/ui` (tokens + the press ported to TypeScript one to one), and `apps/web` serving the M0 placeholder at `/`, ready for Vercel.

**Architecture:** The press is a framework-free TS module (`packages/ui/src/press/press.ts`) that is a pure function of `t`, wrapped by a thin React component. `apps/web` is Next.js App Router; the placeholder page is a client island (the stage) inside a server-rendered page. Visual parity is proven by Playwright: the TS press and the reference `design/prototype/samite-press.js` draw the same source on the same canvas size and must produce identical pixels at the same `t`.

**Tech Stack:** Node 24, pnpm 12.14, Turborepo 2.11, TypeScript 6.0.3, Next.js 16.4, React 19.3, Tailwind 4.3, zod 4, Vitest 5, Playwright 1.65, ESLint 9.39, Lighthouse 13.

**Spec:** `CLAUDE.md` §0, §2, §7.1, §7.3, §11.2–§11.5, §11.8, §11.13, §13, §14 (M0).

## Global Constraints

- Brand values only in `packages/config/src/brand.ts`; secrets only in `.env` (gitignored, `.env.example` committed with empty values).
- Colours: only the §11.2 tokens. No radius, no shadows, no accent colour.
- Fonts: `next/font/google`, Montserrat 400/500/600/700 + 800 italic; Space Mono 400/700. Canvases draw text only after the fonts are loaded.
- The press port: same maths, same keyframes, same output for the same `t` as `design/prototype/samite-press.js`.
- `?shot&t=<s>` stops every press and seeks it to `t`; disables entrances and blinking.
- `prefers-reduced-motion`: still print, no blink, no entrance.
- The placeholder must not load `samite-images.js` or any photo.
- Copy is English, verbatim from `design/prototype/placeholder.html`.
- Canvas `aria-hidden`; visually hidden H1 "Samite, the job board for machines".

## Review Focus

1. Fonts not loaded when the press lays out → wrong glyphs printed. Expect: the press waits for `document.fonts.load()` of the exact faces it draws. Test: parity spec runs on a cold page.
2. Resize / orientation change → lockup and slug note must re-layout together (debounced 120 ms). Test: e2e resizes 1440→390 and checks the note stays inside the stage.
3. DPR 3 phones → canvas capped at DPR 2 and still sharp enough. Test: mobile screenshot at deviceScaleFactor 3.
4. Hidden tab / offscreen → animation stops (no rAF burn). Test: unit test of start/stop guards via visibility.
5. JS disabled or slow → page still readable (H1, slug, button, footer are HTML). Test: e2e with JS disabled asserts the button and the slug text are present.

---

### Task 1: Monorepo skeleton + CI

**Files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc`, `.env.example`, `eslint.config.mjs`, `.prettierrc`, `.github/workflows/ci.yml`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/RUNBOOK.md`.

- [ ] Root scripts: `build`, `dev`, `typecheck`, `lint`, `test`, `e2e` via turbo. `packageManager: pnpm@12.14.0`, `engines.node >=20`.
- [ ] `.env.example` exactly as §7.3.
- [ ] CI jobs: `checks` (install --frozen-lockfile, typecheck, lint, test, build) and `secrets` (gitleaks).
- [ ] Verify: `pnpm install && pnpm turbo typecheck lint test` exits 0.
- [ ] Commit `chore: monorepo skeleton and CI`.

### Task 2: `packages/config`

**Files:** `packages/config/src/{brand.ts,solana.ts,env.ts,index.ts}`, `packages/config/test/env.test.ts`.

**Produces:** `brand` (verbatim §7.1), `solana` (`USDC_MINT` `// TODO(verify)`, `USDC_DECIMALS = 6`, limits §4.4), `parseServerEnv(env): ServerEnv`, `parsePublicEnv(env): PublicEnv` (zod; empty strings → undefined; `KEEPER_ENABLED` defaults `false`).

- [ ] Tests: `parsePublicEnv({})` gives `tokenCa: undefined`; `KEEPER_ENABLED` absent → `false`; `"true"` → `true`; malformed URL in `NEXT_PUBLIC_SITE_URL` throws.
- [ ] Implement, run, commit `feat(config): brand, solana constants, env parsing`.

### Task 3: The press in TypeScript (`packages/ui/src/press/`)

**Files:** `press.ts` (engine), `schedule.ts` (`smooth`, `cycleAt`, `breatheAt`, `STILL`, `CYCLE`), `blur.ts`, `hash.ts`, `mark.ts` (`SAMITE_MARK`, `drawSamiteMark`, `MARK_ASPECT = 1.2716`), `shot.ts` (`readShot(search): { t: number } | null`), `Press.tsx` (React wrapper), `index.ts`; tests `test/schedule.test.ts`, `test/blur.test.ts`.

**Produces:** `createPress(canvas, opts: PressOptions): PressHandle` with the §11.5 API (`layout, draw, seek, start, stop, destroy, api{width,height,cell,sample,params}`), `<Press options …/>`.

- [ ] Tests: `cycleAt(0)` = `{a:1,b:.3,c:0,gain:1.7,th:.02,sc:0}`; `cycleAt(.35).gain` ≈ 1.275; `cycleAt(.5)` = dim row; `breatheAt(0,5.2)` = `{a:1,b:.55,c:.35+.2·sin(1.3),gain:1.25,th:.03,sc:0}`; `blur` of a constant field is constant; `blur(r=0)` is a copy.
- [ ] Port maths one to one from the reference (copy constants, same loop order, same float ops). Engine extras that don't change pixels: `destroy()` removes listeners/observers; layout waits for `document.fonts.load` of faces passed in `opts.fonts`; reduced-motion read once per frame like the reference.
- [ ] `mark.ts` generated from `design/prototype/samite-mark.js` (path string copied byte for byte).
- [ ] Commit `feat(ui): the press ported to TypeScript`.

### Task 4: Tokens + base styles (`packages/ui/src/styles/`)

**Files:** `tokens.css` (§11.2 variables + Tailwind `@theme` mapping), `base.css` (reset, focus ring, grain class).

- [ ] Commit with Task 5.

### Task 5: `apps/web` placeholder

**Files:** `apps/web/{package.json,next.config.ts,postcss.config.mjs,tsconfig.json}`, `app/layout.tsx`, `app/page.tsx`, `app/placeholder/Stage.tsx`, `app/placeholder/lockup.ts`, `app/placeholder/placeholder.module.css`, `app/globals.css`, `app/manifest.ts`, `public/brand/*` (copied from `brand/`).

- [ ] `lockup(w, h, measure)` ported from the prototype (phone breakpoint 640, desktop `fs = min(h·.48, w·.165)`, mark ratio 1.2716, gap .22, note offsets).
- [ ] Metadata: title "Samite: the job board for machines", description from the prototype, `metadataBase` from `brand.siteUrl`, OG + X card `samite-og-1200x630.png`, icons (svg, 32, apple 180), manifest icon 512.
- [ ] CSS ported from the prototype verbatim (bar 56px, stage `min(1100px,100%) × min(46vh,440px)`, phone 62vh/520, CTA bracket button 52px with 12px mask corners, footer 52px, grain .07).
- [ ] Verify `pnpm --filter web build` succeeds and the page renders at `/`.
- [ ] Commit `feat(web): M0 placeholder`.

### Task 6: Proof — parity, screenshots, a11y, Lighthouse

**Files:** `apps/web/playwright.config.ts`, `apps/web/e2e/{press-parity.spec.ts,placeholder.spec.ts}`, `apps/web/app/dev/press-parity/page.tsx` (dev-only harness, 404 in production), `scripts/compare-shots.mjs`, `scripts/video-frames.sh`.

- [ ] Parity: harness draws the placeholder lockup with the reference engine and the TS engine at 1100×440 and 390×520, `seek(t)` for t ∈ {0.3, 1, 2, 3.2, 3.7, 4.5, 6, 7}; pixel arrays must be equal.
- [ ] Screenshots: `/?shot&t=7` at 1440×900 dpr 2 and 390×844 dpr 3; side-by-side PNGs with `design/screenshots/placeholder-*.png` into `docs/progress/m0/`.
- [ ] Video: extract frames of `placeholder-press-cycle.mp4` at t ∈ {0.5,2,3.2,3.7,4.5,6} with ffmpeg; side-by-side with ours.
- [ ] Reduced motion → still print; JS disabled → text present; axe scan clean; contrast pairs ≥ 4.5:1.
- [ ] Lighthouse mobile on `next start`: performance ≥ 95, accessibility ≥ 95.
- [ ] Write `docs/PROGRESS.md` M0 note, `docs/RUNBOOK.md` Vercel + Spaceship steps.
- [ ] Commit, push, CI green.

### Task 7 (owner): Vercel + DNS

- [ ] Owner imports the repo in Vercel (root `apps/web`), adds `samite.fun` + `www.samite.fun` (redirect to apex), copies the A and CNAME values from the project's Settings → Domains into Spaceship.
- [ ] Accept: `https://samite.fun` serves the placeholder; `www` → apex; OG card renders in X's validator.
