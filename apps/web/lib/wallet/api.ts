"use client"
// fetch for /api/v1 from the browser: same-origin, the session cookie rides along, errors keep their stable code.

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export async function api<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  })
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: unknown } }
  if (!res.ok || data.error)
    throw new ApiFailure(
      data.error?.code ?? "internal",
      data.error?.message ?? `HTTP ${res.status}`,
      data.error?.details,
    )
  return data as T
}
