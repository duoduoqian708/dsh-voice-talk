// Host-bridge failures carry a stable machine code so the browser can map
// them to localized copy (the page owns the user's language; the host does
// not guess). Vendor-generated messages stay code-less and pass through.

/** A bridge failure with a code the browser's error map understands. */
export class BridgeError extends Error {
  /** Stable code shared with the browser's `bridgeErrorKey` table. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
  }
}

/** Serialize a failure for an HTTP body or WS frame (code only when known). */
export function bridgeErrorPayload(error: unknown): { error: string; code?: string } {
  const message = error instanceof Error ? error.message : String(error)
  return error instanceof BridgeError ? { error: message, code: error.code } : { error: message }
}
