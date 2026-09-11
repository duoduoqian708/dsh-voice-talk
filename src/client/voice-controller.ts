// The voice controller: one instance per session backing every voice surface.
// All voice behavior lives inside the call overlay (mode === 'loop'); the
// text mode stays pure text — no speaker, no status strip, one mic button on
// the composer tool row to arm the loop.
//
// Loop:
//   listening --silence--> submit -> thinking --turn settled (running=false)--> speaking --> (cooldown) --> listening
// Thinking spans the whole multi-step turn (prose, tool calls, more prose);
// each step's text feeds the speaker as it streams, and the mic stays off
// until the turn ends.
// The microphone is armed during listening and, only when the user opted into
// barge-in, during speaking; echo-guarded (speaker feed-back is dropped, real
// speech interrupts) and paused while thinking. Failure policy: the loop
// degrades to idle with a surfaced error; it never throws into the framework.

import type { ConversationSnapshot, PartialAssistant } from '@deepseek-ai/dsh-client-runtime/client'
import type { TtsProvider, TtsSession } from './speech.ts'
import { sessionFromSpeak } from './speech.ts'
import { CloudRecognizer } from './asr.ts'
import { cleanForSpeech, cleanStreamProse } from './readout.ts'
export { cleanStreamProse } from './readout.ts'
import { isStopCommand, looksLikeEcho, normalizeForEcho } from './echo-guard.ts'
import { resolveSettings, type VoiceSettings } from './voice-settings.ts'
import { voiceThemeOf } from './voice-themes.ts'
import { SnapshotStore } from './store.ts'
import type { TranscriptMessage, TranscriptSegment, TranscriptState, VoiceStatus } from './types.ts'

/** Shortest finalized utterance worth submitting (filters breaths and noise). */
const MIN_UTTERANCE_CHARS = 2
/** Barge-in arming delay: ignore capture transients right after playback starts. */
const BARGE_IN_ARM_MS = 500
/** Re-arm delay after playback ends, so the speaker tail decays before listening. */
const REARM_COOLDOWN_MS = 900
/** Window after a readout during which re-armed listening still runs the echo guard. */
const ECHO_TAIL_WINDOW_MS = 3_500
/** Give up watching for a reply after this long without snapshot progress. */
const REPLY_TIMEOUT_MS = 180_000
/** Minimum cleaned prose before a sentence boundary is worth a synthesis call. */
const FLUSH_MIN_CHARS = 100
/** Utterance cap: speaking this long without a pause forces a submit. */
const UTTERANCE_CAP_MS = 60_000

/** The input write path the controller submits through. */
export interface InputWriteFace {
  setDraft(text: string): void
  submit(): void
}

/** Session faces the controller needs. */
export interface VoiceControllerDeps {
  /** Draft-write path (the conversation service's SessionInput facade). */
  input: InputWriteFace
  /** Surface a composer-area notice (the SessionInput notify face). */
  notify(level: 'info' | 'error', text: string): void
  /** Live conversation snapshot reader (the session face's observable half). */
  readSnapshot(): ConversationSnapshot
  /** Subscribe to conversation snapshot changes; returns the disposer. */
  subscribeSnapshot(listener: () => void): () => void
  /** Resolved voice settings (re-read on every use; the apply layer merges). */
  settings(): VoiceSettings
}

/** One finalized assistant message relevant to the readout chain. */
export interface AssistantMessageRef {
  readonly seq: number
  readonly turn: number
  readonly text: string
}

/** Concatenated text of the streaming partial's prose blocks. */
function partialTextOf(partial: PartialAssistant): string {
  return partial.blocks
    .filter(block => block.kind === 'text')
    .map(block => (block as { kind: 'text'; text: string }).text)
    .join('')
}

/** Non-empty partial text with at least one real (non-punctuation) character. */
function hasRecognizedText(interim: string): boolean {
  return /[\p{L}\p{N}]/u.test(interim)
}

/**
 * Stream-safe cleaner lives in readout.ts now (shared with the karaoke
 * marker); re-exported above for callers that imported it from here.
 */

/** Index just past the last sentence boundary, or null when none. */
export function lastSentenceBoundary(text: string): number | null {
  const matches = text.matchAll(/[。！？；.!?]/g)
  let last: number | null = null
  for (const match of matches) last = (match.index ?? 0) + 1
  return last
}

/** Collect finalized assistant messages from a snapshot (legacy slice). */
export function assistantMessagesOf(snapshot: ConversationSnapshot): readonly AssistantMessageRef[] {
  const messages: AssistantMessageRef[] = []
  for (const node of snapshot.nodes) {
    if (node.kind !== 'assistant') continue
    const text = node.blocks
      .filter(block => block.kind === 'text')
      .map(block => (block as { kind: 'text'; text: string }).text)
      .join('\n')
    messages.push({ seq: node.seq, turn: node.turn, text })
  }
  return messages
}

/** Count pending interaction cards (approvals, questions) on the session. */
function pendingCountOf(snapshot: ConversationSnapshot): number {
  return snapshot.pending.length
}

/** One blocking wait from the snapshot (approval or question). */
type PendingWait = ConversationSnapshot['pending'][number]
/** One question of a pending question wait. */
type PendingQuestion = Extract<PendingWait, { kind: 'question' }>['payload']['questions'][number]
/** One selectable option of a pending question. */
type PendingOption = NonNullable<PendingQuestion['options']>[number]

/** Voice handling of one blocking interaction: announce → spoken answer →
 *  protocol respond, after which the blocked turn resumes on its own. */
interface PendingVoiceState {
  readonly wait: PendingWait
  /** Current question index inside the wait's batch (0 for approvals). */
  qi: number
  /** Collected answers keyed by question id (labels, or free text). */
  readonly answers: Map<string, { selected: string[]; custom?: string }>
  /** Picks collected so far for the CURRENT multi-select question. */
  collected: string[]
  /** Re-announcements issued for the current item (bounded). */
  retries: number
  /** True once the announcement finished and the mic awaits an answer. */
  awaiting: boolean
}

const CN_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/** Chinese ordinal for 1..10 (falls back to the digit). */
function cnIndex(value: number): string {
  return CN_NUMERALS[value - 1] ?? String(value)
}

