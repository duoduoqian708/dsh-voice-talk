// The cloud recognizer: mic PCM streams through the host bridge (which owns
// the credentials) into a streaming ASR vendor. It implements the same
// Recognizer surface the loop has always driven, so the controller keeps its
// arm/disarm/echo logic untouched — only the engine underneath changed
// (the browser's Web Speech recognition is retired).
//
// Audio path: getUserMedia → AudioWorklet (inline via Blob URL) downsamples
// to 16k/16-bit/mono and reports a per-chunk RMS; the main thread applies
// hysteresis for speech-activity transitions (drives the 60s utterance cap).
// Protocol: binary PCM frames up, JSON events down over /voice-asr/<vendor>
// (the host bridge normalizes every vendor to that shape).
//
// Reconnect policy mirrors the old ChromeRecognizer's contract: unexpected
// drops re-arm with backoff while the handle is alive; a vendor-protocol
// error is fatal (auth/quota — retrying cannot help). stop() tears down
// everything for real — socket closed, mic tracks stopped, no restart
// timers (the post-hang-up capture bug was born from breaking that rule).

import type { RecognitionEvents, RecognitionHandle, Recognizer } from './speech.ts'

export type AsrVendor = 'qwen' | 'xfyun'

/** 40ms of 16k 16-bit mono PCM — the vendor's canonical chunk (640 samples). */
const CHUNK_SAMPLES = 640
const RECONNECT_BASE_MS = 250
const RECONNECT_MAX_MS = 4_000
/** Speech-activity hysteresis on raw float RMS (start above, stop below). */
const SPEECH_ON_RMS = 0.025
const SPEECH_OFF_RMS = 0.012
/** Hold time so one breathy frame cannot flick the activity flag off. */
const SPEECH_HOLD_MS = 300

/** The worklet: streaming linear resample to 16k + int16 chunking + RMS. */
const WORKLET_SRC = `
class AsrTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.pos = 0
    this.last = 0
    this.chunk = []
    this.rmsSum = 0
    this.rmsCount = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch === undefined || ch.length === 0) return true
    const ratio = this.ratio
    let pos = this.pos
    let last = this.last
    let sum = this.rmsSum
    let n = this.rmsCount
    while (pos < ch.length) {
      const idx = pos | 0
      const f = pos - idx
      const a = idx === 0 ? last : ch[idx - 1]
      const s = a + (ch[idx] - a) * f
      sum += s * s
      n += 1
      this.chunk.push(s)
      pos += ratio
      if (this.chunk.length >= 640) {
        const pcm = new Int16Array(640)
        for (let k = 0; k < 640; k++) {
          const v = Math.max(-1, Math.min(1, this.chunk[k]))
          pcm[k] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767)
        }
        const rms = n > 0 ? Math.sqrt(sum / n) : 0
        this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer])
        this.chunk = []
        sum = 0
        n = 0
      }
    }
    this.pos = pos - ch.length
    this.last = ch[ch.length - 1]
    this.rmsSum = sum
    this.rmsCount = n
    return true
  }
}
registerProcessor('asr-tap', AsrTap)
`

export class CloudRecognizer implements Recognizer {
  readonly #vendor: AsrVendor

  constructor(vendor: AsrVendor) {
    this.#vendor = vendor
  }

  supported(): boolean {
    return typeof navigator !== 'undefined'
      && navigator.mediaDevices !== undefined
      && typeof WebSocket !== 'undefined'
  }

  start(events: RecognitionEvents): RecognitionHandle | null {
    let disposed = false
    let restarting = false
    let restartAttempt = 0
    let restartTimer: ReturnType<typeof setTimeout> | null = null
    let socket: WebSocket | null = null
    let ready = false
    const pending: ArrayBuffer[] = []
    let stream: MediaStream | null = null
    let audioCtx: AudioContext | null = null
    let speechActive = false
    let speechAt = 0

    const bridgeUrl = (): string => {
      const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws'
      return `${proto}://${location.host}/voice-asr/${this.#vendor}`
    }

    const closeSocket = (): void => {
      const s = socket
      socket = null
      ready = false
      if (s !== null) { try { s.close() } catch { /* already down */ } }
    }

    const releaseMic = (): void => {
      stream?.getTracks().forEach(track => track.stop())
      stream = null
      void audioCtx?.close().catch(() => { /* already closed */ })
      audioCtx = null
    }

    /** Hysteresis: fast ON, slow OFF — one breathy frame cannot flick the flag. */
    const observeRms = (rms: number): void => {
      const now = Date.now()
      const active = speechActive
        ? rms > SPEECH_OFF_RMS || now - speechAt < SPEECH_HOLD_MS
        : rms > SPEECH_ON_RMS
      if (active !== speechActive) {
        speechActive = active
        if (active) speechAt = now
        events.onSpeechActive(active)
      }
    }

    const sendChunk = (buffer: ArrayBuffer): void => {
      if (socket === null || socket.readyState !== WebSocket.OPEN || !ready) {
        pending.push(buffer)
        return
      }
      try { socket.send(buffer) } catch { pending.push(buffer) }
    }

    const handleUpstream = (data: string): void => {
      let event: { type?: string; text?: string; error?: string }
      try {
        event = JSON.parse(data) as { type?: string; text?: string; error?: string }
      } catch {
        return
      }
      if (event.type === 'ready') {
        ready = true
        // Every successful session resets the backoff — iFlytek's per-utterance
        // rotation must not let the reconnect delay creep toward its max.
        restartAttempt = 0
        for (const chunk of pending.splice(0)) sendChunk(chunk)
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
        events.onError(event.error ?? '语音识别失败', true)
      }
    }

    const openSocket = (): void => {
      const ws = new WebSocket(bridgeUrl())
      socket = ws
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello', lang: navigator.language }))
      }
      ws.onmessage = event => {
        if (typeof event.data === 'string') handleUpstream(event.data)
      }
      ws.onclose = () => {
        socket = null
        ready = false
        if (disposed || restarting) return
        // Unexpected drop (network blip): re-arm with backoff, mic stays.
        restarting = true
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** restartAttempt, RECONNECT_MAX_MS)
        restartAttempt += 1
        restartTimer = setTimeout(() => {
          restarting = false
          restartTimer = null
          if (!disposed) openSocket()
        }, delay)
      }
      ws.onerror = () => { /* the close event follows */ }
    }

    const attachMic = async (): Promise<void> => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Ctx === undefined) throw new Error('no AudioContext')
        audioCtx = new Ctx()
        if (audioCtx.state === 'suspended') await audioCtx.resume()
        const blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }))
        await audioCtx.audioWorklet.addModule(blobUrl)
        URL.revokeObjectURL(blobUrl)
        const source = audioCtx.createMediaStreamSource(stream)
        const tap = new AudioWorkletNode(audioCtx, 'asr-tap')
        tap.port.onmessage = (event: MessageEvent): void => {
          const payload = event.data as { pcm?: ArrayBuffer; rms?: number }
          if (typeof payload.rms === 'number') observeRms(payload.rms)
          if (payload.pcm instanceof ArrayBuffer) sendChunk(payload.pcm)
        }
        source.connect(tap)
      } catch {
        events.onError('麦克风不可用或被拒绝', true)
      }
    }

    void attachMic()
    openSocket()

    return {
      stop: () => {
        disposed = true
        if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null }
        restarting = false
        releaseMic()
        closeSocket()
      },
    }
  }
}
