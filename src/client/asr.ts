// The cloud recognizer: mic PCM streams through the host bridge (which owns
// the credentials) into a streaming ASR vendor. It implements the same
// Recognizer surface the loop has always driven, so the controller keeps its
// arm/disarm/echo logic untouched — only the engine underneath changed
// (the browser's Web Speech recognition is retired).
//
// Audio path: getUserMedia → AudioWorklet (inline via Blob URL) downsamples
// to 16k/16-bit/mono and posts PCM chunks straight through. No main-thread
// energy gate here: the 60s utterance cap is opened by the controller on the
// first recognized text, so raw mic level never drives product behavior.
// Protocol: binary PCM frames up, JSON events down over /voice-asr/<vendor>
// (the host bridge normalizes every vendor to that shape).
//
// Reconnect policy mirrors the old ChromeRecognizer's contract: unexpected
// drops re-arm with backoff while the handle is alive; a vendor-protocol
// error is fatal (auth/quota — retrying cannot help). stop() tears down
// everything for real — socket closed, mic tracks stopped, no restart
// timers (the post-hang-up capture bug was born from breaking that rule).

import type { RecognitionEvents, RecognitionHandle, Recognizer, RecognizerStartOptions } from './speech.ts'
import type { VoiceTranslate } from './locales.ts'

export type AsrVendor = 'qwen' | 'xfyun'

/** 40ms of 16k 16-bit mono PCM — the vendor's canonical chunk (640 samples). */
const CHUNK_SAMPLES = 640
const RECONNECT_BASE_MS = 250
const RECONNECT_MAX_MS = 4_000
/** First link-up watchdog: `ready` must arrive within this window. */
const READY_TIMEOUT_MS = 10_000
/** Consecutive unexpected closes before the failure turns fatal (silence → error). */
const MAX_RECONNECT_FAILURES = 3
/** Audio-startup waits are bounded: a pending browser API must not hang the
 *  whole recognizer into silent no-capture (the classic dead-mic report). */
const MIC_TIMEOUT_MS = 8_000
const RESUME_TIMEOUT_MS = 3_000
const WORKLET_TIMEOUT_MS = 5_000

/** Local silence gate: drops sub-threshold audio instead of uploading room
 *  tone. This saves upstream bandwidth, NOT money — the vendor bills only
 *  effective speech seconds. OFF: the threshold can clip soft word onsets,
 *  and noise-triggered filler is handled by the VAD threshold plus the
 *  utterance-level filler filter. Set true to restore always-stream. */
const USE_SILENCE_GATE = false
const GATE_ON_RMS = 0.015
const GATE_OFF_RMS = 0.008
const GATE_HANGOVER_MS = 1_800
/** 40 ms chunks kept while the gate is closed (~480 ms of preroll). */
const GATE_PREROLL_CHUNKS = 12

/** The bridge tears a session down after 120 s without frames: a JSON
 *  keepalive keeps a long silent listening phase from idling out. */
const KEEPALIVE_MS = 45_000

/** Bound an await; rejection carries the label so the notice stays actionable. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/** The worklet: streaming linear resample to 16k + int16 chunking. */
const WORKLET_SRC = `
class AsrTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.pos = 0
    this.last = 0
    this.chunk = []
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch === undefined || ch.length === 0) return true
    const ratio = this.ratio
    let pos = this.pos
    let last = this.last
    while (pos < ch.length) {
      const idx = pos | 0
      const f = pos - idx
      const a = idx === 0 ? last : ch[idx - 1]
      const s = a + (ch[idx] - a) * f
      this.chunk.push(s)
      pos += ratio
      if (this.chunk.length >= 640) {
        const pcm = new Int16Array(640)
        let sq = 0
        for (let k = 0; k < 640; k++) {
          const v = Math.max(-1, Math.min(1, this.chunk[k]))
          sq += v * v
          pcm[k] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767)
        }
        // The chunk's RMS rides along: the local voice-activity endpointer
        // consumes it, so submission timing never depends on vendor events.
        this.port.postMessage({ pcm: pcm.buffer, rms: Math.sqrt(sq / 640) }, [pcm.buffer])
        this.chunk = []
      }
    }
    this.pos = pos - ch.length
    this.last = ch[ch.length - 1]
    return true
  }
}
registerProcessor('asr-tap', AsrTap)
`

