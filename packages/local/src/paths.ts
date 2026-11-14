import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/** The monorepo root (where pnpm-workspace.yaml is). */
export function repoRoot(from = process.cwd()): string {
  let dir = resolve(from)
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir)
    if (up === dir) throw new Error("not inside the samite repo")
    dir = up
  }
  return dir
}

export const localDir = (root = repoRoot()) => join(root, ".data", "local")
export const programSo = (root = repoRoot()) => join(root, "target", "deploy", "samite_escrow.so")
