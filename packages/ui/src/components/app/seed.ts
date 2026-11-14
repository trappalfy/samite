// Pure (usable on the server): the avatar seed for an address. Kept out of Avatar.tsx, which is a client module.

/** A stable avatar seed from a base58 address (FNV-1a). */
export function seedFromAddress(address: string): number {
  let h = 2166136261
  for (let i = 0; i < address.length; i++) h = Math.imul(h ^ address.charCodeAt(i), 16777619)
  return h >>> 0
}
