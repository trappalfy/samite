"""Write the golden expectations for packages/formats, independently of the TypeScript code.

    python3 -I scripts/golden.py test/golden        (or: pnpm --filter @samite/formats golden)

For every <name>.input.json under the directory it writes
    <name>.canonical        the expected canonical bytes (UTF-8, no trailing newline)
    <name>.sha256           the expected sha256 of those bytes, as lowercase hex + "\n"
(".canonical", not ".json", so that Prettier and editors leave the exact bytes alone.)

using only Python's standard library:
    unicodedata.normalize("NFC", ...) on every string and key,
    json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
    hashlib.sha256.

That json.dumps call equals RFC 8785 JCS only for some inputs, so the script refuses the rest
instead of writing a wrong expectation:
  - floats (Python's repr differs from ECMAScript's Number::toString), and integers outside
    +/-(2^53 - 1), which JavaScript cannot hold exactly;
  - objects whose keys sort differently by code point (Python) and by UTF-16 code unit (JCS);
  - duplicate keys, before or after NFC.
json.dumps's string escaping (\\" \\\\ \\b \\f \\n \\r \\t, other C0 controls as lowercase
\\u00hh, everything else as is) already matches RFC 8785 section 3.2.2.2.
Floats and the UTF-16 sorting edge are covered by the RFC 8785 vectors in test/jcs.test.ts.
"""

import hashlib
import json
import pathlib
import sys
import unicodedata

MAX_SAFE = 2**53 - 1


class Refused(Exception):
    pass


def no_floats(text):
    raise Refused(f"float {text}: Python's float repr is not JCS; use an integer")


def no_duplicates(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise Refused(f"duplicate key {key!r}")
        out[key] = value
    return out


def utf16_key(s):
    return s.encode("utf-16-be")


def nfc(value, path="$"):
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        if abs(value) > MAX_SAFE:
            raise Refused(f"{path}: {value} is beyond 2^53 - 1")
        return value
    if isinstance(value, list):
        return [nfc(v, f"{path}[{i}]") for i, v in enumerate(value)]
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            name = unicodedata.normalize("NFC", key)
            if name in out:
                raise Refused(f"{path}: keys collide after NFC: {name!r}")
            out[name] = nfc(item, f"{path}.{name}")
        keys = list(out)
        if sorted(keys) != sorted(keys, key=utf16_key):
            raise Refused(f"{path}: code point order differs from UTF-16 order; json.dumps would not match JCS")
        return out
    raise Refused(f"{path}: unexpected {type(value).__name__}")


def canonical(text):
    value = json.loads(text, parse_float=no_floats, object_pairs_hook=no_duplicates)
    dumped = json.dumps(nfc(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return dumped.encode("utf-8")  # raises on a lone surrogate, which JCS also refuses


def main(root):
    inputs = sorted(pathlib.Path(root).rglob("*.input.json"))
    if not inputs:
        raise SystemExit(f"no *.input.json under {root}")
    for path in inputs:
        stem = path.name[: -len(".input.json")]
        try:
            data = canonical(path.read_text(encoding="utf-8"))
        except Refused as e:
            raise SystemExit(f"{path}: refused: {e}")
        path.with_name(f"{stem}.canonical").write_bytes(data)
        path.with_name(f"{stem}.sha256").write_text(hashlib.sha256(data).hexdigest() + "\n", encoding="ascii")
        print(f"{path.relative_to(root)}  {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
