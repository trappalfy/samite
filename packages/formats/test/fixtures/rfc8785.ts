// Test vectors copied from RFC 8785, "JSON Canonicalization Scheme (JCS)", June 2020.
// Source: https://www.rfc-editor.org/rfc/rfc8785.txt (fetched 2026-11-12).

/**
 * Appendix B, Table 1: ECMAScript-compatible JSON number serialization samples.
 * `ieee` is the IEEE 754 double as 16 hex digits; `json` is the expected serialization,
 * or null where the RFC says the value is not permitted (NaN, Infinity: note (3)).
 */
export const NUMBER_SAMPLES: ReadonlyArray<{ ieee: string; json: string | null; comment: string }> = [
  { ieee: "0000000000000000", json: "0", comment: "Zero" },
  { ieee: "8000000000000000", json: "0", comment: "Minus zero" },
  { ieee: "0000000000000001", json: "5e-324", comment: "Min pos number" },
  { ieee: "8000000000000001", json: "-5e-324", comment: "Min neg number" },
  { ieee: "7fefffffffffffff", json: "1.7976931348623157e+308", comment: "Max pos number" },
  { ieee: "ffefffffffffffff", json: "-1.7976931348623157e+308", comment: "Max neg number" },
  { ieee: "4340000000000000", json: "9007199254740992", comment: "Max pos int (1)" },
  { ieee: "c340000000000000", json: "-9007199254740992", comment: "Max neg int (1)" },
  { ieee: "4430000000000000", json: "295147905179352830000", comment: "~2**68 (2)" },
  { ieee: "7fffffffffffffff", json: null, comment: "NaN (3)" },
  { ieee: "7ff0000000000000", json: null, comment: "Infinity (3)" },
  { ieee: "44b52d02c7e14af5", json: "9.999999999999997e+22", comment: "" },
  { ieee: "44b52d02c7e14af6", json: "1e+23", comment: "" },
  { ieee: "44b52d02c7e14af7", json: "1.0000000000000001e+23", comment: "" },
  { ieee: "444b1ae4d6e2ef4e", json: "999999999999999700000", comment: "" },
  { ieee: "444b1ae4d6e2ef4f", json: "999999999999999900000", comment: "" },
  { ieee: "444b1ae4d6e2ef50", json: "1e+21", comment: "" },
  { ieee: "3eb0c6f7a0b5ed8c", json: "9.999999999999997e-7", comment: "" },
  { ieee: "3eb0c6f7a0b5ed8d", json: "0.000001", comment: "" },
  { ieee: "41b3de4355555553", json: "333333333.3333332", comment: "" },
  { ieee: "41b3de4355555554", json: "333333333.33333325", comment: "" },
  { ieee: "41b3de4355555555", json: "333333333.3333333", comment: "" },
  { ieee: "41b3de4355555556", json: "333333333.3333334", comment: "" },
  { ieee: "41b3de4355555557", json: "333333333.33333343", comment: "" },
  { ieee: "becbf647612f3696", json: "-0.0000033333333333333333", comment: "" },
  { ieee: "43143ff3c1cb0959", json: "1424953923781206.2", comment: "Round to even (4)" },
]

/** §3.2.3: sorting test data, as JSON text exactly as printed in the RFC. */
export const SORTING_INPUT = `{
  "\\u20ac": "Euro Sign",
  "\\r": "Carriage Return",
  "\\ufb33": "Hebrew Letter Dalet With Dagesh",
  "1": "One",
  "\\ud83d\\ude00": "Emoji: Grinning Face",
  "\\u0080": "Control",
  "\\u00f6": "Latin Small Letter O With Diaeresis"
}`

/** §3.2.3: "Expected argument order after sorting property strings". */
export const SORTING_EXPECTED_VALUES = [
  "Carriage Return",
  "One",
  "Control",
  "Latin Small Letter O With Diaeresis",
  "Euro Sign",
  "Emoji: Grinning Face",
  "Hebrew Letter Dalet With Dagesh",
]

/** §3.2.2: the sample object, as JSON text exactly as printed in the RFC. */
export const PRIMITIVES_INPUT = `{
  "numbers": [333333333.33333329, 1E30, 4.50,
              2e-3, 0.000000000000000000000000001],
  "string": "\\u20ac$\\u000F\\u000aA'\\u0042\\u0022\\u005c\\\\\\"\\/",
  "literals": [null, true, false]
}`

/** §3.2.4: the canonical UTF-8 bytes of the §3.2.2 sample, in hex. */
export const PRIMITIVES_EXPECTED_HEX = `
  7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72
  75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a
  5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31
  65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37
  5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30
  30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d`
