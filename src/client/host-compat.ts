// Client-side host-line compatibility adapters.
//
// The 0.1.5 host line split the single old ConversationSnapshot into three
// live sources — the Session binding keeps lifecycle facts, the Chat
// conversation target owns the legacy node/partial/tool slice, and pending
// approvals/questions moved to `uiSession.pendingInteractions` — and moved the
// generated remotes from `connection.api` onto the `remote` service. The voice
// controller and the settings card consume the old shapes, so this module
// translates the new sources back to them; the old line keeps its native path.
// Detection is service presence, never a version check.

import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** One observable face both host lines satisfy. */
interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Context surface the adapters read without declaring a hard dependency. */
interface ServiceReader {
  get(name: string): unknown
}

/** New-line Chat target snapshot (only the consumed compatibility slice). */
interface ChatTargetSnapshot {
  legacy?: {
    nodes: ConversationSnapshot['nodes']
    partial: ConversationSnapshot['partial']
    runningCalls: ConversationSnapshot['runningCalls']
    turnTimings: ConversationSnapshot['turnTimings']
    turnEnds: ConversationSnapshot['turnEnds']
  }
}

/** New-line pending interaction as consumed by the voice answer flow. */
interface PendingInteractionFace {
  readonly kind: string
  readonly key: string
  readonly sessionId: SessionId
  readonly questions?: readonly unknown[]
  readonly toolName?: string
  readonly reason?: string
  answer(value: unknown): Promise<unknown>
}

/** New-line Conversation binding source (`ctx.uiConversation`). */
interface UiConversationFace {
  binding(binding: unknown): { target(name: string): Observable<ChatTargetSnapshot | undefined> }
}

/** New-line Session source (`ctx.uiSession`). */
interface UiSessionFace {
  pendingInteractions: Observable<ReadonlyMap<SessionId, PendingInteractionFace>>
}

/** The reader pair the controller's deps take. */
export interface SessionSnapshotFace {
  readSnapshot(): ConversationSnapshot
  subscribeSnapshot(listener: () => void): () => void
}

/** Settings-card credential face (the old `connection.api.credentials`). */
export interface CredentialsFace {
  describe(payload: { refs: string[] }): Promise<{ result: { ok: boolean; value?: { credentials: Record<string, { configured: boolean }> } } }>
  set(payload: { ref: string; value: string }): Promise<{ result: { ok: boolean } }>
}

/** New-line generated credentials remote (`ctx.remote.credentials`). */
interface RawCredentialsRemote {
  describe(refs: readonly string[]): Promise<{ ok: true; value: Record<string, { configured: boolean }> } | { ok: false; error: unknown }>
  set(ref: string, value: string): Promise<{ ok: true; value?: unknown } | { ok: false; error: unknown }>
}

/**
 * Bind one session to the snapshot reader pair the controller consumes.
 *
 * Old line: the Session binding's snapshot already carries nodes/partial/
 * runningCalls/pending, and its `subscribe` is the only change signal.
 * New line: every read assembles the old shape from the Chat target's legacy
 * slice plus the session's pending interaction, and the subscription merges
 * the three sources so a change in any of them reaches the controller.
 *
 * @param ctx - client context (service reads only, never declared injects).
 * @param binding - the Session binding resolved from `sessions.binding(id)`.
 * @param sessionId - the bound session identity.
 * @returns reader pair with the old snapshot contract.
 */
export function sessionSnapshotFace(ctx: ServiceReader, binding: unknown, sessionId: SessionId): SessionSnapshotFace {
  const session = (binding as { session: Observable<ConversationSnapshot> }).session
  const uiConversation = ctx.get('uiConversation') as UiConversationFace | undefined
  const uiSession = ctx.get('uiSession') as UiSessionFace | undefined
  if (uiConversation === undefined || uiSession === undefined) {
    return {
      readSnapshot: () => session.getSnapshot(),
      subscribeSnapshot: listener => session.subscribe(listener),
    }
  }
  const chat = uiConversation.binding(binding).target('chat')
  const pendingInteractions = uiSession.pendingInteractions
  return {
    readSnapshot: () => {
      const legacy = chat.getSnapshot()?.legacy
      const interaction = pendingInteractions.getSnapshot().get(sessionId)
      const running = (session.getSnapshot() as { running?: boolean }).running === true
      return {
        nodes: legacy?.nodes ?? [],
        partial: legacy?.partial ?? null,
        runningCalls: legacy?.runningCalls ?? [],
        pending: interaction === undefined ? [] : [pendingFacadeOf(interaction)],
        running,
        turnTimings: legacy?.turnTimings ?? new Map(),
        turnEnds: legacy?.turnEnds ?? new Map(),
      } as unknown as ConversationSnapshot
    },
    subscribeSnapshot: listener => {
      const disposers = [
        chat.subscribe(listener),
        pendingInteractions.subscribe(listener),
        session.subscribe(listener),
      ]
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
  }
}

/**
 * Translate one new-line pending interaction to the old wait face: the
 * controller's answer result shell is unwrapped into the new `answer()` call
 * (approval decisions and question answer batches alike).
 */
function pendingFacadeOf(interaction: PendingInteractionFace): unknown {
  const respond = async (result: { ok: true; value: unknown }): Promise<void> => {
    if (interaction.kind === 'approval') {
      const outcome = (result.value as { outcome?: 'allowed-once' | 'rejected' }).outcome ?? 'rejected'
      await interaction.answer(outcome)
      return
    }
    const answer = (result.value as { answer: unknown }).answer
    await interaction.answer(answer)
  }
  if (interaction.kind === 'approval') {
    return {
      kind: 'approval',
      key: interaction.key,
      sessionId: interaction.sessionId,
      payload: {
        approvalId: interaction.key,
        toolName: interaction.toolName ?? '',
        reason: interaction.reason ?? '',
      },
      respond,
    }
  }
  return {
    kind: 'question',
    key: interaction.key,
    sessionId: interaction.sessionId,
    payload: { questions: interaction.questions ?? [] },
    respond,
  }
}

/**
 * Resolve the credentials face across host lines. The old line keeps its own
 * `connection.api.credentials`; the new line wraps the positional `remote.
 * credentials` methods (describing positional args, answering `{ ok, value }`)
 * into the envelope shape the card already reads. A host with neither reports
 * failed results instead of crashing the card.
 *
 * @param ctx - client context (service reads only).
 * @returns credential read/write face with the old envelope contract.
 */
export function credentialsFace(ctx: ServiceReader): CredentialsFace {
  const legacy = (ctx.get('connection') as { api?: { credentials?: CredentialsFace } } | undefined)?.api?.credentials
  if (legacy !== undefined) return legacy
  // `remote.credentials` is a child service: read it through `ctx.get` (the
  // non-injecting read) — a property walk on the `remote` service enforces
  // this fiber's inject table and would throw before the card ever mounts.
  const raw = ctx.get('remote.credentials') as RawCredentialsRemote | undefined
  if (raw !== undefined) {
    return {
      describe: async payload => {
        const result = await raw.describe(payload.refs)
        return result.ok
          ? { result: { ok: true, value: { credentials: result.value } } }
          : { result: { ok: false } }
      },
      set: async payload => {
        const result = await raw.set(payload.ref, payload.value)
        return { result: { ok: result.ok } }
      },
    }
  }
  return {
    describe: async () => ({ result: { ok: false } }),
    set: async () => ({ result: { ok: false } }),
  }
}
