// The wallet last connected through Privy, kept in this browser only: its address and its name (the Wallet Standard
// wallet to ask for a silent reconnect). It says Privy has to load on the next visit to reconnect the wallet; without
// it, Privy loads only when someone asks to connect (WalletLayer.tsx).
const KEY = "samite:privy-wallet"

export type Remembered = { address: string; name: string }

export function remembered(): Remembered | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Remembered | null
    return v && typeof v.address === "string" && typeof v.name === "string" ? v : null
  } catch {
    return null
  }
}

export function remember(w: Remembered | null) {
  try {
    if (w) localStorage.setItem(KEY, JSON.stringify({ address: w.address, name: w.name }))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: Privy loads on the next click, and the first connected wallet is used */
  }
}
