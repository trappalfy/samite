// Local keypairs (gitignored, under .data/local/keys). Never used anywhere but the local validator.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit"
import { localDir } from "./paths"

export const ROLES = ["authority", "treasury", "poster", "machine", "machine2", "keeper"] as const
export type Role = (typeof ROLES)[number]

export const keyPath = (role: Role, dir = localDir()) => join(dir, "keys", `${role}.json`)

export function ensureKeys(dir = localDir()) {
  mkdirSync(join(dir, "keys"), { recursive: true })
  for (const role of ROLES) {
    const p = keyPath(role, dir)
    if (!existsSync(p)) execFileSync("solana-keygen", ["new", "--no-bip39-passphrase", "--silent", "--force", "-o", p])
  }
}

export async function loadSigner(role: Role, dir = localDir()): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(keyPath(role, dir), "utf8")) as number[]))
}

export async function loadSigners(dir = localDir()): Promise<Record<Role, KeyPairSigner>> {
  const out = {} as Record<Role, KeyPairSigner>
  for (const r of ROLES) out[r] = await loadSigner(r, dir)
  return out
}
