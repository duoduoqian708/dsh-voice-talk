// Cloud speech providers: play audio synthesized by the host bridge routes
// (vendor protocols and credentials stay host-side). Two families:
//   • BridgeAudioTtsProvider — fetch → Audio → sequential chunks (xfyun);
//   • QwenRealtimeTtsProvider — one browser WS to the host upgrade, raw PCM
//     streamed into a gapless Web Audio schedule (vendor deltas are already
//     continuous, so sample-accurate scheduling removes every stitch seam).

import type { TtsProvider, TtsSession, SpeakOptions } from './speech.ts'

/** Karaoke-marker progress cadence (players only — a sentence lasts seconds). */
const MARK_TICK_MS = 500
/** Played audio subtracted before estimating, so the mark never leads the sound. */
const MARK_LEAD_S = 0.25

// ---- live readout level (call-face wave feed) -------------------------------
// Both engines expose the level of the audio actually sounding right now:
// qwen pre-computes per-chunk RMS into the playback schedule; the bridge path
// taps its Audio element through a MediaElementSource analyser. The wave
// polls readTtsLevel() per frame — 0 = silence (flat idle line).

let activePlayer: PcmStreamPlayer | null = null
let tapCtx: AudioContext | null = null
let tapAnalyser: AnalyserNode | null = null
let tapData: Uint8Array<ArrayBuffer> | null = null
let bridgePlaying = false

/** Shared analyser tap for the bridge's Audio elements (created lazily). */
function ensureTap(): { ctx: AudioContext; analyser: AnalyserNode } | null {
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor === undefined) return null
    tapCtx ??= new Ctor()
    tapAnalyser ??= tapCtx.createAnalyser()
    tapAnalyser.fftSize = 512
    tapData ??= new Uint8Array(tapAnalyser.fftSize)
    return { ctx: tapCtx, analyser: tapAnalyser }
  } catch {
    return null
  }
}

/** Playback level 0..1 of the currently sounding readout audio. */
export function readTtsLevel(): number {
  if (bridgePlaying && tapCtx !== null && tapAnalyser !== null && tapData !== null) {
    tapAnalyser.getByteTimeDomainData(tapData)
    let sum = 0
    for (let i = 0; i < tapData.length; i++) {
      const v = (tapData[i]! - 128) / 128
      sum += v * v
    }
    return Math.min(1, Math.sqrt(sum / tapData.length) * 6)
  }
  return activePlayer?.level() ?? 0
}

/** Sentence-bounded chunking shared by the chunked cloud providers. */
export function chunkForCloud(text: string, size = 120): string[] {
  if (text.length <= size) return [text]
  const sentences = text
    .replace(/([。！？；.!?])/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s !== '')
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current !== '' && current.length + sentence.length > size) {
      chunks.push(current)
      current = ''
    }
    current = current === '' ? sentence : current + sentence
  }
  if (current !== '') chunks.push(current)
  return chunks.length > 0 ? chunks : [text]
}

/**
 * Base for bridge-backed providers: one route, POST { text, voice, rate },
 * response is audio bytes. The route's error body ({ error }) surfaces as the
 * provider's error message.
 */
export class BridgeAudioTtsProvider implements TtsProvider {
  readonly id: string
  readonly #route: string
  #interrupt: (() => void) | null = null
  /** Session created by the last startSession call — cancel() must reach it:
   *  the controller's skip / barge-in / hang-up all cancel the provider. */
  #activeSession: TtsSession | null = null

  constructor(id: string, route: string) {
    this.id = id
    this.#route = route
  }

  supported(): boolean {
    return typeof window !== 'undefined' && typeof Audio !== 'undefined'
  }

