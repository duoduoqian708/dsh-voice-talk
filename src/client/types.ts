// Shared voice-talk types (status surface consumed by the UI components).

/** What the voice loop is currently doing. */
export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking'

/** Voice system switch: off, or the hands-free loop the user armed. */
export type VoiceMode = 'off' | 'loop'

/** Published status snapshot; reference-stable between changes. */
export interface VoiceStatus {
  readonly mode: VoiceMode
  readonly phase: VoicePhase
  /** Live interim transcript shown while listening. */
  readonly interim: string
  /** Text currently being spoken (the call overlay AI caption). */
  readonly caption: string
  /** Last prompt the voice loop submitted (feeds the caption history). */
  readonly lastPrompt: string
  /** Pending interaction cards (approvals/questions) on the bound session. */
  readonly pendingCount: number
  /** Last failure surfaced to the user (sticky until the next phase move). */
  readonly error: string | null
}

/** One transcript message in the call overlay's right-hand stream. */
export interface TranscriptMessage {
  /** Conversation-node seq (stable React key). */
  readonly seq: number
  readonly role: 'user' | 'assistant'
  /** Turn id — consecutive assistant nodes of one turn merge into one bubble. */
  readonly turn: number
  /** Plain text content (text blocks joined; markdown kept as-is). */
  readonly text: string
}

/** Published transcript state: the session's message stream for the overlay. */
export interface TranscriptState {
  readonly messages: readonly TranscriptMessage[]
  /** Streaming partial's prose (live typing bubble); '' when idle. */
  readonly streaming: string
  /** Pending interaction cards (approvals/questions) on the session. */
  readonly pending: number
}
