/**
 * A connection string as libpq tools write it (Neon's console, psql), made safe for postgres.js 3.4, which reads two of
 * its parameters differently (node_modules/postgres/src/index.js parseOptions, connection.js secure):
 * - `sslmode=require` turns certificate checks off (`rejectUnauthorized: false`), so a machine in the path could pose
 *   as the database. `verify-full` keeps Node's default checks: a trusted certificate for this host name. Neon's
 *   certificates are publicly trusted.
 * - parameters it doesn't know, such as Neon's `channel_binding=require`, are sent to the server as session settings at
 *   startup, which the server refuses. postgres.js has no channel binding, so the parameter goes.
 * Only the query string changes; user, password, host and database stay byte for byte.
 */
export function forPostgresJs(url: string): string {
  const q = url.indexOf("?")
  if (q < 0) return url
  const params = new URLSearchParams(url.slice(q + 1))
  params.delete("channel_binding")
  if (params.get("sslmode") === "require") params.set("sslmode", "verify-full")
  const rest = params.toString()
  return rest ? `${url.slice(0, q)}?${rest}` : url.slice(0, q)
}