/** 1-based option index named in the utterance ("1" / "一" / "第三个"), or null. */
function spokenOptionIndex(text: string, count: number): number | null {
  if (count <= 0) return null
  const u = normalizeForEcho(text)
  if (u === '') return null
  for (let i = 1; i <= count && i <= CN_NUMERALS.length; i++) {
    if (u === CN_NUMERALS[i - 1]) return i
  }
  for (const match of u.matchAll(/\d+/g)) {
    const n = Number(match[0])
    if (n >= 1 && n <= count) return n
  }
  for (let i = 1; i <= count && i <= CN_NUMERALS.length; i++) {
    if (new RegExp(`(第|选|要|走|来)${CN_NUMERALS[i - 1]}(个|号|项)?`).test(u)) return i
  }
  for (const match of u.matchAll(/(?:第|选|要|走|来)(\d+)(?:个|号|项)?/g)) {
    const n = Number(match[1])
    if (n >= 1 && n <= count) return n
  }
  return null
}

/** Option labels the utterance names (containment either way), input order. */
function spokenOptionLabels(text: string, options: readonly PendingOption[]): string[] {
  const u = normalizeForEcho(text)
  if (u === '') return []
  const hits: string[] = []
  for (const option of options) {
    const label = normalizeForEcho(option.label)
    if (label === '') continue
    if (u.includes(label) || (u.length >= 2 && label.includes(u))) hits.push(option.label)
  }
  return hits
}

/** Approval verdict of the utterance; null when neither side is named. */
function spokenApproval(text: string): 'allowed-once' | 'rejected' | null {
  const u = normalizeForEcho(text)
  if (u === '') return null
  if (/不允许|拒绝|不行|不要|不同意|否|别|取消|no/i.test(u)) return 'rejected'
  if (/允许|同意|批准|可以|行|好的|没问题|确定|ok|yes/i.test(u)) return 'allowed-once'
  return null
}

/** A bare option-index answer ("1" / "一" / "第三个") — never a readout tail,
 *  which always carries words after its index, so it bypasses the echo guard
 *  during the answer window. */
function isBareIndexCommand(text: string): boolean {
  return /^(第?[一二三四五六七八九十]|\d+)(个|号|项)?$/.test(normalizeForEcho(text))
}

/** Plain text of one finalized node's blocks (text blocks joined). */
function nodeText(blocks: readonly { kind?: string; type?: string; text?: string }[]): string {
  return blocks
    .filter(block => block.kind === 'text' || block.type === 'text')
    .map(block => block.text ?? '')
    .join('')
}

/** Tool result preview cap — result bodies can dwarf the whole stream. */
const RESULT_PREVIEW_CHARS = 240

/** Block mirror of one assistant step (reasoning / prose / tool calls). */
function segmentsOfBlocks(blocks: readonly unknown[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  for (const block of blocks) {
    const candidate = block as { kind?: string; text?: string; name?: string; argsRaw?: string }
    if (candidate.kind === 'text' && candidate.text !== undefined && candidate.text !== '') {
      out.push({ kind: 'text', text: candidate.text })
    } else if (candidate.kind === 'reasoning' && candidate.text !== undefined && candidate.text !== '') {
      out.push({ kind: 'reasoning', text: candidate.text })
    } else if (candidate.kind === 'tool-call' && candidate.name !== undefined && candidate.name !== '') {
      out.push({ kind: 'tool-call', name: candidate.name, args: candidate.argsRaw ?? '' })
    }
  }
  return out
}

/** Text blocks of a tool result, capped to a preview. */
function resultText(content: readonly unknown[]): string {
  const text = nodeText(content as readonly { kind?: string; type?: string; text?: string }[])
  return text.length > RESULT_PREVIEW_CHARS ? `${text.slice(0, RESULT_PREVIEW_CHARS)}…` : text
}

function sameSegment(a: TranscriptSegment, b: TranscriptSegment): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'text' || a.kind === 'reasoning') {
    return a.text === (b as typeof a).text
  }
  if (a.kind === 'tool-call') {
    const other = b as typeof a
    return a.name === other.name && a.args === other.args
  }
  const other = b as typeof a
  return a.name === other.name && a.ok === other.ok && a.text === other.text
}

function sameSegments(a: readonly TranscriptSegment[], b: readonly TranscriptSegment[]): boolean {
  return a.length === b.length && a.every((segment, i) => sameSegment(segment, b[i]!))
}

/** Joined prose of a turn's text segments (the readout/karaoke base). */
function proseOf(segments: readonly TranscriptSegment[]): string {
  return segments
    .filter((segment): segment is { kind: 'text'; text: string } => segment.kind === 'text')
    .map(segment => segment.text)
    .join('\n\n')
}

function sameTools(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i])
}

/**
 * Transcript slice of a snapshot: finalized user/assistant messages + partial.
 * Pass `prev` to reuse its message objects wherever value-equal: the store's
 * change gate (reference compare) then stays closed for unchanged messages,
 * and memoized rows skip re-rendering while the partial streams.
 */
export function transcriptOf(snapshot: ConversationSnapshot, prev?: TranscriptState): TranscriptState {
  const candidate: TranscriptMessage[] = []
  for (const node of snapshot.nodes) {
    if (node.kind === 'user') {
      const text = nodeText(node.content)
      candidate.push({ seq: node.seq, turn: -1, role: 'user', text, segments: [{ kind: 'text', text }] })
    } else if (node.kind === 'assistant') {
      // One turn often emits several assistant nodes (prose, tool-call
      // interludes, retry outputs); the native stream reads them as ONE
      // message. Fold consecutive same-turn nodes so the stream shows a
      // single avatar + bubble per turn instead of one per node.
      const last = candidate[candidate.length - 1]
      const segments = segmentsOfBlocks(node.blocks as readonly unknown[])
      if (last !== undefined && last.role === 'assistant' && last.turn === node.turn) {
        if (segments.length > 0) {
          const merged = [...last.segments, ...segments]
          candidate[candidate.length - 1] = { ...last, segments: merged, text: proseOf(merged) }
        }
      } else {
        candidate.push({ seq: node.seq, turn: node.turn, role: 'assistant', text: proseOf(segments), segments })
      }
    } else if (node.kind === 'tool-result') {
      // A result pairs with its call head (seq order guarantees the
      // pairing); surface it as a segment on the turn it belongs to.
      const name = node.call?.name ?? node.callId
      const last = candidate[candidate.length - 1]
      if (name !== '' && last !== undefined && last.role === 'assistant') {
        const segment: TranscriptSegment = { kind: 'tool-result', name, ok: !node.isError, text: resultText(node.content as readonly unknown[]) }
        candidate[candidate.length - 1] = { ...last, segments: [...last.segments, segment] }
      }
    }
  }
  const partial = snapshot.partial
  const streaming = partial === null ? [] : segmentsOfBlocks(partial.blocks as readonly unknown[])
  const runningTools = [...new Set(snapshot.runningCalls.map(call => call.name))]
  const pending = snapshot.pending.length
  const messages = candidate.map((message, i) => {
    const before = prev?.messages[i]
    return before !== undefined
      && before.seq === message.seq && before.turn === message.turn && before.role === message.role
      && before.text === message.text && sameSegments(before.segments, message.segments)
      ? before
      : message
  })
  if (prev !== undefined
    && prev.messages.length === messages.length && prev.messages.every((message, i) => message === messages[i])
    && sameSegments(prev.streaming, streaming) && prev.pending === pending
    && sameTools(prev.runningTools, runningTools)) {
    return prev
  }
  return { messages, streaming, pending, runningTools }
}