  /** Theme-private extras the route consumes (endpoint override), if any. */
  #routeExtras(opts: SpeakOptions): Record<string, string> {
    const endpoint = opts.params.endpoint ?? opts.params.xfyunEndpoint
    return typeof endpoint === 'string' && endpoint !== '' ? { endpoint } : {}
  }

  speak(text: string, opts: SpeakOptions, onInterrupted: () => void): Promise<void> {
    const chunks = chunkForCloud(text)
    return new Promise((resolve, reject) => {
      let settled = false
      const audio = new Audio()
      audio.preload = 'auto'
      const cache = new Map<number, string>()

      const settle = (result: () => void): void => {
        if (settled) return
        settled = true
        this.#interrupt = null
        audio.pause()
        audio.src = ''
        for (const url of cache.values()) URL.revokeObjectURL(url)
        cache.clear()
        result()
      }
      const fail = (message: string): void => {
        onInterrupted()
        settle(() => reject(new Error(message)))
      }

      const fetchChunk = async (index: number): Promise<string> => {
        const hit = cache.get(index)
        if (hit !== undefined) {
          cache.delete(index)
          return hit
        }
        const response = await fetch(this.#route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chunks[index]!, voice: opts.voiceName, rate: opts.rate, ...this.#routeExtras(opts) }),
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `语音桥请求失败（HTTP ${response.status}）`)
        }
        const url = URL.createObjectURL(await response.blob())
        // A prefetch result lands in the cache; the consuming read removes it.
        cache.set(index, url)
        const again = cache.get(index)
        if (again !== undefined && again === url) cache.delete(index)
        return url
      }

      const prefetch = (index: number): void => {
        if (index < chunks.length && !cache.has(index)) {
          void fetchChunk(index).catch(() => { /* retried at consume time */ })
        }
      }

      const playFrom = (index: number): void => {
        if (settled) return
        if (index >= chunks.length) {
          settle(resolve)
          return
        }
        void (async () => {
          try {
            const url = await fetchChunk(index)
            if (settled) return
            prefetch(index + 1)
            audio.src = url
            audio.onended = () => {
              URL.revokeObjectURL(url)
              if (settled) return
              playFrom(index + 1)
            }
            audio.onerror = () => {
              URL.revokeObjectURL(url)
              if (settled) return
              fail('音频播放失败')
            }
            void audio.play().catch(error => {
              if (settled) return
              fail(`音频播放失败：${error instanceof Error ? error.message : String(error)}`)
            })
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error))
          }
        })()
      }

      this.#interrupt = () => {
        if (settled) return
        settled = true
        this.#interrupt = null
        audio.pause()
        audio.src = ''
        for (const url of cache.values()) URL.revokeObjectURL(url)
        cache.clear()
        onInterrupted()
        reject(new Error('interrupted'))
      }
      playFrom(0)
    })
  }

  /**
   * Streaming session: each pushed piece is fetched and played in order; the
   * fetch of piece N+1 runs while N plays (the queue order keeps audio
   * gapless in practice — synthesis per ~100-char piece is fast). Each piece
   * reports the cumulative played count when it starts playing.
   */
  startSession(opts: SpeakOptions, onInterrupted: () => void, onProgress?: (playedChars: number) => void): TtsSession {
    const queue: string[] = []
    let ended = false
    let settled = false
    let busy = false
    let played = 0
    let resolveDone: (() => void) | null = null
    let failDone: ((error: Error) => void) | null = null
    const finished = new Promise<void>((resolve, reject) => {
      resolveDone = resolve
      failDone = reject
    })
    /** The chunk on the air; cancel() stops it mid-playback. */
    let playing: { audio: HTMLAudioElement; url: string } | null = null
    /** Playback-position estimator of the sounding chunk (see reportEstimate). */
    let ticker: number | null = null
    const stopTick = (): void => {
      if (ticker !== null) {
        window.clearInterval(ticker)
        ticker = null
      }
    }
    const settleFail = (message: string): void => {
      if (settled) return
      settled = true
      stopTick()
      failDone?.(new Error(message))
    }
    const pump = (): void => {
      if (settled || busy) return
      const text = queue.shift()
      if (text === undefined) {
        if (ended) {
          settled = true
          resolveDone?.()
        }
        return
      }
      busy = true
      void (async () => {
        try {
          const response = await fetch(this.#route, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice: opts.voiceName, rate: opts.rate, ...this.#routeExtras(opts) }),
          })
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null
            throw new Error(body?.error ?? `语音桥请求失败（HTTP ${response.status}）`)
          }
          const url = URL.createObjectURL(await response.blob())
          // A cancelled session must not still fire a chunk that was in flight.
          if (settled) {
            URL.revokeObjectURL(url)
            busy = false
            return
          }
          const audio = new Audio()
          audio.src = url
          playing = { audio, url }
          bridgePlaying = true
          // Progress = this chunk's measured playback position (never the queue
          // position): the mark advances with the sound, not ahead of it.
          const base = played
          let lastReported = base
          const finishPiece = (): void => {
            stopTick()
            URL.revokeObjectURL(url)
            busy = false
            playing = null
            played = base + text.length
            onProgress?.(played)
            if (settled) return
            pump()
          }
          const reportEstimate = (): void => {
            const total = audio.duration
            if (!Number.isFinite(total) || total <= 0) return
            const fraction = Math.min(1, Math.max(0, audio.currentTime / total))
            const estimate = base + Math.round(text.length * fraction)
            if (estimate === lastReported) return
            lastReported = estimate
            onProgress?.(estimate)
          }
          // Tap the element for the wave's playback level; the source must
          // reconnect to destination or the element would go silent.
          try {
            const tap = ensureTap()
            if (tap !== null) {
              if (tap.ctx.state !== 'running') await tap.ctx.resume()
              const source = tap.ctx.createMediaElementSource(audio)
              source.connect(tap.analyser)
              source.connect(tap.ctx.destination)
              audio.onended = () => {
                bridgePlaying = false
                try { source.disconnect() } catch { /* already down */ }
                finishPiece()
              }
            }
          } catch { /* untapped: the element keeps its default output */ }
          audio.onerror = () => {
            bridgePlaying = false
            stopTick()
            URL.revokeObjectURL(url)
            busy = false
            playing = null
            if (!settled) settleFail('音频播放失败')
          }
          if (audio.onended === null) {
            audio.onended = () => { finishPiece() }
          }
          stopTick()
          ticker = window.setInterval(reportEstimate, MARK_TICK_MS)
          void audio.play().catch(error => {
            stopTick()
            busy = false
            playing = null
            if (!settled) settleFail(`音频播放失败：${error instanceof Error ? error.message : String(error)}`)
          })
        } catch (error) {
          busy = false
          if (!settled) settleFail(error instanceof Error ? error.message : String(error))
        }
      })()
    }
    const session: TtsSession = {
      push: (text) => {
        if (settled || ended) return
        queue.push(text)
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
          stopTick()
          if (playing !== null) {
            playing.audio.pause()
            playing.audio.src = ''
            URL.revokeObjectURL(playing.url)
            playing = null
          }
          bridgePlaying = false
          resolveDone?.()
        }
      },
      finished,
    }
    this.#activeSession = session
    return session
  }

  cancel(): void {
    this.#interrupt?.()
    this.#interrupt = null
    const session = this.#activeSession
    this.#activeSession = null
    session?.cancel()
  }
}