export class CloudRecognizer implements Recognizer {
  readonly #vendor: AsrVendor
  readonly #t: VoiceTranslate

  constructor(vendor: AsrVendor, t: VoiceTranslate) {
    this.#vendor = vendor
    this.#t = t
  }

  supported(): boolean {
    return typeof navigator !== 'undefined'
      && navigator.mediaDevices !== undefined
      && typeof WebSocket !== 'undefined'
  }

  start(events: RecognitionEvents, opts?: RecognizerStartOptions): RecognitionHandle | null {
    let disposed = false
    let restarting = false
    let restartAttempt = 0
    let restartTimer: ReturnType<typeof setTimeout> | null = null
    let socket: WebSocket | null = null
    let ready = false
    let readyTimer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let keepalive: ReturnType<typeof setInterval> | null = null
    let gateOpen = false
    let lastVoiceAt = 0
    let preRoll: ArrayBuffer[] = []
    const pending: ArrayBuffer[] = []
    let stream: MediaStream | null = null
    let audioCtx: AudioContext | null = null
    // The settings ride hello: the bridge resolves credentials and the model
    // per connection, so a changed 模型 ID lands on the next utterance.
    const hello = JSON.stringify({
      type: 'hello',
      lang: opts?.lang?.trim() || navigator.language,
      model: opts?.model,
      endpoint: opts?.endpoint,
    })

    const bridgeUrl = (): string => {
      const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws'
      return `${proto}://${location.host}/voice-asr/${this.#vendor}`
    }

    const closeSocket = (): void => {
      const s = socket
      socket = null
      ready = false
      if (keepalive !== null) { clearInterval(keepalive); keepalive = null }
      if (s !== null) { try { s.close() } catch { /* already down */ } }
    }

    const releaseMic = (): void => {
      stream?.getTracks().forEach(track => track.stop())
      stream = null
      void audioCtx?.close().catch(() => { /* already closed */ })
      audioCtx = null
    }

    const sendChunk = (buffer: ArrayBuffer): void => {
      if (socket === null || socket.readyState !== WebSocket.OPEN || !ready) {
        pending.push(buffer)
        return
      }
      try { socket.send(buffer) } catch { pending.push(buffer) }
    }

    /** Silence gate: drop sub-threshold audio instead of billing the stream. */
    const feedChunk = (buffer: ArrayBuffer, rms: number | undefined): void => {
      const level = rms ?? 1
      if (!USE_SILENCE_GATE) { sendChunk(buffer); return }
      const now = Date.now()
      if (level >= GATE_ON_RMS) {
        lastVoiceAt = now
        if (!gateOpen) {
          gateOpen = true
          for (const chunk of preRoll.splice(0)) sendChunk(chunk)
        }
      } else if (gateOpen && level >= GATE_OFF_RMS) {
        lastVoiceAt = now
      }
      if (gateOpen) {
        sendChunk(buffer)
        if (now - lastVoiceAt > GATE_HANGOVER_MS) {
          gateOpen = false
          preRoll = []
        }
        return
      }
      preRoll.push(buffer)
      if (preRoll.length > GATE_PREROLL_CHUNKS) preRoll.shift()
    }

    const handleUpstream = (data: string): void => {
      let event: { type?: string; text?: string; error?: string; code?: string }
      try {
        event = JSON.parse(data) as { type?: string; text?: string; error?: string; code?: string }
      } catch {
        return
      }
      if (event.type === 'ready') {
        ready = true
        failures = 0
        if (readyTimer !== null) { clearTimeout(readyTimer); readyTimer = null }
        // Every successful session resets the backoff — iFlytek's per-utterance
        // rotation must not let the reconnect delay creep toward its max.
        restartAttempt = 0
        events.onLink?.(true)
        for (const chunk of pending.splice(0)) sendChunk(chunk)
        return
      }
      if (event.type === 'activity') {
        events.onSpeech?.()
        return
      }
      if (event.type === 'interim' && typeof event.text === 'string') {
        events.onInterim(event.text)
        return
      }
      if (event.type === 'final' && typeof event.text === 'string') {
        if (event.text !== '') events.onFinal(event.text)
        return
      }
      if (event.type === 'error') {
        // Vendor/credential failures are fatal: stop for real, no reconnect.
        disposed = true
        releaseMic()
        closeSocket()
        events.onError(event.error ?? this.#t('err.asrFailed'), true, event.code)
      }
    }

    const openSocket = (): void => {
      const ws = new WebSocket(bridgeUrl())
      socket = ws
      ws.onopen = () => {
        ws.send(hello)
        if (keepalive !== null) clearInterval(keepalive)
        keepalive = setInterval(() => {
          try {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'keepalive' }))
          } catch { /* raced down */ }
        }, KEEPALIVE_MS)
      }
      ws.onmessage = event => {
        if (typeof event.data === 'string') handleUpstream(event.data)
      }
      ws.onclose = () => {
        socket = null
        ready = false
        if (keepalive !== null) { clearInterval(keepalive); keepalive = null }
        if (disposed || restarting) return
        // Unexpected drop (network blip): re-arm with backoff, mic stays.
        // Nothing can arrive while the link is down, so surface it: the loop
        // must not read the event gap as the user pausing.
        failures += 1
        events.onLink?.(false)
        if (failures >= MAX_RECONNECT_FAILURES) {
          // Retrying no longer helps and silent backoff would look like a dead
          // mic: surface the failure instead of looping forever.
          disposed = true
          if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null }
          releaseMic()
          events.onError(this.#t('err.asrUnreachable'), true)
          return
        }
        restarting = true
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** restartAttempt, RECONNECT_MAX_MS)
        restartAttempt += 1
        restartTimer = setTimeout(() => {
          restarting = false
          restartTimer = null
          if (!disposed) openSocket()
        }, delay)
      }
    }

    const attachMic = async (): Promise<void> => {
      try {
        stream = await withTimeout(navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }), MIC_TIMEOUT_MS, 'getUserMedia')
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Ctx === undefined) throw new Error('no AudioContext')
        audioCtx = new Ctx()
        if (audioCtx.state === 'suspended') await withTimeout(audioCtx.resume(), RESUME_TIMEOUT_MS, 'AudioContext.resume')
        if (audioCtx.state !== 'running') {
          // A suspended context runs no worklet callbacks: zero PCM, zero
          // errors, zero text. Fail loud instead of looking like a dead mic.
          releaseMic()
          events.onError(this.#t('err.asrAudio'), true)
          return
        }
        const blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }))
        await withTimeout(audioCtx.audioWorklet.addModule(blobUrl), WORKLET_TIMEOUT_MS, 'audioWorklet.addModule')
        URL.revokeObjectURL(blobUrl)
        const source = audioCtx.createMediaStreamSource(stream)
        const tap = new AudioWorkletNode(audioCtx, 'asr-tap')
        tap.port.onmessage = (event: MessageEvent): void => {
          const payload = event.data as { pcm?: ArrayBuffer; rms?: number }
          if (typeof payload.rms === 'number') events.onLevel?.(payload.rms)
          if (payload.pcm instanceof ArrayBuffer) {
            feedChunk(payload.pcm, payload.rms)
          }
        }
        source.connect(tap)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        events.onError(detail === '' ? this.#t('err.micDenied') : `${this.#t('err.micDenied')}（${detail}）`, true)
      }
    }

    void attachMic()
    openSocket()
    readyTimer = setTimeout(() => {
      readyTimer = null
      if (disposed || ready) return
      disposed = true
      if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null }
      releaseMic()
      closeSocket()
      events.onError(this.#t('err.asrNoLink'), true)
    }, READY_TIMEOUT_MS)

    return {
      stop: () => {
        disposed = true
        if (readyTimer !== null) { clearTimeout(readyTimer); readyTimer = null }
        if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null }
        restarting = false
        releaseMic()
        closeSocket()
      },
    }
  }
}