/** Theme-private params a session rides (model/endpoint overrides included). */
function themeParams(settings: Required<VoiceSettings>): Record<string, unknown> {
  return {
    ...settings.ttsParams,
    qwenModel: settings.qwenModel,
    qwenEndpoint: settings.qwenEndpoint,
    xfyunEndpoint: settings.xfyunEndpoint,
  }
}

/** Session-scope overrides the call HUD writes; null = use the defaults. */
const SESSION_BASE_RATE = 1.0

export class VoiceController {
  readonly status = new SnapshotStore<VoiceStatus>({
    mode: 'off', phase: 'idle', interim: '', caption: '', lastPrompt: '',
    pendingCount: 0, error: null, micMuted: false, spokenTurn: null, spokenChars: 0,
    utteranceStartAt: null,
  })

  /** The session's message stream for the call overlay's right-hand column. */
  readonly transcript = new SnapshotStore<TranscriptState>({
    messages: [], streaming: [], pending: 0, runningTools: [],
  })

  readonly #deps: VoiceControllerDeps
  /** ASR engine cache (one live recognizer per configured vendor). */
  #asrCache: { id: string; recognizer: CloudRecognizer } | null = null
  #recognitionHandle: ReturnType<CloudRecognizer['start']> = null
  /** Speech-start epoch of the current utterance (drives the 60s cap UI). */
  #utteranceStartAt: number | null = null
  #utteranceTimer: ReturnType<typeof setTimeout> | null = null
  #silenceTimer: ReturnType<typeof setTimeout> | null = null
  #rearmTimer: ReturnType<typeof setTimeout> | null = null
  #replyTimer: ReturnType<typeof setTimeout> | null = null
  #echoMuteTimer: ReturnType<typeof setTimeout> | null = null
  #pendingFinal: string | null = null
  /** Voice follow-up for a blocking approval/question (see #checkPending). */
  #pendingVoice: PendingVoiceState | null = null
  /** Waits already responded to; skipped until the snapshot drops them. */
  readonly #resolvedWaits = new Set<string>()
  /** Pending rAF handle coalescing the transcript mirror. */
  #transcriptFrame: number | null = null
  #lastSpokenSeq = 0
  #speaking = false
  #speakingSince = 0
  #spokenText: string | null = null
  /** Text just spoken this round, kept through the re-arm cooldown so the
   *  FIRST utterances back in listening still face the echo guard (speaker
   *  tails land after playback "ends"). */
  #spokenTail: string | null = null
  #spokenTailUntil = 0
  #ttsCache: { id: string; provider: TtsProvider } | null = null
  #session: TtsSession | null = null
  #streamRaw = ''
  #streamFed = 0
  /** Whether the watched turn has shown any life (running, partial, message). */
  #sawTurnActivity = false
  /** Turn id the karaoke marker points at (set as the flushes happen). */
  #spokenTurnId: number | null = null
  /** Bumped per submitted round; a settle from a superseded round is inert. */
  #roundToken = 0
  /** Session-scoped rate override (null = SESSION_BASE_RATE); survives hang-ups. */
  #sessionRate: number | null = null
  /** Session-scoped speaker override (null = theme default); survives hang-ups. */
  #sessionSpeaker: string | null = null
  #disposed = false
  #unsubscribeSnapshot: (() => void) | null = null
  #unsubscribePending: (() => void) | null = null

