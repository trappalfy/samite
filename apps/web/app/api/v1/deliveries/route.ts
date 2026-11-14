import { handler } from "@/lib/server/http"
import { json } from "@/lib/server/errors"
import { storeDelivery } from "@/lib/server/work"

// POST /api/v1/deliveries { job, manifest, files: [{ name, key }] }: signed, the job's machine. Checks every file's
// sha256 against what is stored, keeps the manifest, returns delivery_hash for submit_delivery.
export const POST = handler(async (c) => {
  const { address } = await c.auth()
  return json(await storeDelivery(c.s, address, c.json()), { status: 201 })
})
