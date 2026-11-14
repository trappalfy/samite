type Env = Record<string, string | undefined>

/** True on samite.fun's production deployment (Vercel sets VERCEL_ENV at build and run time). */
export function isProduction(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.SAMITE_FORCE_PRODUCTION === "1"
}

/** The owner has launched: samite.fun is open to everyone and may be indexed (SAMITE_PUBLIC=1, set in Vercel). */
export function isPublic(env: Env = process.env): boolean {
  return env.SAMITE_PUBLIC === "1"
}

/** samite.fun before launch: closed to everyone without the access key (lib/gate.ts). */
export function isClosed(env: Env = process.env): boolean {
  return isProduction(env) && !isPublic(env)
}

/** Pages may be indexed: on samite.fun after launch only (never previews or local builds). */
export function isIndexable(env: Env = process.env): boolean {
  return isProduction(env) && isPublic(env)
}