/** iFlytek streaming TTS via `/voice-tts/xfyun`. */
export class XfyunTtsProvider extends BridgeAudioTtsProvider {
  constructor() {
    super('xfyun', '/voice-tts/xfyun')
  }
}

/* ---- qwen: WS bridge + gapless PCM scheduling ------------------------------ */

/**
 * Streams raw 24 kHz 16-bit mono PCM through one AudioContext: every decoded
 * buffer is scheduled at `nextTime`, so deltas play back-to-back with no
 * stitch seam. `cancel()` stops at the sample boundary and releases.
 */
class PcmStreamPlayer {
  readonly #context: AudioContext
  readonly #gain: GainNode
  #nextTime = 0
  /** Context time of the first scheduled chunk (progress origin); null = none. */
  #firstStart: number | null = null
  #sources = new Set<AudioBufferSourceNode>()
  #cancelled = false
  /** Playback schedule with per-chunk RMS, for the "sounding now" level. */
  #levels: { start: number; end: number; rms: number }[] = []

  constructor() {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor === undefined) throw new Error('此浏览器不支持 Web Audio（需要 Chrome/Edge）')
    this.#context = new Ctor({ sampleRate: 24_000 })
    this.#gain = this.#context.createGain()
    this.#gain.connect(this.#context.destination)
    activePlayer = this
  }

  /** Feed one raw PCM delta (Int16LE mono); schedules it gapless. */
  push(data: ArrayBuffer): void {
    if (this.#cancelled || data.byteLength < 2) return
    const view = new DataView(data)
    const frames = Math.floor(data.byteLength / 2)
    const buffer = this.#context.createBuffer(1, frames, 24_000)
    const channel = buffer.getChannelData(0)
    let squareSum = 0
    for (let i = 0; i < frames; i++) {
      const value = view.getInt16(i * 2, true) / 32_768
      channel[i] = value
      squareSum += value * value
    }
    const rms = frames > 0 ? Math.sqrt(squareSum / frames) : 0
    const source = this.#context.createBufferSource()
    source.buffer = buffer
    source.connect(this.#gain)
    const now = this.#context.currentTime
    // First chunk starts immediately; later chunks chain at the exact sample
    // boundary of the previous one.
    if (this.#nextTime < now + 0.02) this.#nextTime = now + 0.02
    const start = this.#nextTime
    if (this.#firstStart === null) this.#firstStart = start
    source.start(start)
    this.#nextTime += buffer.duration
    this.#levels.push({ start, end: this.#nextTime, rms })
    this.#sources.add(source)
    source.onended = () => { this.#sources.delete(source) }
  }

  /** RMS (0..1) of the chunk sounding right now; 0 in gaps and silence. */
  level(): number {
    const now = this.#context.currentTime
    while (this.#levels.length > 0 && this.#levels[0]!.end < now - 0.05) this.#levels.shift()
    let active: { start: number; end: number; rms: number } | null = null
    for (const entry of this.#levels) {
      if (entry.start <= now + 0.02 && now < entry.end + 0.03) active = entry
    }
    return active === null ? 0 : Math.min(1, active.rms * 6)
  }

  /** Seconds of audio still queued (drains toward the session settle point). */
  get pendingSeconds(): number {
    return Math.max(0, this.#nextTime - this.#context.currentTime)
  }

  /** True once everything fed so far has finished playing. */
  get drained(): boolean {
    return this.pendingSeconds <= 0.01
  }

  /**
   * Fraction (0..1) of the scheduled audio already sounding, biased backward
   * by `leadSeconds` so the karaoke mark never runs ahead of the voice.
   */
  progress(leadSeconds: number): number {
    const first = this.#firstStart
    if (first === null) return 0
    const total = this.#nextTime - first
    if (total <= 0) return 0
    const played = Math.max(0, this.#context.currentTime - first - leadSeconds)
    return Math.min(1, played / total)
  }

  /** Stop now (barge-in / skip): unschedule everything, drop queued audio. */
  cancel(): void {
    this.#cancelled = true
    this.#levels.length = 0
    if (activePlayer === this) activePlayer = null
    for (const source of this.#sources) {
      try { source.stop() } catch { /* never started */ }
    }
    this.#sources.clear()
    void this.#context.close().catch(() => { /* already closed */ })
  }
}

/** Themes' model/endpoint keys a qwen session reads from `params`. */
function qwenParam(opts: SpeakOptions, key: 'model' | 'endpoint'): string {
  const value = opts.params[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Qwen realtime provider: one browser WS to `/voice-tts/qwen` (the host
 * translates to DashScope; the API key stays host-side). push → append,
 * done → finish; binary frames are PCM deltas scheduled gaplessly. The
 * provider tracks the active session so barge-in (`cancel()`) kills the
 * tail mid-flight — the controller calls the provider, not the session.
 */
export class QwenRealtimeTtsProvider implements TtsProvider {
  readonly id = 'qwen'
  #activeSession: TtsSession | null = null

  supported(): boolean {
    return typeof window !== 'undefined'
      && typeof WebSocket !== 'undefined'
      && (window.AudioContext !== undefined
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext !== undefined)
  }

  speak(text: string, opts: SpeakOptions, onInterrupted: () => void): Promise<void> {
    // The one-shot path rides the same streaming machinery: a session with a
    // single push — prosody benefits, and there is exactly one code path.
    let cancelled = false
    const session = this.startSession(opts, () => { cancelled = true; onInterrupted() })
    this.#activeSession = session
    session.push(text)
    session.done()
    return session.finished.then(() => {
      if (cancelled) throw new Error('interrupted')
    }).finally(() => {
      if (this.#activeSession === session) this.#activeSession = null
    })
  }

  startSession(opts: SpeakOptions, onInterrupted: () => void, onProgress?: (playedChars: number) => void): TtsSession {
    let socket: WebSocket | null = null
    let player: PcmStreamPlayer | null = null
    let ended = false
    let settled = false
    let ready = false
    let sawAudio = false
    /** Cleaned chars appended to the vendor so far (the progress denominator). */
    let charsPushed = 0
    let lastReported = -1
    let ticker: number | null = null
    const pending: string[] = []
    let resolveDone: (() => void) | null = null
    let failDone: ((error: Error) => void) | null = null
    const finished = new Promise<void>((resolve, reject) => {
      resolveDone = resolve
      failDone = reject
    })

    const stopTick = (): void => {
      if (ticker !== null) {
        window.clearInterval(ticker)
        ticker = null
      }
    }
    /** Lock the marker onto the full text once no more audio is coming. */
    const finalizeProgress = (): void => {
      stopTick()
      if (charsPushed !== lastReported) {
        lastReported = charsPushed
        onProgress?.(charsPushed)
      }
    }
    const settleFail = (message: string): void => {
      if (settled) return
      settled = true
      stopTick()
      socket?.close()
      player?.cancel()
      failDone?.(new Error(message))
    }
    const settleCancel = (): void => {
      if (settled) return
      settled = true
      stopTick()
      socket?.close()
      player?.cancel()
      resolveDone?.()
    }
    /** After finish: wait for the queued audio to drain, then resolve. */
    const drain = (): void => {
      if (settled) return
      if (player !== null && !player.drained) {
        setTimeout(() => drain(), 100)
        return
      }
      finalizeProgress()
      settled = true
      try { socket?.close() } catch { /* already down */ }
      resolveDone?.()
    }
    /**
     * Playback-driven marker: the audio clock says how much of the scheduled
     * speech has sounded; the pushed-text total scales it to characters. The
     * conservative lead keeps the estimate behind the voice, never ahead.
     */
    const reportEstimate = (): void => {
      if (settled || player === null) return
      const estimate = Math.round(charsPushed * player.progress(MARK_LEAD_S))
      if (estimate === lastReported) return
      lastReported = estimate
      onProgress?.(estimate)
    }

    try {
      socket = new WebSocket('/voice-tts/qwen')
      socket.binaryType = 'arraybuffer'
      socket.onopen = () => {
        socket?.send(JSON.stringify({
          type: 'hello',
          voice: opts.voiceName,
          rate: opts.rate,
          model: qwenParam(opts, 'model'),
          endpoint: qwenParam(opts, 'endpoint'),
        }))
      }
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          let frame: { type?: string; error?: string }
          try {
            frame = JSON.parse(event.data) as { type?: string; error?: string }
          } catch {
            return
          }
          if (frame.type === 'ready') {
            ready = true
            const queued = pending.splice(0)
            for (const text of queued) {
              socket?.send(JSON.stringify({ type: 'append', text }))
            }
            if (ended) socket?.send(JSON.stringify({ type: 'finish' }))
            return
          }
          if (frame.type === 'finished') {
            drain()
            return
          }
          if (frame.type === 'error') {
            settleFail(frame.error ?? '千问合成失败')
          }
          return
        }
        // Binary frame: one PCM delta → the gapless schedule.
        if (player === null) player = new PcmStreamPlayer()
        player.push(event.data as ArrayBuffer)
        sawAudio = true
      }
      socket.onclose = () => {
        if (!settled) {
          // The bridge closes after `finished` (normal) or on failure; an
          // un-signalled close with no audio at all is an error surface.
          if (sawAudio) {
            finalizeProgress()
            settled = true
            resolveDone?.()
          } else {
            settleFail('千问连接中断')
          }
        }
      }
      socket.onerror = () => {
        if (!settled) settleFail('千问连接失败')
      }
    } catch (error) {
      settleFail(`千问连接失败：${error instanceof Error ? error.message : String(error)}`)
    }

    const session: TtsSession = {
      push: (text) => {
        if (settled || ended || text === '') return
        // Bookkeeping only: progress is driven by the audio clock below, not
        // by the push position (that led the speaker by whole sentences).
        charsPushed += text.length
        if (!ready || socket === null) {
          pending.push(text)
          return
        }
        socket.send(JSON.stringify({ type: 'append', text }))
      },
      done: () => {
        ended = true
        if (ready && socket !== null) socket.send(JSON.stringify({ type: 'finish' }))
      },
      cancel: () => {
        ended = true
        settleCancel()
      },
      finished,
    }
    // Register on the provider so cancel() (skip / barge-in / hang-up) can
    // reach a session the controller created directly.
    this.#activeSession = session
    ticker = window.setInterval(reportEstimate, MARK_TICK_MS)
    return session
  }

  cancel(): void {
    const session = this.#activeSession
    this.#activeSession = null
    session?.cancel()
  }
}
