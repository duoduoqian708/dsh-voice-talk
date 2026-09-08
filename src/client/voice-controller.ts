// The voice controller: one instance per session backing every voice surface.
// All voice behavior lives inside the call overlay (mode === 'loop'); the
// text mode stays pure text — no speaker, no status strip, one mic button on
// the composer tool row to arm the loop.
//
// Loop:
//   listening --silence--> submit -> thinking --assistant message--> speaking --> (cooldown) --> listening
// The microphone is armed during listening and, only when the user opted into
// barge-in, during speaking; echo-guarded (speaker feed-back is dropped, real
// speech interrupts) and paused while thinking. Failure policy: the loop
// degrades to idle with a surfaced error; it never throws into the framework.

import type { ConversationSnapshot, PartialAssistant } from '@deepseek-ai/dsh-client-runtime/client'
import type { TtsProvider, TtsSession } from './speech.ts'
import { ChromeRecognizer, sessionFromSpeak } from './speech.ts'
import { cleanForSpeech, extractReadout } from './readout.ts'
import { looksLikeEcho } from './echo-guard.ts'
import { resolveSettings, type VoiceSettings } from './voice-settings.ts'
import { voiceThemeOf } from './voice-themes.ts'
import { SnapshotStore } from './store.ts'
import type { TranscriptMessage, TranscriptState, VoiceStatus } from './types.ts'

/** Shortest finalized utterance worth submitting (filters breaths and noise). */
const MIN_UTTERANCE_CHARS = 2
/** Barge-in arming delay: ignore capture transients right after playback starts. */
const BARGE_IN_ARM_MS = 500
/** Re-arm delay after playback ends, so the speaker tail decays before listening. */
const REARM_COOLDOWN_MS = 400
/** Give up watching for a reply after this long (stuck turn, provider error). */
const REPLY_TIMEOUT_MS = 120_000
/** Minimum cleaned prose before a sentence boundary is worth a synthesis call. */
const FLUSH_MIN_CHARS = 100

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
  readonly text: string
}

/** Concatenated text of the streaming partial's prose blocks. */
function partialTextOf(partial: PartialAssistant): string {
  return partial.blocks
    .filter(block => block.kind === 'text')
    .map(block => (block as { kind: 'text'; text: string }).text)
    .join('')
}

/**
 * Stream-safe cleaner: like cleanForSpeech, but an UNCLOSED fenced code block
 * is swallowed whole (its content may still be arriving) instead of leaking
 * code into speech.
 */
