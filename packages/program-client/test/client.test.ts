import { readFileSync } from "node:fs"
import { address } from "@solana/kit"
import { describe, expect, it } from "vitest"
import * as client from "../src"
import { type ClaimPolicy, JobStatus, getPostJobInstructionDataDecoder, getPostJobInstructionDataEncoder } from "../src"

type Idl = {
  address: string
  instructions: { name: string; discriminator: number[] }[]
  accounts: { name: string; discriminator: number[] }[]
  errors: { code: number; name: string }[]
}

const idl = JSON.parse(readFileSync(new URL("../idl/samite_escrow.json", import.meta.url), "utf8")) as Idl

const screaming = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toUpperCase()

const exported = client as unknown as Record<string, unknown>

describe("generated client matches the committed IDL", () => {
  it("targets the IDL's program address", () => {
    expect(client.SAMITE_ESCROW_PROGRAM_ADDRESS).toBe(idl.address)
  })

  it("has every instruction with the IDL's discriminator", () => {
    expect(idl.instructions).toHaveLength(14)
    for (const ix of idl.instructions) {
      const constant = exported[`${screaming(ix.name)}_DISCRIMINATOR`] as Uint8Array | undefined
      expect(constant, ix.name).toBeDefined()
      expect(Array.from(constant ?? []), ix.name).toEqual(ix.discriminator)
    }
  })

  it("has every account with the IDL's discriminator", () => {
    for (const account of idl.accounts) {
      const constant = exported[`${screaming(account.name)}_DISCRIMINATOR`] as Uint8Array | undefined
      expect(Array.from(constant ?? []), account.name).toEqual(account.discriminator)
    }
  })

  it("has every error code", () => {
    for (const error of idl.errors) {
      expect(exported[`SAMITE_ESCROW_ERROR__${screaming(error.name)}`], error.name).toBe(error.code)
    }
  })
})

describe("post_job data", () => {
  const args = {
    jobId: 415n,
    reward: 120_000_000n,
    deadline: 1_800_259_200n,
    reviewWindow: 172_800n,
    claimWindow: 0n,
    policy: { __kind: "Proven" as const, minAccepted: 5 },
    allowlist: [],
    specHash: new Uint8Array(32).fill(7),
  }

  it("encodes in Anchor's Borsh layout", () => {
    const bytes = getPostJobInstructionDataEncoder().encode(args)
    // 8 discriminator + 5 × 8 (u64/i64) + policy (1 tag + 4 u32) + allowlist (4 length) + 32 spec hash
    expect(bytes.length).toBe(8 + 40 + 5 + 4 + 32)
    expect(Array.from(bytes.slice(0, 8))).toEqual(idl.instructions.find((i) => i.name === "post_job")?.discriminator)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getBigUint64(8, true)).toBe(415n)
    expect(view.getBigUint64(16, true)).toBe(120_000_000n)
    expect(bytes[48]).toBe(1) // ClaimPolicy::Proven is variant 1
    expect(view.getUint32(49, true)).toBe(5)
  })

  it("round-trips", () => {
    const decoded = getPostJobInstructionDataDecoder().decode(getPostJobInstructionDataEncoder().encode(args))
    expect(decoded.jobId).toBe(415n)
    expect(decoded.policy).toEqual({ __kind: "Proven", minAccepted: 5 })
    expect(Array.from(decoded.specHash)).toEqual(Array.from(args.specHash))
  })
})

describe("PDAs", () => {
  it("derive the job PDA from the poster and the little-endian job id", async () => {
    const poster = address("11111111111111111111111111111112")
    const [a] = await client.findJobPda({ poster, jobId: 1n })
    const [b] = await client.findJobPda({ poster, jobId: 2n })
    expect(a).not.toBe(b)
    const [config] = await client.findConfigPda()
    expect(typeof config).toBe("string")
  })

  it("exposes the status and policy types", () => {
    expect(JobStatus.Delivered).toBe(2)
    const any: ClaimPolicy = { __kind: "Any" }
    expect(any.__kind).toBe("Any")
  })
})

describe("defaultClaimWindow (every claim lapses, Nov 13)", () => {
  it("is 24 h, or what fits before the deadline less 10 minutes, never under 1 h", async () => {
    const { defaultClaimWindow, MIN_CLAIM_WINDOW } = await import("../src")
    const now = 1_800_000_000n
    expect(defaultClaimWindow(now + 3n * 86_400n, now)).toBe(86_400n)
    expect(defaultClaimWindow(now + 86_400n, now)).toBe(86_400n - 600n)
    expect(defaultClaimWindow(now + 5n * 3_600n, now)).toBe(5n * 3_600n - 600n)
    expect(defaultClaimWindow(now + 3_600n, now)).toBe(MIN_CLAIM_WINDOW) // the program refuses it: the deadline is too near
    expect(MIN_CLAIM_WINDOW).toBe(3_600n)
  })
})
