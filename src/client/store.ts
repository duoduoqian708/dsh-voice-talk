// Minimal observable store for the voice status surface. The renderer binds
// the source through the inject `hooks` compartment (useSyncExternalStore),
// so the snapshot reference must stay stable between changes.

import type { VoiceStatus } from './types.ts'

/** Bare observable source over one immutable snapshot. */
export interface ObservableSource<S> {
  getSnapshot(): S
  subscribe(listener: () => void): () => void
}

/** Frozen-snapshot store: notify only when the published reference changes. */
export class SnapshotStore<S> implements ObservableSource<S> {
  #snapshot: S
  #listeners = new Set<() => void>()

  constructor(initial: S) {
    this.#snapshot = initial
  }

  getSnapshot(): S {
    return this.#snapshot
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Publish the next snapshot (new reference required to notify). */
  set(next: S): void {
    if (next === this.#snapshot) return
    this.#snapshot = next
    for (const listener of [...this.#listeners]) listener()
  }

  /** Publish the result of patching the current snapshot. */
  patch(patch: Partial<S>): void {
    this.set({ ...this.#snapshot, ...patch })
  }
}

export type { VoiceStatus }
