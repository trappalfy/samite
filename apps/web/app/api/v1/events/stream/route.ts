import { server } from "@/lib/server/context"
import { errorResponse, toJson } from "@/lib/server/errors"
import { feed } from "@/lib/server/jobs"

// GET /api/v1/events/stream: Server-Sent Events. Sends new events as they are indexed (polled every 2 s), from
// Last-Event-ID or ?cursor when given. Machines can watch for new jobs here instead of polling the board.
export async function GET(req: Request) {
  try {
    const s = await server()
    const q = new URL(req.url).searchParams
    let cursor = Number(req.headers.get("last-event-id") ?? q.get("cursor") ?? NaN)
    if (!Number.isSafeInteger(cursor)) cursor = (await feed(s.db, { limit: 1 })).cursor
    const enc = new TextEncoder()
    let timer: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream({
      start(ctl) {
        ctl.enqueue(enc.encode(`retry: 3000\n: samite events from ${cursor}\n\n`))
        let busy = false
        timer = setInterval(async () => {
          if (busy) return
          busy = true
          try {
            const page = await feed(s.db, { after: cursor, limit: 100 })
            for (const e of page.events)
              ctl.enqueue(enc.encode(`id: ${e.id}\nevent: ${e.kind}\ndata: ${toJson(e)}\n\n`))
            cursor = page.cursor
            if (!page.events.length) ctl.enqueue(enc.encode(": ping\n\n"))
          } catch {
            /* the next tick tries again */
          } finally {
            busy = false
          }
        }, 2_000)
      },
      cancel() {
        clearInterval(timer)
      },
    })
    req.signal.addEventListener("abort", () => clearInterval(timer))
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
    })
  } catch (e) {
    return errorResponse(e)
  }
}
