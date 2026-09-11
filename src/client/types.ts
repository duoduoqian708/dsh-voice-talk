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
  /** Mic muted inside the loop: capture off, call stays armed. */
  readonly micMuted: boolean
  /** Turn whose readout is playing (karaoke marker target); null when idle. */
  readonly spokenTurn: number | null
  /** Cleaned characters of the spoken turn actually PLAYED, snapped up to a
   *  sentence boundary (the karaoke mark never runs ahead of the voice). */
  readonly spokenChars: number
  /** Speech-start epoch of the current utterance (60s cap UI); null = none. */
  readonly utteranceStartAt: number | null
}

/**
 * One ordered block of an assistant turn's stream. The native page renders
 * each block with its own affordance; this is the call-overlay's mirror of
 * that structure (prose bubbles, collapsible reasoning, tool cards). The
 * readout chain reads ONLY the text blocks — reasoning and tool mechanics
 * are never spoken, on every engine.
 */
export type TranscriptSegment =
  | { readonly kind: 'reasoning'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tool-call'; readonly name: string; readonly args: string }
  | { readonly kind: 'tool-result'; readonly name: string; readonly ok: boolean; readonly text: string }

/** One transcript message in the call overlay's right-hand stream. */
export interface TranscriptMessage {
  /** Conversation-node seq (stable React key). */
  readonly seq: number
  readonly role: 'user' | 'assistant'
  /** Turn id — consecutive assistant nodes of one turn merge into one bubble. */
  readonly turn: number
  /** Joined prose of the turn's text segments (karaoke base; markdown kept). */
  readonly text: string
  /** Ordered block mirror of the turn (reasoning / prose / tools). */
  readonly segments: readonly TranscriptSegment[]
}

/** Published transcript state: the session's message stream for the overlay. */
export interface TranscriptState {
  readonly messages: readonly TranscriptMessage[]
  /** Live partial's blocks as segments (typing bubble); empty when idle. */
  readonly streaming: readonly TranscriptSegment[]
  /** Pending interaction cards (approvals/questions) on the session. */
  readonly pending: number
  /** Names of tools currently executing (live indicator while generating). */
  readonly runningTools: readonly string[]
}