export function cleanStreamProse(raw: string): string {
  const openFence = raw.lastIndexOf('```')
  const closedFences = (raw.match(/```/g) ?? []).length
  let safe = raw
  if (closedFences % 2 === 1 && openFence >= 0) safe = raw.slice(0, openFence)
  // The newline-collapsed tail often ends in a dangling pause; trim it.
  return cleanForSpeech(safe).replace(/[，,、]+$/, '')
}

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
    messages.push({ seq: node.seq, text })
  }
  return messages
}

/** Count pending interaction cards (approvals, questions) on the session. */
function pendingCountOf(snapshot: ConversationSnapshot): number {
  return snapshot.pending.length
}

/** Plain text of one finalized node's blocks (text blocks joined). */
function nodeText(blocks: readonly { kind: string; text?: string }[]): string {
  return blocks
    .filter(block => block.kind === 'text')
    .map(block => block.text ?? '')
    .join('')
}

/** Transcript slice of a snapshot: finalized user/assistant messages + partial. */
export function transcriptOf(snapshot: ConversationSnapshot): TranscriptState {
  const messages: TranscriptMessage[] = []
  for (const node of snapshot.nodes) {
    if (node.kind === 'user') {
      messages.push({ seq: node.seq, role: 'user', text: nodeText(node.content as unknown as readonly { kind: string; text?: string }[]) })
    } else if (node.kind === 'assistant') {
      messages.push({ seq: node.seq, role: 'assistant', text: nodeText(node.blocks) })
    }
  }
  const partial = snapshot.partial
  const streaming = partial === null ? '' : partialTextOf(partial)
  return { messages, streaming, pending: snapshot.pending.length }
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
    pendingCount: 0, error: null,
  })

  /** The session's message stream for the call overlay's right-hand column. */
  readonly transcript = new SnapshotStore<TranscriptState>({
    messages: [], streaming: '', pending: 0,
  })

  readonly #deps: VoiceControllerDeps
  readonly #recognizer = new ChromeRecognizer()
  #recognitionHandle: ReturnType<ChromeRecognizer['start']> = null
  #silenceTimer: ReturnType<typeof setTimeout> | null = null
  #rearmTimer: ReturnType<typeof setTimeout> | null = null
  #replyTimer: ReturnType<typeof setTimeout> | null = null
  #echoMuteTimer: ReturnType<typeof setTimeout> | null = null
  #pendingFinal: string | null = null
  #lastSpokenSeq = 0
  #speaking = false
  #speakingSince = 0
  #spokenText: string | null = null
  #ttsCache: { id: string; provider: TtsProvider } | null = null
  #session: TtsSession | null = null
  #streamRaw = ''
  #streamFed = 0
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
      this.#syncTranscript()
    })
  }

  /** Rebuild the transcript store from the current snapshot (change-gated). */
  #syncTranscript(): void {
    const next = transcriptOf(this.#deps.readSnapshot())
    const prev = this.transcript.getSnapshot()
    if (prev.streaming === next.streaming && prev.pending === next.pending
      && prev.messages.length === next.messages.length
      && prev.messages.every((m, i) => m === next.messages[i])) return
    this.transcript.set(next)
  }

  /** Enter the hands-free loop (the mic button's on arm). */
  startLoop(): void {
    if (this.status.getSnapshot().mode === 'loop') return
    this.#lastSpokenSeq = this.#latestAssistantSeq()
    this.status.patch({ mode: 'loop', error: null, lastPrompt: '' })
    this.#armListening()
  }

  /** Leave any voice activity: stop everything and go idle (pure off switch). */
  stopVoice(): void {
    this.#disarmAll()
    this.status.patch({ mode: 'off', phase: 'idle', interim: '', caption: '' })
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
   * The readout chain and the HUD readouts both go through here.
   */
  effectiveSettings(): Required<VoiceSettings> {
    const resolved = resolveSettings(this.#deps.settings())
    const speaker = this.#sessionSpeaker ?? resolved.speakerByTheme[resolved.ttsTheme] ?? ''
    return {
      ...resolved,
      rate: this.#sessionRate ?? SESSION_BASE_RATE,
      speakerByTheme: speaker === '' ? resolved.speakerByTheme : { ...resolved.speakerByTheme, [resolved.ttsTheme]: speaker },
    }
  }

  /** Force-cancel the current readout (skip button inside the overlay). */
  stopSpeaking(): void {
    if (!this.#speaking) return
    this.#speaker().cancel()
  }

  dispose(): void {
    this.#disposed = true
    this.#unsubscribePending?.()
    this.#unsubscribePending = null
    this.#disarmAll()
  }

  // ---- recognition arm -----------------------------------------------------

  /** Start the engine with handlers routed by the current phase. */
  #startRecognition(): void {
    if (this.#disposed) return
    if (this.#recognitionHandle !== null) return
    if (!this.#recognizer.supported()) {
      this.#notifyError('此浏览器不支持语音识别（需要 Chrome/Edge）')
      this.#degradeToIdle()
      return
    }
    this.#recognitionHandle = this.#recognizer.start({
      onInterim: interim => this.status.patch({ interim }),
      onFinal: text => this.#onFinalUtterance(text),
      onEnd: () => { /* the recognizer restarts itself */ },
      onError: (message, fatal) => {
        if (fatal) {
          this.#notifyError(message)
          this.#degradeToIdle()
        }
      },
    })
    if (this.#recognitionHandle === null) this.#degradeToIdle()
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
    if (this.#speaking) {
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
    // Accumulate finalized text; the silence timer flushes it as one prompt.
    this.#pendingFinal = this.#pendingFinal === null ? text : `${this.#pendingFinal}，${text}`
    this.#resetSilenceTimer()
  }

  /** Drop capture for a moment after an echo hit, then re-arm cleanly. */
  #muteAfterEcho(): void {
    this.#recognitionHandle?.stop()
    this.#recognitionHandle = null
    this.#pendingFinal = null
    this.status.patch({ interim: '' })
    if (this.#echoMuteTimer !== null) clearTimeout(this.#echoMuteTimer)
    if (this.#disposed || !this.#speaking) return
    this.#echoMuteTimer = setTimeout(() => {
      this.#echoMuteTimer = null
      if (!this.#speaking) return
      this.#startRecognition()
    }, 2_000)
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
    const text = this.#pendingFinal
    this.#pendingFinal = null
    if (text === null || text.length < MIN_UTTERANCE_CHARS) return
    this.#submitUtterance(text)
  }

  // ---- submission + readout chain ------------------------------------------

  #submitUtterance(text: string): void {
    // The mic pauses while the agent works; it re-arms after the readout.
    this.#recognitionHandle?.stop()
    this.#recognitionHandle = null
    if (this.#silenceTimer !== null) {
      clearTimeout(this.#silenceTimer)
      this.#silenceTimer = null
    }
    this.status.patch({ interim: '', caption: '', lastPrompt: text, phase: 'thinking' })
    this.#deps.input.setDraft(text)
    this.#deps.input.submit()
    this.#prepareStream()
    this.#watchForReply()
  }

  /**
   * Subscribe to the reply stream: partial text feeds the speaker sentence by
   * sentence (instant readout), and the finalized message flushes the tail.
   * A stuck turn must not trap the loop (timeout keeps the fallback).
   */
  #watchForReply(): void {
    this.#unsubscribeSnapshot?.()
    this.#unsubscribeSnapshot = this.#deps.subscribeSnapshot(() => this.#onSnapshotStream())
    this.#replyTimer = setTimeout(() => {
      if (this.#disposed || this.status.getSnapshot().phase !== 'thinking') return
      this.#teardownReplyWatch()
      this.#notifyError('回复等待超时')
      this.#finishRound()
    }, REPLY_TIMEOUT_MS)
    queueMicrotask(() => this.#onSnapshotStream())
  }

  /** Stream tick: feed new cleaned prose to the speaker, flush sentence-wise. */
  #onSnapshotStream(): void {
    if (this.#disposed) return
    const snapshot = this.#deps.readSnapshot()
    // Tail flush: the turn ended while we were streaming.
    if (this.status.getSnapshot().phase === 'thinking') {
      const partial = snapshot.partial
      const prose = partial === null ? '' : partialTextOf(partial)
      if (partial !== null && prose.length > this.#streamRaw.length) {
        this.#streamRaw = prose
        this.#flushStreamSentences(false)
      }
    }
    const messages = assistantMessagesOf(snapshot)
    const latest = messages[messages.length - 1]
    if (latest === undefined || latest.seq <= this.#lastSpokenSeq) return
    // Finalized: flush the remaining tail and close the session.
    this.#lastSpokenSeq = latest.seq
    this.#teardownReplyWatch()
    void this.#finishStream(latest.text)
  }

  /**
   * Push every complete sentence beyond the fed offset to the session.
   * `final` flushes the partial tail as well (end of generation).
   */
  #flushStreamSentences(final: boolean): void {
    const settings = resolveSettings(this.#deps.settings())
    const cleaned = cleanStreamProse(this.#streamRaw)
    if (cleaned.length <= this.#streamFed) return
    const pending = cleaned.slice(this.#streamFed)
    const cut = lastSentenceBoundary(pending)
    if (cut === null || (cut < FLUSH_MIN_CHARS && !final)) return
    const take = final ? pending.length : cut
    const piece = pending.slice(0, take)
    this.#streamFed += take
    this.#session?.push(piece)
  }

  /** End-of-turn: flush the tail, close the session, hand back to listening. */
  async #finishStream(finalText: string): Promise<void> {
    const settings = resolveSettings(this.#deps.settings())
    const session = this.#session
    if (session === null) {
      this.#finishRound()
      return
    }
    // The finalized text is authoritative (snapshot fold may lag the partial).
    this.#streamRaw = finalText
    this.#flushStreamSentences(true)
    this.status.patch({ phase: 'speaking' })
    this.#speaking = true
    this.#speakingSince = Date.now()
    session.done()
    if (settings.allowInterrupt) this.#startRecognition()
    try {
      await session.finished
      this.#endSpeaking()
      this.#finishRound()
    } catch (error) {
      this.#endSpeaking()
      this.#notifyError(error instanceof Error ? error.message : String(error))
      this.#finishRound()
    }
  }

  #teardownReplyWatch(): void {
    this.#unsubscribeSnapshot?.()
    this.#unsubscribeSnapshot = null
    if (this.#replyTimer !== null) {
      clearTimeout(this.#replyTimer)
      this.#replyTimer = null
    }
  }

  /** Open a streaming session for the upcoming reply (theme-capable only). */
  #prepareStream(): void {
    const settings = this.effectiveSettings()
    this.#streamRaw = ''
    this.#streamFed = 0
    this.#session = null
    const provider = this.#speaker()
    if (!provider.supported()) return
    const speaker = settings.speakerByTheme[settings.ttsTheme] ?? settings.voiceName
    this.#session = (provider.startSession ?? ((o, i) => sessionFromSpeak(provider, o, i)))(
      { rate: settings.rate, lang: settings.voiceLang, voiceName: speaker, params: themeParams(settings) },
      () => { /* interrupted: the recognizer's next final drives the loop */ },
    )
  }

  /**
   * Fallback readout: the streaming session produced nothing (theme without
   * support, no prose streamed) but the reply has text — speak it whole.
   */
  async #speakReply(replyText: string): Promise<void> {
    const settings = this.effectiveSettings()
    const status = this.status.getSnapshot()
    const readout = extractReadout(replyText, settings.maxReadoutChars)
    const provider = this.#speaker()
    if (readout === '' || !provider.supported() || this.#session !== null) {
      return
    }
    this.status.patch({ phase: 'speaking', caption: readout })
    this.#speaking = true
    this.#speakingSince = Date.now()
    this.#spokenText = readout
    if (settings.allowInterrupt) this.#startRecognition()
    try {
      await provider.speak(
        readout,
        { rate: settings.rate, lang: settings.voiceLang, voiceName: settings.speakerByTheme[settings.ttsTheme] ?? settings.voiceName, params: themeParams(settings) },
        () => { /* interrupted: the recognizer's next final drives the loop */ },
      )
      this.#endSpeaking()
      this.#finishRound()
    } catch (error) {
      this.#endSpeaking()
      if (error instanceof Error && error.message === 'interrupted') {
        if (this.status.getSnapshot().phase === 'speaking') this.#finishRound()
        return
      }
      this.#notifyError(error instanceof Error ? error.message : String(error))
      this.#finishRound()
    }
  }


  #endSpeaking(): void {
    this.#speaking = false
    this.#spokenText = null
  }

  #finishRound(): void {
    if (this.#disposed) return
    const mode = this.status.getSnapshot().mode
    if (mode !== 'loop') {
      this.#recognitionHandle?.stop()
      this.#recognitionHandle = null
      this.status.patch({ mode: 'off', phase: 'idle', interim: '', caption: '' })
      return
    }
    // Cooldown: let the speaker tail decay, then listen again.
    this.#recognitionHandle?.stop()
    this.#recognitionHandle = null
    this.#pendingFinal = null
    if (this.#rearmTimer !== null) clearTimeout(this.#rearmTimer)
    this.#rearmTimer = setTimeout(() => {
      this.#rearmTimer = null
      this.#armListening()
    }, REARM_COOLDOWN_MS)
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
    this.#pendingFinal = null
  }
}
