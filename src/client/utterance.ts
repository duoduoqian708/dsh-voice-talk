// The listening-utterance state machine: everything between "the recognizer
// saw text / heard a voice" and "the prompt is submitted".
//
// Policy — one timer, two reset sources:
//   start    on the first recognized text (nothing to send before that)
//   reset    on every new recognized text, and on every live-voice frame
//            (local level above the adaptive floor, or the vendor VAD onset)
//   submit   when the timer runs out: the finalized segments joined with the
//            still-live partial — the exact text on screen, never less
//   ceiling  the cap forces the submission even while the user keeps talking
//   pause    suspend() freezes the countdown (transport lost, echo pause) and
//            keeps all text; resume() restarts a full countdown from now
//
// Every signal only ever EXTENDS the countdown — noise can delay a submit but
// can never cause one (the timer only exists once recognized text opened the
// window). Browser-free by construction: time and timers are injected, so the
// whole policy is exercised on a fake clock by scripts/check-utterance.mjs.

import { VoiceEndpointer } from './endpointer.ts'

type TimerHandle = ReturnType<typeof setTimeout>

/** Live policy parameters (read fresh on every arm: settings can change). */
export interface UtteranceConfig {
  /** Submit this long after the last signal (the 停顿多久自动发送 setting). */
  readonly silenceMs: number
  /** Fixed safety margin added on top of silenceMs. */
  readonly marginMs: number
  /** Ceiling: force-submit this long after the first recognized text. */
  readonly capMs: number
}

/** Injection face: time, timers, outputs. */
export interface UtteranceHost {
  now(): number
  setTimer(callback: () => void, ms: number): TimerHandle
  clearTimer(handle: TimerHandle): void
  /** Submit-ready text; the machine has already reset its own state. */
  onSubmit(text: string): void
  /** What the live area should show ('' clears it). */
  onDisplay(text: string): void
  /** The cap window opened (epoch ms) or closed (null). */
  onWindow(startAt: number | null): void
}

/** Non-punctuation recognized content worth opening the window on. */
function hasRecognizedText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

/** Filler syllables the vendor hallucinates on non-speech audio (breath,
 *  room tone, a playback tail): a segment that is ONLY these plus punctuation
 *  is noise, never text. Bare "嗯" answers run through the controller's
 *  pending-question flow, which bypasses this machine. */
const FILLER_CHARS = new Set(['嗯', '呃', '啊', '哦', '噢', '唔', '唉', '诶', '欸'])
function isFillerOnly(text: string): boolean {
  let seen = false
  for (const ch of text) {
    if (FILLER_CHARS.has(ch)) { seen = true; continue }
    if (/[\s\p{P}\p{S}]/u.test(ch)) continue
    return false
  }
  return seen
}

export class UtteranceMachine {
  readonly #host: UtteranceHost
  readonly #config: () => UtteranceConfig
  readonly #endpointer = new VoiceEndpointer()
  /** Finalized segments of the round, joined with '，' (null = none yet). */
  #settled: string | null = null
  /** Live vendor partial of the item being transcribed. */
  #live = ''
  #flushTimer: TimerHandle | null = null
  #capTimer: TimerHandle | null = null
  #windowAt: number | null = null
  #suspended = false
  #lastSignalAt = 0
  #disposed = false

  constructor(host: UtteranceHost, config: () => UtteranceConfig) {
    this.#host = host
    this.#config = config
  }

