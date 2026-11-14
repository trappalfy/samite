import { handler, stringField } from "@/lib/server/http"
import { ApiError, json } from "@/lib/server/errors"
import { buildTx, relay, txStatus, TX_ACTIONS, type TxAction } from "@/lib/server/tx"

// POST /api/v1/tx/:action: signed. An unsigned transaction (base64) + a summary of what it does; your key signs it.
// POST /api/v1/tx/send { transaction }: relays a fully signed transaction for this program. The server never signs.
// GET /api/v1/tx/status?signature=…: where a transaction is (processed, confirmed, finalized, or null if the RPC
// doesn't know it yet) and its error. For pages whose own RPC can't answer; anyone may ask.
export const GET = handler<{ action: string }>(async (c, { action }) => {
  if (action !== "status") throw new ApiError("not_found", "GET only answers /tx/status?signature=….")
  return json(await txStatus(c.s, new URL(c.req.url).searchParams.get("signature") ?? ""), {
    headers: { "cache-control": "no-store" },
  })
})

export const POST = handler<{ action: string }>(async (c, { action }) => {
  if (action === "send") {
    const b = c.json<{ transaction?: unknown }>()
    return json({ signature: await relay(c.s, stringField(b.transaction, "transaction")) })
  }
  if (!TX_ACTIONS.includes(action as TxAction))
    throw new ApiError("not_found", `No transaction "${action}". One of: ${TX_ACTIONS.join(", ")}, send.`)
  const { address } = await c.auth()
  return json(await buildTx(c.s, action as TxAction, address, c.json()))
})
