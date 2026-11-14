"use client"
// What a person reads when something in the browser fails. @solana/kit's production errors are only a code
// ("Solana error #8100002; Decode this error by running…"), so the ones a page can meet are put into words here.
import { isSolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR } from "@solana/kit"

export function errorText(e: unknown): string {
  if (isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const status = e.context.statusCode
    return status === 429
      ? "Solana's RPC is busy (HTTP 429). Try again in a minute."
      : `This page couldn't reach Solana's RPC (HTTP ${status}).`
  }
  if (isSolanaError(e)) return `Solana error ${e.context.__code}.`
  return e instanceof Error ? e.message : String(e)
}