  /** The text the call would submit right now (display and submit agree). */
  get display(): string {
    if (this.#settled === null) return this.#live
    return this.#live === '' ? this.#settled : `${this.#settled}，${this.#live}`
  }

  /** Vendor partial (interim transcription of the live item). */
  partial(text: string): void {
    if (this.#disposed || this.#suspended) return
    if (text === '' || text === this.#live) return
    // Noise-triggered filler stays out of the live area and the window.
    if (isFillerOnly(text)) return
    this.#live = text
    if (!hasRecognizedText(text)) return
    this.#openWindow()
    this.#signal('partial')
    this.#host.onDisplay(this.display)
  }

  /** Vendor final of one item. */
  final(text: string): void {
    if (this.#disposed || this.#suspended || text === '') return
    // The item's live partial is now superseded by its finalized text.
    this.#live = ''
    if (isFillerOnly(text)) {
      // Trailing hallucination (the vendor's "，嗯。" after real speech):
      // drop it instead of joining it into the prompt.
      this.#host.onDisplay(this.display)
      return
    }
    this.#settled = this.#settled === null ? text : `${this.#settled}，${text}`
    this.#openWindow()
    this.#signal('final')
    this.#host.onDisplay(this.display)
  }

  /** Vendor VAD speech onset (no text yet): live speech, not a pause. */
  speechOnset(): void {
    if (this.#disposed || this.#suspended || this.#windowAt === null) return
    this.#signal('vad')
  }

  /** One local mic level frame (~40ms). */
  level(rms: number): void {
    if (this.#disposed || this.#suspended) return
    const active = this.#endpointer.push(rms)
    if (active && this.#windowAt !== null) this.#signal('voice')
  }

  /** Freeze the countdown (transport down, echo pause); all text is kept. */
  suspend(): void {
    if (this.#disposed || this.#suspended) return
    this.#suspended = true
    this.#cancelFlush()
  }

  /** Resume after a suspension: a fresh full countdown from now. */
  resume(): void {
    if (this.#disposed || !this.#suspended) return
    this.#suspended = false
    if (this.#windowAt !== null && this.display !== '') this.#signal('resume')
  }

  /** Drop everything (mute, hang-up, a fresh listening round). */
  reset(): void {
    this.#cancelFlush()
    if (this.#capTimer !== null) {
      this.#host.clearTimer(this.#capTimer)
      this.#capTimer = null
    }
    if (this.#windowAt !== null) {
      this.#windowAt = null
      this.#host.onWindow(null)
    }
    this.#settled = null
    this.#live = ''
    this.#suspended = false
    this.#lastSignalAt = 0
    this.#endpointer.reset()
    this.#host.onDisplay('')
  }

  /** Permanent teardown (the controller is being disposed). */
  dispose(): void {
    this.reset()
    this.#disposed = true
  }

  // ---- internals -----------------------------------------------------------

  /** Open the cap window on the first recognized text of the round. */
  #openWindow(): void {
    if (this.#windowAt !== null || this.#suspended) return
    const at = this.#host.now()
    this.#windowAt = at
    this.#lastSignalAt = at
    this.#host.onWindow(at)
    this.#capTimer = this.#host.setTimer(() => this.#flush('cap'), this.#config().capMs)
  }

  /** A text/voice signal: restart the submission countdown. */
  #signal(_source: 'partial' | 'final' | 'vad' | 'voice' | 'resume'): void {
    if (this.#suspended || this.#windowAt === null) return
    this.#lastSignalAt = this.#host.now()
    this.#cancelFlush()
    const { silenceMs, marginMs } = this.#config()
    this.#flushTimer = this.#host.setTimer(() => this.#flush('silence'), silenceMs + marginMs)
  }

  #cancelFlush(): void {
    if (this.#flushTimer !== null) {
      this.#host.clearTimer(this.#flushTimer)
      this.#flushTimer = null
    }
  }

  /** Countdown over (silence) or ceiling reached (cap): submit and go quiet. */
  #flush(_reason: 'silence' | 'cap'): void {
    this.#cancelFlush()
    if (this.#capTimer !== null) {
      this.#host.clearTimer(this.#capTimer)
      this.#capTimer = null
    }
    const text = this.display
    if (this.#windowAt !== null) {
      this.#windowAt = null
      this.#host.onWindow(null)
    }
    this.#settled = null
    this.#live = ''
    this.#lastSignalAt = 0
    this.#endpointer.reset()
    this.#host.onDisplay('')
    if (text === '') return
    this.#host.onSubmit(text)
  }
}
