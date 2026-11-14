import { describe, expect, it } from "vitest"
import { FormatError, reasonHash, sha256, toHex } from "../src/index"

const ascii = (s: string) => new TextEncoder().encode(s)

describe("sha256", () => {
  // FIPS 180-2, Appendix B.1 and B.2, and the empty message.
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("hashes %j", (message, hex) => {
    const digest = sha256(ascii(message))
    expect(digest).toBeInstanceOf(Uint8Array)
    expect(digest.length).toBe(32)
    expect(toHex(digest)).toBe(hex)
  })
})

describe("toHex", () => {
  it("writes lowercase, two digits per byte", () => {
    expect(toHex(new Uint8Array([0x00, 0x0f, 0xab, 0xff]))).toBe("000fabff")
  })
})

describe("reasonHash: sha256(NFC(text) as UTF-8)", () => {
  // Expected hashes from `printf ... | shasum -a 256` and Python's hashlib + unicodedata.normalize("NFC", ...).
  it("hashes ASCII text as its bytes", () => {
    const r = reasonHash("The CSV has 4,950 rows, not 5,000.")
    expect(r.hex).toBe("bb3fd72f6696edb2dad944c20f32a76b3991595c84677ad8399ccea20e3ab931")
    expect(toHex(r.hash)).toBe(r.hex)
  })

  it("hashes the NFC form, so \u00e9 gives the same hash either way it is typed", () => {
    const composed = reasonHash("\u00e9")
    expect(composed.hex).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c")
    expect(reasonHash("e\u0301").hex).toBe(composed.hex)
  })

  it("returns the hashed bytes", () => {
    const r = reasonHash("Missing cafe\u0301 rows 😀")
    expect(toHex(r.canonical)).toBe("4d697373696e6720636166c3a920726f777320f09f9880")
    expect(r.hex).toBe("6e1f97535e30905e257c31391ebe278bd85d4af28ef9d9a303874031b701bdfc")
  })

  it("refuses a lone surrogate instead of hashing U+FFFD in its place", () => {
    expect(() => reasonHash("broken \ud800 text")).toThrow(FormatError)
  })
})
