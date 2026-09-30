/** Reuse the same request key after a lost response or a page reload in this tab. */
async function storageKeyFor(scope: string, payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  return `bazarko-request:${scope}:${hash}`
}

export async function requestKey(scope: string, payload: unknown): Promise<string> {
  const storageKey = await storageKeyFor(scope, payload)
  const existing = sessionStorage.getItem(storageKey)
  if (existing) return existing
  const key = crypto.randomUUID()
  sessionStorage.setItem(storageKey, key)
  return key
}

/** A confirmed response completes this intent; the next identical sale is a new intent. */
export async function completeRequest(scope: string, payload: unknown): Promise<void> {
  sessionStorage.removeItem(await storageKeyFor(scope, payload))
}
