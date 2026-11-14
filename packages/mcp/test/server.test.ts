// The MCP server in process (no network, no chain): a spec is untrusted, so submit_delivery never sends the machine's
// keypair file, whatever the model was talked into passing.
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import type { Samite } from "@samite/sdk"
import { spendGuard } from "../src/guards"
import { buildServer } from "../src/server"

const dir = mkdtempSync(join(tmpdir(), "samite-mcp-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const keyFile = join(dir, "machine.json")
writeFileSync(keyFile, "[]")
const alias = join(dir, "looks-harmless.csv")
symlinkSync(keyFile, alias)

async function connect() {
  const submitted: unknown[] = []
  const samite = {
    address: "machine",
    deliveries: { submit: async (...a: unknown[]) => (submitted.push(a), { signature: "sig", summary: {} }) },
  } as unknown as Samite
  const server = buildServer({
    samite,
    guard: spendGuard({ maxPost: 0n, dailySpend: 0n, dir, address: "machine" }),
    confirmMode: false,
    api: "https://samite.test",
    keyFile,
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(b)
  return { client, submitted }
}

describe("submit_delivery", () => {
  it("refuses the machine's keypair file, by path or through a link, and sends nothing", async () => {
    const { client, submitted } = await connect()
    for (const path of [keyFile, alias]) {
      const r = await client.callTool({ name: "submit_delivery", arguments: { job: "0001", files: [path] } })
      expect(r.isError).toBe(true)
      expect(JSON.stringify(r.content)).toContain("keypair file")
    }
    expect(submitted).toHaveLength(0)
  })

  it("passes other files to the SDK (which checks their contents for keys too)", async () => {
    const { client, submitted } = await connect()
    const other = join(dir, "out.csv")
    writeFileSync(other, "a,b\n1,2\n")
    const r = await client.callTool({ name: "submit_delivery", arguments: { job: "0001", files: [other] } })
    expect(r.isError).toBeFalsy()
    expect(submitted).toHaveLength(1)
  })
})
