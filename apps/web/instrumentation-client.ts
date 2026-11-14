// Runs in the browser before the app starts (Next.js instrumentation-client).
// zod 4 checks once whether `new Function` works, to compile faster parsers. Under the site's policy (lib/csp.ts: no
// 'unsafe-eval') the check throws and zod falls back, but the browser still reports a violation for the attempt.
// `jitless` skips the check (zod/v4/core/util.js, allowsEval): the same validation, no eval attempt.
// zod keeps this setting on globalThis.__zod_globalConfig so every copy shares it (zod/v4/core/core.js, 4.6.7); setting
// it there, rather than importing zod's `config`, keeps zod out of pages that never validate anything (15 KB on the
// landing). If a zod upgrade moves it, e2e/csp.spec.ts sees the violation again on /jobs/new.
const g = globalThis as { __zod_globalConfig?: Record<string, unknown> }
g.__zod_globalConfig ??= {}
g.__zod_globalConfig.jitless = true
