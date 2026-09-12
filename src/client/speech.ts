// Speech recognition + synthesis engines. Both wrap the browser's Web Speech
// API behind narrow interfaces so the controller stays engine-agnostic and the
// Chrome-specific quirks (auto-disconnect, restart backoff) live in one file.

import type { VoiceTranslate } from './locales.ts'

/** One recognized utterance fragment. */
export interface RecognitionEvents {
  /** Best partial transcript so far for the current utterance. */
  onInterim(text: string): void
  /** A finalized utterance (pause or hard stop ended it). */
  onFinal(text: string): void
  /** The engine stopped on its own (silence, timeout, error). */
  onEnd(): void
  /** The vendor's VAD heard speech onset: live audio is flowing even when no
   *  interim text has landed yet — a gap here is not the user pausing. */
  onSpeech?(): void
  /** Raw mic level (RMS of one ~40ms captured chunk): the LOCAL half of the
   *  voice-activity signal the submission timer resets on. Optional — engines
   *  without level reporting simply don't feed the endpointer. */
  onLevel?(rms: number): void
  /** Transport state: false while the recognizer is reconnecting (no events
   *  can flow), true once a fresh session is ready. */
  onLink?(up: boolean): void
  /** A recognition failure; `fatal` means retrying cannot help (denied, unsupported).
   *  `code` carries a stable host-bridge code when the failure came from one. */
  onError(message: string, fatal: boolean, code?: string): void
}

/** Continuous speech recognition handle. Chrome/Edge only in practice. */
export interface RecognitionHandle {
  stop(): void
}

/** Recognizer surface the controller drives. */
export interface Recognizer {
  /**
   * Start listening. The engine keeps firing final/interim events until
   * {@link Recognizer.stop} or an onEnd; the caller restarts after onEnd to
   * stay armed. Opts (per arm, not per recognizer): the cloud vendor picks
   * up lang/model/endpoint from the settings at arm time.
   */
  start(events: RecognitionEvents, opts?: RecognizerStartOptions): RecognitionHandle | null
  /** True when the browser exposes mic capture and WebSocket transport. */
  supported(): boolean
}

/** Per-arm recognition options (settings-derived, read fresh each arm). */
export interface RecognizerStartOptions {
  /** BCP-47 language tag the recognition should use (settings.voiceLang). */
  lang?: string
  /** Cloud model id (settings.asrQwenModel). */
  model?: string
  /** Vendor WS endpoint override (settings.asr*Endpoint). */
  endpoint?: string
}

/** Synthesis options a voice theme may consume (theme-private extras allowed). */
export interface SpeakOptions {
  rate: number
  lang: string
  /** Platform voice name; empty = theme default. */
  voiceName: string
  /** Theme-private parameters (cloud voices: model/tone/style etc.). */
  params: Record<string, unknown>
}

/**
 * One speakable voice engine. Implementations resolve or reject exactly once:
 * resolve on natural end, reject with `Error('interrupted')` when cancelled
 * (by the caller or a barge-in), other rejections carry a surfaced message.
 */
export interface TtsProvider {
  speak(text: string, opts: SpeakOptions, onInterrupted: () => void): Promise<void>
  cancel(): void
  supported(): boolean
  /**
   * Streaming session: text pieces are pushed as the reply generates and play
   * back-to-back. Contract of `finished`:
   * - resolves after `done()` + the last queued piece finishes playing, and
   *   also when `cancel()` stops a session (skip = deliberate stop);
   * - rejects with a surfaced message on synthesis failure.
   * `onProgress` receives the CUMULATIVE character count of pieces that have
   * started playing (the karaoke marker; engines without piece boundaries
   * report at push time — a close-enough lead).
   * Themes without a native streaming engine inherit the buffered default
   * ({@link sessionFromSpeak}), which is exactly the old speak-on-done path.
   */
  startSession?(opts: SpeakOptions, onInterrupted: () => void, onProgress?: (playedChars: number) => void): TtsSession
}

/** One streaming synthesis feed (see {@link TtsProvider.startSession}). */
export interface TtsSession {
  /** Queue one more piece of (already cleaned) speech text. */
  push(text: string): void
  /** No more text is coming; settle after the tail finishes playing. */
  done(): void
  /** Stop everything now (skip or barge-in); `finished` resolves. */
  cancel(): void
  /** Settles when the session stops for any reason. */
  finished: Promise<void>
}

/**
 * Buffered default session over a one-shot `speak()`: pieces accumulate and
 * play in order once `done()` arrives — the pre-streaming behavior, used by
 * themes without a native `startSession`.
 */
