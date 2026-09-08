// Speech recognition + synthesis engines. Both wrap the browser's Web Speech
// API behind narrow interfaces so the controller stays engine-agnostic and the
// Chrome-specific quirks (auto-disconnect, restart backoff) live in one file.

/** One recognized utterance fragment. */
export interface RecognitionEvents {
  /** Best partial transcript so far for the current utterance. */
  onInterim(text: string): void
  /** A finalized utterance (pause or hard stop ended it). */
  onFinal(text: string): void
  /** The engine stopped on its own (silence, timeout, error). */
  onEnd(): void
  /** A recognition failure; `fatal` means retrying cannot help (denied, unsupported). */
  onError(message: string, fatal: boolean): void
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
   * stay armed.
   */
  start(events: RecognitionEvents): RecognitionHandle | null
  /** True when the browser exposes the SpeechRecognition constructor. */
  supported(): boolean
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
   * Themes without a native streaming engine inherit the buffered default
   * ({@link sessionFromSpeak}), which is exactly the old speak-on-done path.
   */
  startSession?(opts: SpeakOptions, onInterrupted: () => void): TtsSession
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
export function sessionFromSpeak(provider: TtsProvider, opts: SpeakOptions, onInterrupted: () => void): TtsSession {
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
    chain = provider.speak(text, opts, onInterrupted).then(() => {
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

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    length: number
    [index: number]: { transcript: string }
  }>
}

/** Window augmentation for the vendor-prefixed Web Speech constructor. */
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

/** Restart backoff after an unexpected engine disconnect. */
const RESTART_BASE_MS = 250
const RESTART_MAX_MS = 4000

/**
 * Chrome SpeechRecognition wrapper. The engine auto-disconnects after every
 * finalized utterance or ~60s of silence; {@link start} arms auto-restart so
 * the caller experiences one continuous session.
 */
export class ChromeRecognizer implements Recognizer {
  #restarting = false
  #restartAttempt = 0
  #disposed = false
  #restartTimer: ReturnType<typeof setTimeout> | null = null

  supported(): boolean {
    return typeof window !== 'undefined'
      && (window.SpeechRecognition !== undefined || window.webkitSpeechRecognition !== undefined)
  }

  start(events: RecognitionEvents): RecognitionHandle | null {
    this.#disposed = false
    this.#restartAttempt = 0
    const Ctor = typeof window !== 'undefined'
      ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
      : undefined
    if (Ctor === undefined) {
      events.onError('此浏览器不支持语音识别（需要 Chrome/Edge）', true)
      return null
    }
    const recognition = new Ctor()
    recognition.lang = navigator.language?.startsWith('zh') ? 'zh-CN' : (navigator.language || 'zh-CN')
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          const text = transcript.trim()
          if (text !== '') events.onFinal(text)
        } else {
          interim += transcript
        }
      }
      events.onInterim(interim.trim())
    }
    recognition.onerror = (event) => {
      // 'no-speech' and 'aborted' are normal pause artifacts; the rest may be
      // transient (network) or fatal (not-allowed).
      const error = event.error
      if (error === 'no-speech' || error === 'aborted') return
      const fatal = error === 'not-allowed' || error === 'service-not-allowed'
      events.onError(`语音识别错误：${error}`, fatal)
    }
    recognition.onend = () => {
      if (this.#restarting || this.#disposed) return
      // Chrome ended us (silence/timeout): arm a restart with backoff so the
      // session stays armed without a busy-fail loop when the mic is gone.
      events.onEnd()
      const delay = Math.min(RESTART_BASE_MS * 2 ** this.#restartAttempt, RESTART_MAX_MS)
      this.#restartAttempt += 1
      this.#restarting = true
      this.#restartTimer = setTimeout(() => {
        this.#restarting = false
        this.#restartTimer = null
        if (!this.#disposed) this.start(events)
      }, delay)
    }

    try {
      recognition.start()
    } catch (error) {
      // InvalidStateError: already running — harmless.
      events.onError(String(error), false)
      return null
    }
    const handle: RecognitionHandle = {
      stop: () => {
        this.#disposed = true
        if (this.#restartTimer !== null) {
          clearTimeout(this.#restartTimer)
          this.#restartTimer = null
        }
        this.#restarting = false
        try {
          // abort(), not stop(): stop() flushes Chrome's recognition buffer as
          // a final result — after a hang-up that tail would land in the
          // composer and send. abort() discards the buffer silently.
          recognition.abort()
        } catch {
          // already stopped
        }
      },
    }
    return handle
  }
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
  #interrupted: (() => void) | null = null
  /** Stops the utterance on the air for the current speak() session. */
  #sessionCancel: (() => void) | null = null

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
   * generating. `done()` marks the end of the feed.
   */
  startSession(opts: SpeakOptions, onInterrupted: () => void): TtsSession {
    const synth = window.speechSynthesis
    const queue: string[] = []
    let ended = false
    let settled = false
    let speaking = false
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
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = opts.rate
      utterance.lang = opts.lang
      if (opts.voiceName !== '') {
        const voice = synth.getVoices().find(v => v.name === opts.voiceName)
        if (voice !== undefined) utterance.voice = voice
      }
      utterance.onend = () => {
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
          settleFail(`语音合成错误：${event.error}`)
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
        utterance.onend = () => {
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
            settle(() => reject(new Error(`语音合成错误：${event.error}`)))
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