  constructor(deps: VoiceControllerDeps) {
    this.#deps = deps
    // Transcript mirror (the overlay's right-hand stream) rides the same
    // snapshot subscription as the pending counter.
    this.#syncTranscript()
    // Pending interactions (approval cards) surface inside the call overlay:
    // the user must click them, so the overlay has to know while running.
    this.#unsubscribePending = this.#deps.subscribeSnapshot(() => {
      const count = pendingCountOf(this.#deps.readSnapshot())
      if (count !== this.status.getSnapshot().pendingCount) {
        this.status.patch({ pendingCount: count })
      }
      // The transcript mirror feeds ONLY the call overlay: while no call is
      // armed there is nothing to render, and a long session's snapshot tick
      // must not tax the main thread page-wide. In-call ticks are coalesced
      // to one rebuild per frame (streaming emits many per frame).
      if (this.status.getSnapshot().mode === 'loop') this.#queueTranscriptSync()
      this.#checkPending()
    })
  }

  /** Rebuild the transcript store from the current snapshot (change-gated). */
  #syncTranscript(): void {
    const prev = this.transcript.getSnapshot()
    const next = transcriptOf(this.#deps.readSnapshot(), prev)
    if (next === prev) return
    this.transcript.set(next)
  }

  /** Coalesce in-call transcript mirroring to one rebuild per frame. */
  #queueTranscriptSync(): void {
    if (this.#transcriptFrame !== null) return
    this.#transcriptFrame = requestAnimationFrame(() => {
      this.#transcriptFrame = null
      if (this.#disposed) return
      if (this.status.getSnapshot().mode !== 'loop') return
      this.#syncTranscript()
    })
  }

  /** Enter the hands-free loop (the mic button's on arm). */
  startLoop(): void {
    if (this.status.getSnapshot().mode === 'loop') return
    this.#lastSpokenSeq = this.#latestAssistantSeq()
    // The overlay's first render needs the mirror ready — sync BEFORE the
    // mode flips (the subscription only mirrors while already in loop).
    this.#syncTranscript()
    this.status.patch({ mode: 'loop', error: null, lastPrompt: '' })
    this.#armListening()
    // Entering with a blocking wait already pending: handle it right away.
    this.#checkPending()
  }

  /** Leave any voice activity: stop everything and go idle (pure off switch). */
  stopVoice(): void {
    this.#disarmAll()
    this.status.patch({ mode: 'off', phase: 'idle', interim: '', caption: '', micMuted: false, spokenTurn: null, spokenChars: 0, utteranceStartAt: null })
  }

  /**
   * Toggle in-call mic mute: capture stops (system recording indicator off),
   * the call itself stays armed — unmuting re-arms recognition where the loop
   * currently is (listening, or speaking with barge-in opted in).
   */
  toggleMute(): void {
    if (this.status.getSnapshot().mode !== 'loop') return
    const muted = !this.status.getSnapshot().micMuted
    this.status.patch({ micMuted: muted, interim: '' })
    if (muted) {
      this.#clearUtterance()
      this.#recognitionHandle?.stop()
      this.#recognitionHandle = null
      this.#pendingFinal = null
      if (this.#silenceTimer !== null) {
        clearTimeout(this.#silenceTimer)
        this.#silenceTimer = null
      }
    } else if (this.#rearmListeningAfterMute()) {
      this.#startRecognition()
    }
  }

  /**
   * Session-scope rate override (call HUD writes). Effective immediately,
   * survives hang-ups within this session, dies with the session itself.
   */
  setSessionRate(rate: number): void {
    this.#sessionRate = rate
  }

  /** Session-scope speaker override (same lifecycle as the rate override). */
  setSessionSpeaker(voice: string): void {
    this.#sessionSpeaker = voice
  }

  /**
   * The resolved settings as this session sees them: the stored defaults are
   * the base, with the HUD's session overrides applied on top — the rate
   * override replaces `rate` outright (base is the constant 1.0, stored
   * values are never read), and the speaker override is folded into
   * `speakerByTheme[theme]` so every existing read path picks it up.
   * A theme's default speaker fills an unset entry too: without it the
   * readout chain sends an empty voice name and cloud vendors reject the
   * whole synthesis (the settings-page try-listen never sees this because
   * it applies the default itself).
   * The readout chain and the HUD readouts both go through here.
   */
  effectiveSettings(): Required<VoiceSettings> {
    const resolved = resolveSettings(this.#deps.settings())
    const speakerByTheme = { ...resolved.speakerByTheme }
    const themeDefault = voiceThemeOf(resolved.ttsTheme)?.defaultSpeaker
    if (themeDefault !== undefined && speakerByTheme[resolved.ttsTheme] === undefined) {
      speakerByTheme[resolved.ttsTheme] = themeDefault
    }
    const speaker = this.#sessionSpeaker ?? speakerByTheme[resolved.ttsTheme] ?? ''
    return {
      ...resolved,
      rate: this.#sessionRate ?? SESSION_BASE_RATE,
      speakerByTheme: speaker === '' ? speakerByTheme : { ...speakerByTheme, [resolved.ttsTheme]: speaker },
    }
  }

  /** Force-cancel the current readout (skip button inside the overlay). */
  stopSpeaking(): void {
    if (!this.#speaking) return
    this.#speaker().cancel()
  }

  dispose(): void {
    this.#disposed = true
    if (this.#transcriptFrame !== null) {
      cancelAnimationFrame(this.#transcriptFrame)
      this.#transcriptFrame = null
    }
    this.#unsubscribePending?.()
    this.#unsubscribePending = null
    this.#disarmAll()
  }

  // ---- recognition arm -----------------------------------------------------

  /** Start the engine with handlers routed by the current phase. */
  #startRecognition(): void {
    if (this.#disposed) return
    if (this.status.getSnapshot().micMuted) return
    if (this.#recognitionHandle !== null) return
    const recognizer = this.#recognizerFor()
    if (!recognizer.supported()) {
      this.#notifyError('此浏览器不支持语音采集（需要麦克风与 WebSocket）')
      this.#degradeToIdle()
      return
    }
    const settings = resolveSettings(this.#deps.settings())
    this.#recognitionHandle = recognizer.start({
      onInterim: interim => {
        this.status.patch({ interim: this.#composeInterim(interim) })
        if (hasRecognizedText(interim)) {
          // The 60s cap opens on the FIRST recognized text, never on raw mic
          // energy: wind, keyboards, and room noise must not start the clock —
          // only text the cloud model actually produced counts as input.
          this.#openUtteranceWindow()
          // The flush window counts from the LAST recognized text, not from
          // the last vendor final: a final lands at a pause, so the old timer
          // could expire mid-speech once the user resumed talking.
          if (this.#pendingFinal !== null) this.#resetSilenceTimer()
        }
      },
      onFinal: text => this.#onFinalUtterance(text),
      onEnd: () => { /* the recognizer reconnects itself */ },
      onError: (message, fatal) => {
        if (fatal) {
          this.#notifyError(message)
          this.#degradeToIdle()
        }
      },
    }, {
      // Per-arm options: a changed 模型 ID / endpoint lands on the next arm.
      lang: settings.voiceLang,
      model: settings.asrTheme === 'xfyun' ? undefined : settings.asrQwenModel,
      endpoint: settings.asrTheme === 'xfyun' ? settings.asrXfyunEndpoint : settings.asrQwenEndpoint,
    })
    if (this.#recognitionHandle === null) this.#degradeToIdle()
  }

  /**
   * The recognizer the settings' 听 engine selects (one cached instance per
   * vendor; the bridge surfaces missing credentials as a fatal error itself).
   */
  #recognizerFor(): CloudRecognizer {
    const vendor = resolveSettings(this.#deps.settings()).asrTheme === 'xfyun' ? 'xfyun' : 'qwen'
    if (this.#asrCache !== null && this.#asrCache.id === vendor) return this.#asrCache.recognizer
    const recognizer = new CloudRecognizer(vendor)
    this.#asrCache = { id: vendor, recognizer }
    return recognizer
  }

  /** First recognized text of an utterance opens the 60s cap window. */
  #openUtteranceWindow(): void {
    const snap = this.status.getSnapshot()
    if (this.#disposed || snap.mode !== 'loop' || snap.micMuted) return
    if (snap.phase !== 'listening' || this.#utteranceStartAt !== null) return
    const startAt = Date.now()
    this.#utteranceStartAt = startAt
    this.status.patch({ utteranceStartAt: startAt })
    this.#utteranceTimer = setTimeout(() => {
      this.#utteranceTimer = null
      // Cap reached: force the turn out even if the user keeps talking.
      this.#flushPending()
    }, UTTERANCE_CAP_MS)
  }

  /** Close the cap window (submit, mute, hang-up, phase leave all land here). */
  #clearUtterance(): void {
    if (this.#utteranceTimer !== null) {
      clearTimeout(this.#utteranceTimer)
      this.#utteranceTimer = null
    }
    this.#utteranceStartAt = null
    this.status.patch({ utteranceStartAt: null })
  }

  #armListening(): void {
    if (this.#disposed) return
    this.status.patch({ phase: 'listening', interim: '', caption: '' })
    this.#startRecognition()
  }

  #degradeToIdle(): void {
    this.#recognitionHandle?.stop()
    this.#recognitionHandle = null
    if (this.status.getSnapshot().mode !== 'off') this.status.patch({ mode: 'off' })
    this.status.patch({ phase: 'idle', interim: '', caption: '' })
  }

  /** Surface a voice failure on the composer (visible outside the overlay). */
  #notifyError(text: string): void {
    this.status.patch({ error: text })
    this.#deps.notify('error', text)
  }

  #onFinalUtterance(text: string): void {
    if (text === '') return
    // Guard every entry: a late final can arrive after the loop is gone
    // (abort races, timeout degrade) — it must never reach the composer.
    if (this.status.getSnapshot().mode !== 'loop') return
    if (this.status.getSnapshot().micMuted) return
    if (this.#speaking) {
      // Stop commands first: they bypass the echo guard and the arm delay
      // (the guard unconditionally eats short commands), and they only
      // silence the readout — cancelling the session lets #settleTurn's
      // await resolve and the round close back into listening, without
      // submitting the command as a prompt.
      if (isStopCommand(text)) {
        this.#speaker().cancel()
        return
      }
      const settings = resolveSettings(this.#deps.settings())
      const armed = settings.allowInterrupt
        && Date.now() - this.#speakingSince >= BARGE_IN_ARM_MS
        && !looksLikeEcho(text, this.#spokenText ?? '')
      if (!armed) {
        // Echo (or barge-in disabled): drop it AND mute briefly, so the same
        // speaker tail cannot re-finalize into a chain of echo triggers.
        this.#muteAfterEcho()
        return
      }
      // Barge-in: the readout dies, the utterance becomes the next prompt.
      this.#speaking = false
      this.#spokenText = null
      this.#speaker().cancel()
      this.#submitUtterance(text)
      return
    }
    // Just-re-armed listening: the mic may still be capturing the speaker's
    // own tail (playback "ended" but audio is still in the air). Run the echo
    // guard against the last readout for a short window.
    if (Date.now() < this.#spokenTailUntil && this.#spokenTail !== null) {
      // A bare option index is a plausible fast answer, never a tail capture
      // (the tail always carries words after its index) — let it through.
      if (looksLikeEcho(text, this.#spokenTail) && !(this.#pendingVoice !== null && isBareIndexCommand(text))) {
        this.#muteAfterEcho()
        return
      }
      this.#spokenTailUntil = 0
    }
    // A blocking interaction owns the mic while it waits: the answer goes to
    // the matcher → protocol respond, never into the composer.
    if (this.#pendingVoice !== null || this.#deps.readSnapshot().pending.length > 0) {
      this.#handlePendingAnswer(text)
      return
    }
    // Accumulate finalized text; the silence timer flushes it as one prompt.
    this.#pendingFinal = this.#pendingFinal === null ? text : `${this.#pendingFinal}，${text}`
    this.#resetSilenceTimer()
    // Keep the finalized text on screen through the pause — the next
    // utterance's interim would otherwise replace it visually (the data
    // already survives in #pendingFinal; this is display continuity only).
    this.status.patch({ interim: this.#pendingFinal })
  }

  /**
   * Live display composer: finalized-but-unsubmitted text stays visible
   * ahead of the current utterance's streaming interim, joined with the
   * same '，' the submission uses — what the user reads is what will be sent.
   */
  #composeInterim(live: string): string {
    if (this.#pendingFinal === null) return live
    if (live === '') return this.#pendingFinal
    return `${this.#pendingFinal}，${live}`
  }

  /** Drop capture for a moment after an echo hit, then re-arm cleanly. */
  #muteAfterEcho(): void {
    this.#recognitionHandle?.stop()
    this.#recognitionHandle = null
    // Keep #pendingFinal: the echo segment never reached the buffer, so what
    // is held here is real finalized speech from before the hit — wiping it
    // dropped the pre-pause half of a two-segment utterance. Only the flush
    // countdown is put on hold while the mic is down.
    if (this.#silenceTimer !== null) {
      clearTimeout(this.#silenceTimer)
      this.#silenceTimer = null
    }
    this.status.patch({ interim: this.#pendingFinal ?? '' })
    if (this.#echoMuteTimer !== null) clearTimeout(this.#echoMuteTimer)
    if (this.#rearmListeningAfterMute()) {
      this.#echoMuteTimer = setTimeout(() => {
        this.#echoMuteTimer = null
        if (!this.#rearmListeningAfterMute()) return
        this.#startRecognition()
        // Nothing new has been recognized yet: give the kept buffer its own
        // silence window so it cannot be stranded until the next utterance.
        if (this.#pendingFinal !== null) this.#resetSilenceTimer()
      }, 2_000)
    }
  }

  /** Whether the mic should be (re)started where we are in the loop. */
  #rearmListeningAfterMute(): boolean {
    if (this.#disposed || this.status.getSnapshot().mode !== 'loop') return false
    const phase = this.status.getSnapshot().phase
    return phase === 'listening'
      || (phase === 'speaking' && resolveSettings(this.#deps.settings()).allowInterrupt)
  }

  #resetSilenceTimer(): void {
    if (this.#silenceTimer !== null) clearTimeout(this.#silenceTimer)
    const seconds = resolveSettings(this.#deps.settings()).silenceTimeout
    this.#silenceTimer = setTimeout(() => this.#flushPending(), seconds * 1000)
  }

  #flushPending(): void {
    if (this.#silenceTimer !== null) {
      clearTimeout(this.#silenceTimer)
      this.#silenceTimer = null
    }
    // The utterance window closes whatever flushed it (silence, the 60s cap).
    this.#clearUtterance()
    const text = this.#pendingFinal
    this.#pendingFinal = null
    // The flush timer can outlive a hang-up by a beat; never submit then.
    if (this.status.getSnapshot().mode !== 'loop') return
    if (text === null || text.length < MIN_UTTERANCE_CHARS) return
    this.#submitUtterance(text)
  }

  // ---- blocking interactions: speak the ask, match the spoken answer -------

  /** Snapshot watch: start (or retire) voice handling for pending waits. */
  #checkPending(): void {
    const waits = this.#deps.readSnapshot().pending
    if (this.#resolvedWaits.size > 0) {
      const keys = new Set(waits.map(wait => wait.key))
      for (const key of [...this.#resolvedWaits]) if (!keys.has(key)) this.#resolvedWaits.delete(key)
    }
    const active = this.#pendingVoice
    if (active !== null) {
      // Resolved elsewhere (native card, another tab): drop the voice flow
      // and hand the loop back to the reply watch.
      if (!waits.some(wait => wait.key === active.wait.key)) {
        this.#pendingVoice = null
        if (this.status.getSnapshot().mode === 'loop') {
          this.status.patch({ phase: 'thinking' })
          this.#bumpReplyTimer()
        }
      }
      return
    }
    if (this.status.getSnapshot().mode !== 'loop') return
    const wait = waits.find(candidate => !this.#resolvedWaits.has(candidate.key))
    if (wait === undefined) return
    this.#pendingVoice = { wait, qi: 0, answers: new Map(), collected: [], retries: 0, awaiting: false }
    void this.#announcePending()
  }

  /** The question currently being asked (questions only; null for approvals). */
  #pendingQuestion(): PendingQuestion | null {
    const state = this.#pendingVoice
    if (state === null || state.wait.kind !== 'question') return null
    return state.wait.payload.questions[state.qi] ?? null
  }

  /** Spoken form of the item at the head of the active wait. */
  #pendingAnnouncement(): string {
    const state = this.#pendingVoice
    if (state === null) return ''
    const wait = state.wait
    if (wait.kind === 'approval') {
      const reason = wait.payload.reason !== undefined && wait.payload.reason !== '' ? `，原因：${wait.payload.reason}` : ''
      return `工具「${wait.payload.toolName}」请求执行${reason}。允许请说「允许」，拒绝请说「拒绝」。`
    }
    const questions = wait.payload.questions
    const item = questions[state.qi]
    if (item === undefined) return ''
    const parts: string[] = []
    if (questions.length > 1) parts.push(`第${cnIndex(state.qi + 1)}个问题`)
    parts.push(item.question)
    const options = item.options ?? []
    options.forEach((option, i) => parts.push(`第${cnIndex(i + 1)}个，${option.label}`))
    if (options.length === 0) parts.push('请直接说出你的答案')
    else if (item.multiSelect === true) parts.push('可以多选，选好后说「好了」提交')
    else if (item.intent?.kind === 'plan-review') parts.push('通过请说「通过」，不同意请说「拒绝」')
    else parts.push('你想选哪个？')
    return parts.join('。')
  }

  /** Announce the current item (optional prefix), then listen for the answer. */
  async #announcePending(prefix = ''): Promise<void> {
    const state = this.#pendingVoice
    if (state === null) return
    // The prose that preceded the ask flushes first (it may be mid-sentence).
    if (this.status.getSnapshot().phase === 'thinking') this.#flushStreamSentences(true)
    const text = `${prefix}${this.#pendingAnnouncement()}`
    if (text === '') return
    await this.#pendingSpeak(text, state)
  }

  /** One announcement through the shared synthesis path, then re-arm the mic. */
  async #pendingSpeak(text: string, state: PendingVoiceState): Promise<void> {
    // A human is answering: the stuck-turn timer must not fire meanwhile.
    if (this.#replyTimer !== null) {
      clearTimeout(this.#replyTimer)
      this.#replyTimer = null
    }
    this.#recognitionHandle?.stop()
    this.#recognitionHandle = null
    const session = this.#ensureSession()
    if (session !== null) {
      this.status.patch({ phase: 'speaking' })
      this.#speaking = true
      this.#speakingSince = Date.now()
      this.#spokenText = text
      session.push(text)
      session.done()
      this.#session = null
      try { await session.finished } catch (error) {
        this.#notifyError(error instanceof Error ? error.message : String(error))
      }
      this.#endSpeaking()
    }
    this.#spokenText = null
    // The spoken ask is the echo reference for the answer window: the room
    // hears it too, and a re-captured option must not count as a pick. The
    // window is short — a person answers well after a 1s tail decays.
    this.#spokenTail = text
    this.#spokenTailUntil = Date.now() + 1_000
    if (this.#disposed || this.status.getSnapshot().mode !== 'loop') return
    if (this.#pendingVoice !== state) return
    state.awaiting = true
    this.status.patch({ phase: 'listening', interim: '', caption: '' })
    this.#startRecognition()
  }

  /** A spoken final while a wait is active: match → respond, or re-ask. */
  #handlePendingAnswer(text: string): void {
    const state = this.#pendingVoice
    if (state === null) {
      this.#checkPending()
      return
    }
    const wait = state.wait
    if (wait.kind === 'approval') {
      const outcome = spokenApproval(text)
      if (outcome === null) {
        this.#reaskPending()
        return
      }
      this.#respondWait(wait, {
        ok: true,
        value: { sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome },
      })
      return
    }
    const item = this.#pendingQuestion()
    if (item === null) return
    const options = item.options ?? []
    const normalized = normalizeForEcho(text)
    const done = /^(好了|就这些|就这样|确定|确认|提交|完成|可以了|没问题)$/.test(normalized)
    if (options.length === 0) {
      // Free-text question: the answer is the utterance itself.
      this.#commitPendingAnswer(state, item, { selected: [], custom: text })
      return
    }
    let picks: string[] = []
    if (item.intent?.kind === 'plan-review') {
      const approve = item.intent.approve
      if (/通过|同意|批准|可以|没问题/.test(normalized)) picks = [approve]
      else if (/拒绝|不行|不同意|否|不接受/.test(normalized)) {
        const other = options.find(option => option.label !== approve)
        if (other !== undefined) picks = [other.label]
      }
    }
    if (picks.length === 0) {
      const index = spokenOptionIndex(text, options.length)
      if (index !== null) picks = [options[index - 1]!.label]
      else picks = spokenOptionLabels(text, options)
    }
    if (item.multiSelect === true) {
      for (const label of picks) if (!state.collected.includes(label)) state.collected.push(label)
      if (state.collected.length > 0 && done) {
        this.#commitPendingAnswer(state, item)
        return
      }
      if (picks.length > 0) {
        const rest = item.multiSelect === true ? '继续说，或者说「好了」提交。' : ''
        void this.#pendingSpeak(`已记住${picks.join('和')}。${rest}`, state)
        return
      }
      this.#reaskPending()
      return
    }
    if (picks.length > 0) {
      this.#commitPendingAnswer(state, item, { selected: [picks[0]!] })
      return
    }
    this.#reaskPending()
  }

  /** Record one answer; advance to the next question or respond the wait. */
  #commitPendingAnswer(state: PendingVoiceState, item: PendingQuestion, answer?: { selected: string[]; custom?: string }): void {
    const resolved = answer ?? {
      selected: (item.options ?? []).map(option => option.label).filter(label => state.collected.includes(label)),
    }
    state.answers.set(item.id, resolved)
    state.collected = []
    state.retries = 0
    const wait = state.wait
    if (wait.kind !== 'question') return
    const questions = wait.payload.questions
    if (state.qi + 1 < questions.length) {
      state.qi += 1
      void this.#announcePending()
      return
    }
    const answers = questions.map(question => {
      const held = state.answers.get(question.id)
      return held === undefined ? { id: question.id, selected: [] } : { id: question.id, ...held }
    })
    this.#respondWait(wait, { ok: true, value: { sessionId: wait.sessionId, answer: { answers } } })
  }

  /** Re-announce the current item (bounded) so a missed answer can retry. */
  #reaskPending(): void {
    const state = this.#pendingVoice
    if (state === null || state.retries >= 2) return
    state.retries += 1
    void this.#announcePending('没听清，请再说一次。')
  }

  /** Send the protocol response and hand the loop back to the reply watch. */
  #respondWait(wait: PendingWait, result: { ok: true; value: unknown }): void {
    this.#pendingVoice = null
    this.#resolvedWaits.add(wait.key)
    try {
      void wait.respond(result).catch(error => {
        this.#notifyError(error instanceof Error ? error.message : String(error))
      })
    } catch (error) {
      this.#notifyError(error instanceof Error ? error.message : String(error))
    }
    // The turn resumes once the host settles the wait: back to the watch; the
    // resumed prose opens a fresh synthesis session on its own.
    if (this.#disposed || this.status.getSnapshot().mode !== 'loop') return
    this.status.patch({ phase: 'thinking' })
    this.#bumpReplyTimer()
  }

  // ---- submission + readout chain ------------------------------------------

  #submitUtterance(text: string): void {
    // The mic pauses while the agent works; it re-arms after the readout.
    this.#recognitionHandle?.stop()
    this.#recognitionHandle = null
    this.#clearUtterance()
    if (this.#silenceTimer !== null) {
      clearTimeout(this.#silenceTimer)
      this.#silenceTimer = null
    }
    this.#roundToken += 1
    this.status.patch({ interim: '', caption: '', lastPrompt: text, phase: 'thinking' })
    this.#deps.input.setDraft(text)
    this.#deps.input.submit()
    this.#prepareStream()
    this.#watchForReply()
  }

  /**
   * Subscribe to the reply stream. A turn often runs several steps (prose,
   * tool calls, more prose): partial text feeds the speaker sentence by
   * sentence as each step streams, every finalized step flushes its
   * authoritative text, and the session closes only when the TURN ends
   * (`running` falls false) — never on the first step. A stuck turn must
   * not trap the loop (timeout keeps the fallback).
   */
  #watchForReply(): void {
    this.#unsubscribeSnapshot?.()
    // Newest-wins readout: a new prompt invalidates every finalized reply
    // sitting unspoken (generated while unwatched) — never read stale debt.
    this.#lastSpokenSeq = this.#latestAssistantSeq()
    this.#sawTurnActivity = false
    this.#unsubscribeSnapshot = this.#deps.subscribeSnapshot(() => this.#onSnapshotStream())
    this.#bumpReplyTimer()
    queueMicrotask(() => this.#onSnapshotStream())
  }

  /** Reset the stuck-turn timer; snapshot progress keeps a slow turn alive. */
  #bumpReplyTimer(): void {
    if (this.#replyTimer !== null) clearTimeout(this.#replyTimer)
    this.#replyTimer = setTimeout(() => {
      if (this.#disposed || this.status.getSnapshot().phase !== 'thinking') return
      this.#teardownReplyWatch()
      this.#notifyError('回复等待超时')
      this.#finishRound()
    }, REPLY_TIMEOUT_MS)
  }

  /** Stream tick: feed new cleaned prose to the speaker, flush sentence-wise. */
  #onSnapshotStream(): void {
    if (this.#disposed) return
    if (this.status.getSnapshot().phase !== 'thinking') return
    const snapshot = this.#deps.readSnapshot()
    const fresh = assistantMessagesOf(snapshot).filter(m => m.seq > this.#lastSpokenSeq)
    if (fresh.length > 0 || snapshot.partial !== null || snapshot.running) this.#sawTurnActivity = true
    // Live partial of the in-flight step feeds the speaker sentence by sentence.
    const partial = snapshot.partial
    if (partial !== null) {
      this.#spokenTurnId = partial.turn
      const prose = partialTextOf(partial)
      if (prose.length > this.#streamRaw.length) {
        this.#streamRaw = prose
        this.#flushStreamSentences(false)
      }
    }
    // Finalized steps flush their authoritative text (the partial may lag),
    // then the offsets reset so the next step starts from zero.
    for (const message of fresh) {
      this.#lastSpokenSeq = message.seq
      this.#spokenTurnId = message.turn
      if (message.text !== '') {
        this.#streamRaw = message.text
      }
      // A step that finalizes without its own text still flushes whatever
      // the partial streamed (aborted drafts, fold quirks) — never drop it.
      this.#flushStreamSentences(true)
      this.#streamRaw = ''
      this.#streamFed = 0
    }
    // Turn settled: close the session, play the tail, hand back to listening.
    if (this.#sawTurnActivity && !snapshot.running) {
      this.#teardownReplyWatch()
      void this.#settleTurn()
      return
    }
    this.#bumpReplyTimer()
  }

  /**
   * Push every complete sentence beyond the fed offset to the session.
   * `final` flushes the partial tail as well (end of step). Offsets live in
   * CLEANED-character space of the current step's raw text. Every pushed
   * piece is also accumulated into #spokenText: the echo guard needs to know
   * what is being said RIGHT NOW, or barge-in-era feedback sails through and
   * the loop self-excites.
   */
  #flushStreamSentences(final: boolean): void {
    const cleaned = cleanStreamProse(this.#streamRaw)
    if (cleaned.length <= this.#streamFed) return
    const pending = cleaned.slice(this.#streamFed)
    const cut = lastSentenceBoundary(pending)
    if (cut === null || (cut < FLUSH_MIN_CHARS && !final)) return
    const take = final ? pending.length : cut
    const piece = pending.slice(0, take)
    this.#streamFed += take
    this.#spokenText = (this.#spokenText ?? '') + piece
    this.#ensureSession()?.push(piece)
  }

  /** End of turn: flush any tail still held by the partial, then settle. */
  async #settleTurn(): Promise<void> {
    if (this.#disposed) return
    const token = this.#roundToken
    const settings = resolveSettings(this.#deps.settings())
    // The fold of the last in-flight step may land after `running` fell; the
    // partial still holds its text, so flush that remainder before closing —
    // the flush is also where a lazily-opened session may first start, so it
    // must run before the session-null gate below.
    const partial = this.#deps.readSnapshot().partial
    if (partial !== null) {
      const prose = partialTextOf(partial)
      if (prose.length > this.#streamRaw.length) this.#streamRaw = prose
      this.#flushStreamSentences(true)
    }
    const session = this.#session
    if (session === null) {
      this.#finishRound()
      return
    }
    this.status.patch({ phase: 'speaking' })
    this.#speaking = true
    this.#speakingSince = Date.now()
    session.done()
    if (settings.allowInterrupt) this.#startRecognition()
    try {
      await session.finished
    } catch (error) {
      this.#notifyError(error instanceof Error ? error.message : String(error))
    }
    // A barge-in may have submitted a newer round while we waited; that
    // round owns the loop now and a stale settle must not re-arm over it.
    if (token !== this.#roundToken) return
    this.#endSpeaking()
    this.#finishRound()
  }

  #teardownReplyWatch(): void {
    this.#unsubscribeSnapshot?.()
    this.#unsubscribeSnapshot = null
    if (this.#replyTimer !== null) {
      clearTimeout(this.#replyTimer)
      this.#replyTimer = null
    }
  }

  /** Reset the readout stream for the upcoming reply. The synthesis session
   *  itself opens lazily on the first real sentence (#ensureSession): opened
   *  at submit it idled through tool-heavy turns past the bridge's 120s
   *  limit and died before any audio — text arrived, nothing was spoken. */
  #prepareStream(): void {
    this.#streamRaw = ''
    this.#streamFed = 0
    this.#session = null
    this.#spokenText = ''
    this.#spokenTail = null
    this.#spokenTailUntil = 0
    this.#spokenTurnId = null
    this.status.patch({ spokenTurn: null, spokenChars: 0 })
  }

  /** Open (or reuse) the synthesis session for the upcoming sentences. */
  #ensureSession(): TtsSession | null {
    if (this.#session !== null) return this.#session
    const provider = this.#speaker()
    if (!provider.supported()) return null
    const settings = this.effectiveSettings()
    const speaker = settings.speakerByTheme[settings.ttsTheme] ?? settings.voiceName
    try {
      const opts = { rate: settings.rate, lang: settings.voiceLang, voiceName: speaker, params: themeParams(settings) }
      const interrupted = (): void => { /* interrupted: the recognizer's next final drives the loop */ }
      const progress = (chars: number): void => this.status.patch({ spokenTurn: this.#spokenTurnId, spokenChars: chars })
      // Extracting the method into the old `?? fallback` one-liner dropped
      // `this` (strict-mode detached call): both providers register the
      // session on the instance there (#activeSession), so it threw.
      const startSession = provider.startSession
      this.#session = startSession !== undefined
        ? startSession.call(provider, opts, interrupted, progress)
        : sessionFromSpeak(provider, opts, interrupted, progress)
    } catch (error) {
      this.#notifyError(error instanceof Error ? error.message : String(error))
      return null
    }
    return this.#session
  }

  #endSpeaking(): void {
    this.#speaking = false
    // #spokenText deliberately survives: #finishRound turns it into the
    // re-arm echo guard (speaker tails land after playback "ends").
  }

  #finishRound(): void {
    if (this.#disposed) return
    const mode = this.status.getSnapshot().mode
    if (mode !== 'loop') {
      this.#recognitionHandle?.stop()
      this.#recognitionHandle = null
      this.status.patch({ mode: 'off', phase: 'idle', interim: '', caption: '', spokenTurn: null, spokenChars: 0, utteranceStartAt: null })
      return
    }
    // Cooldown: let the speaker tail decay, then listen again. The tail of
    // what was just spoken stays armed as an echo guard for the first
    // utterances of the next listening phase (tails land after "playback end").
    this.#recognitionHandle?.stop()
    this.#recognitionHandle = null
    this.#pendingFinal = null
    const spoken = this.#spokenText
    if (spoken !== null && spoken !== '') {
      this.#spokenTail = spoken
      this.#spokenTailUntil = Date.now() + REARM_COOLDOWN_MS + ECHO_TAIL_WINDOW_MS
    } else {
      this.#spokenTail = null
      this.#spokenTailUntil = 0
    }
    if (this.#rearmTimer !== null) clearTimeout(this.#rearmTimer)
    this.#rearmTimer = setTimeout(() => {
      this.#rearmTimer = null
      this.#armListening()
    }, REARM_COOLDOWN_MS)
    // The round's readout is over: drop the karaoke marker.
    this.status.patch({ spokenTurn: null, spokenChars: 0 })
  }

  // ---- helpers -------------------------------------------------------------

  /** Resolve the active voice theme's provider (cached per theme id). */
  #speaker(): TtsProvider {
    const themeId = resolveSettings(this.#deps.settings()).ttsTheme
    if (this.#ttsCache !== null && this.#ttsCache.id === themeId) return this.#ttsCache.provider
    const theme = voiceThemeOf(themeId) ?? voiceThemeOf('system')!
    const provider = theme.create()
    this.#ttsCache = { id: theme.id, provider }
    return provider
  }

  #latestAssistantSeq(): number {
    const messages = assistantMessagesOf(this.#deps.readSnapshot())
    return messages.length > 0 ? messages[messages.length - 1]!.seq : 0
  }

  #disarmAll(): void {
    this.#recognitionHandle?.stop()
    this.#recognitionHandle = null
    this.#speaker().cancel()
    this.#pendingVoice = null
    this.#resolvedWaits.clear()
    this.#clearUtterance()
    if (this.#silenceTimer !== null) {
      clearTimeout(this.#silenceTimer)
      this.#silenceTimer = null
    }
    if (this.#rearmTimer !== null) {
      clearTimeout(this.#rearmTimer)
      this.#rearmTimer = null
    }
    if (this.#echoMuteTimer !== null) {
      clearTimeout(this.#echoMuteTimer)
      this.#echoMuteTimer = null
    }
    this.#teardownReplyWatch()
    this.#session?.cancel()
    this.#session = null
    this.#streamRaw = ''
    this.#streamFed = 0
    this.#speaking = false
    this.#spokenText = null
    this.#spokenTail = null
    this.#spokenTailUntil = 0
    this.#pendingFinal = null
    this.#sawTurnActivity = false
    this.#spokenTurnId = null
  }
}
