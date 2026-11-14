import { fileURLToPath } from "node:url"

/** Absolute path of a file in the owner's design kit. */
export const kit = (p: string) => fileURLToPath(new URL(`../../../design/${p}`, import.meta.url))
