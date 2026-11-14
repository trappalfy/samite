import { sql } from "drizzle-orm"
import { server } from "@/lib/server/context"
import { describeError, json } from "@/lib/server/errors"

// GET /api/v1/health: the database and the RPC answer.
export async function GET() {
  try {
    const s = await server()
    await s.db.execute(sql`select 1`)
    const slot = await s.rpc.getSlot({ commitment: "confirmed" }).send()
    return json({ ok: true, slot: Number(slot) })
  } catch (e) {
    // the detail goes to the log, not to whoever asks
    console.error(JSON.stringify({ msg: "health check failed", ...describeError(e) }))
    return json({ ok: false }, { status: 503 })
  }
}