export function sessionFromSpeak(provider: TtsProvider, opts: SpeakOptions, onInterrupted: () => void, onProgress?: (playedChars: number) => void): TtsSession {
  let buffer = ''
  let ended = false
  let settled = false
  let resolveDone: (() => void) | null = null
  let failDone: ((error: Error) => void) | null = null
  const finished = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    failDone = reject
  })
  let chain: Promise<void> | null = null
  let played = 0
  const pump = (): void => {
    if (settled || chain !== null) return
    if (buffer === '') {
      if (ended) {
        settled = true
        resolveDone?.()
      }
      return
    }
    const text = buffer
    buffer = ''
    const base = played
    played += text.length
    // A buffered engine has no intra-piece clock: claim nothing before the
    // piece starts, and lock it complete when it ends (never ahead).
    onProgress?.(base)
    chain = provider.speak(text, opts, onInterrupted).then(() => {
      onProgress?.(played)
      chain = null
      pump()
    }, (error: unknown) => {
      if (settled) return
      settled = true
      failDone?.(error instanceof Error ? error : new Error(String(error)))
    })
  }
  return {
    push: text => {
      if (settled || ended) return
      buffer += text
      pump()
    },
    done: () => {
      ended = true
      pump()
    },
    cancel: () => {
      ended = true
      if (!settled) {
        settled = true
        provider.cancel()
        resolveDone?.()
      }
    },
    finished,
  }
}

/* ---- platform-voice activity (shared wave feed + echo policy) ---------------
 * speechSynthesis renders out of process: no Web Audio tap can measure its
 * output and no echo canceller removes it from the mic. The utterance
 * lifecycle is all we can observe, so both consumers ride it: the call-face
 * wave synthesizes a speech-shaped envelope from it, and the controller runs
 * the STRICT echo guard while it lasts (captured readout is not impossible to
 * re-recognize here, only to cancel). */

/** Grace bridging the (near-instant) gaps between queued utterances. */
const SYSTEM_ACTIVITY_GRACE_MS = 400
let systemActivityAt = 0

function markSystemActivity(): void {
  systemActivityAt = Date.now()
}

/** Whether the platform voice is sounding (or paused < grace ago). */
export function isSystemTtsSounding(): boolean {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const synth = window.speechSynthesis
    if (synth.speaking || synth.pending) return true
  }
  // Cancelled utterances never fire onend, so the grace stamp only extends
  // from real playback events — a skip drops the level immediately.
  return Date.now() - systemActivityAt < SYSTEM_ACTIVITY_GRACE_MS
}

/** Playback level 0..1 for the system voice; 0 while silent. The platform
 *  exposes no amplitude, so this is a synthetic speech envelope (a slow
 *  breath carrier under a syllable ripple) — the same "close enough" spirit
 *  as the bars' procedural amp. */
export function readSystemTtsLevel(): number {
  if (!isSystemTtsSounding()) return 0
  const t = Date.now() / 1000
  const syllable = Math.pow(Math.abs(Math.sin(t * 9.2)), 0.7)
  const breath = 0.62 + 0.38 * Math.sin(t * 1.8)
  return Math.min(1, 0.22 + 0.55 * syllable * breath)
}

/**
 * The platform speechSynthesis engine (the built-in `system` voice theme).
 * Long readouts are queued as ~120-char sentence-bounded chunks so "skip"
 * cancels instantly and the cadence sounds like speech, not one long dump.
 * The promise rejects when cancelled (barge-in), resolves after the last
 * chunk ends.
 */
export class SystemTtsProvider implements TtsProvider {
  readonly id = 'system'
  /** Chunk size in characters (sentence-bounded; CJK reads ~4 chars/sec). */
  static readonly CHUNK_CHARS = 120
  readonly #t: VoiceTranslate
  #interrupted: (() => void) | null = null
  /** Stops the utterance on the air for the current speak() session. */
  #sessionCancel: (() => void) | null = null

  constructor(t: VoiceTranslate) {
    this.#t = t
  }

  supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  /** Sentence-bounded chunking: never split mid-sentence when avoidable. */
  #chunks(text: string): string[] {
    if (text.length <= SystemTtsProvider.CHUNK_CHARS) return [text]
    const sentences = text
      .replace(/([。！？；.!?])/g, '$1\n')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s !== '')
    const chunks: string[] = []
    let current = ''
    for (const sentence of sentences) {
      // A single sentence over the cap still becomes its own chunk.
      if (current !== '' && current.length + sentence.length > SystemTtsProvider.CHUNK_CHARS) {
        chunks.push(current)
        current = ''
      }
      current = current === '' ? sentence : current + sentence
    }
    if (current !== '') chunks.push(current)
    return chunks.length > 0 ? chunks : [text]
  }

  /**
   * Native streaming session: pushed pieces become utterances immediately
   * (in queue order), so the first sentence speaks while later text is still
   * generating. `done()` marks the end of the feed; each piece reports the
   * cumulative played count as it starts (the karaoke marker).
   */
  startSession(opts: SpeakOptions, onInterrupted: () => void, onProgress?: (playedChars: number) => void): TtsSession {
    const synth = window.speechSynthesis
    const queue: string[] = []
    let ended = false
    let settled = false
    let speaking = false
    let played = 0
    let resolveDone: (() => void) | null = null
    let failDone: ((error: Error) => void) | null = null
    const finished = new Promise<void>((resolve, reject) => {
      resolveDone = resolve
      failDone = reject
    })
    const settleFail = (message: string): void => {
      if (settled) return
      settled = true
      synth.cancel()
      failDone?.(new Error(message))
    }
    const speakNext = (): void => {
      if (settled || speaking) return
      const text = queue.shift()
      if (text === undefined) {
        if (ended) {
          settled = true
          resolveDone?.()
        }
        return
      }
      const base = played
      played += text.length
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = opts.rate
      utterance.lang = opts.lang
      if (opts.voiceName !== '') {
        const voice = synth.getVoices().find(v => v.name === opts.voiceName)
        if (voice !== undefined) utterance.voice = voice
      }
      // Progress from the engine's own clock (the queue depth is not the
      // playback position): onstart claims the piece it becomes current on,
      // onboundary tracks within it, onend locks the piece complete.
      utterance.onstart = () => {
        markSystemActivity()
        onProgress?.(base)
      }
      utterance.onboundary = (event) => {
        markSystemActivity()
        onProgress?.(base + (event.charIndex ?? 0))
      }
      utterance.onend = () => {
        markSystemActivity()
        onProgress?.(played)
        speaking = false
        if (settled) return
        speakNext()
      }
      utterance.onerror = (event) => {
        speaking = false
        if (settled) return
        if (event.error === 'interrupted' || event.error === 'canceled') {
          synth.cancel()
          resolveDone?.()
        } else {
          settleFail(this.#t('err.synth', { detail: event.error }))
        }
      }
      speaking = true
      synth.speak(utterance)
    }
    return {
      push: (text) => {
        if (settled || ended) return
        queue.push(text)
        speakNext()
      },
      done: () => {
        ended = true
        speakNext()
      },
      cancel: () => {
        ended = true
        if (!settled) {
          settled = true
          synth.cancel()
          resolveDone?.()
        }
      },
      finished,
    }
  }

  speak(text: string, opts: SpeakOptions, onInterrupted: () => void): Promise<void> {
    const chunks = this.#chunks(text)
    return new Promise((resolve, reject) => {
      const synth = window.speechSynthesis
      let settled = false
      let index = 0
      const settle = (result: () => void): void => {
        if (settled) return
        settled = true
        this.#interrupted = null
        this.#sessionCancel = null
        result()
      }
      const speakNext = (): void => {
        if (index >= chunks.length) {
          settle(resolve)
          return
        }
        const utterance = new SpeechSynthesisUtterance(chunks[index]!)
        index += 1
        utterance.rate = opts.rate
        utterance.lang = opts.lang
        if (opts.voiceName !== '') {
          const voice = synth.getVoices().find(v => v.name === opts.voiceName)
          if (voice !== undefined) utterance.voice = voice
        }
        utterance.onstart = () => {
          markSystemActivity()
        }
        utterance.onend = () => {
          markSystemActivity()
          if (settled) return
          speakNext()
        }
        utterance.onerror = (event) => {
          if (settled) return
          // 'interrupted' / 'canceled' arrive from our own cancel(); the
          // controller treats that as the interrupted branch, not a failure.
          if (event.error === 'interrupted' || event.error === 'canceled') {
            onInterrupted()
            settle(() => reject(new Error('interrupted')))
          } else {
            settle(() => reject(new Error(this.#t('err.synth', { detail: event.error }))))
          }
        }
        synth.speak(utterance)
      }
      this.#interrupted = () => {
        synth.cancel()
        onInterrupted()
        settle(() => reject(new Error('interrupted')))
      }
      this.#sessionCancel = () => { synth.cancel() }
      speakNext()
    })
  }

  cancel(): void {
    const fire = this.#interrupted
    this.#interrupted = null
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    fire?.()
  }
}
