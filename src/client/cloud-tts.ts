// Cloud speech providers: play audio synthesized by the host bridge routes
// (vendor protocols and credentials stay host-side). Two families:
//   • BridgeAudioTtsProvider — fetch → Audio → sequential chunks (xfyun);
//   • QwenRealtimeTtsProvider — one browser WS to the host upgrade, raw PCM
//     streamed into a gapless Web Audio schedule (vendor deltas are already
//     continuous, so sample-accurate scheduling removes every stitch seam).

import type { TtsProvider, TtsSession, SpeakOptions } from './speech.ts'

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
    const settleFail = (message: string): void => {
      if (settled) return
      settled = true
      failDone?.(new Error(message))
    }
    /** The chunk on the air; cancel() stops it mid-playback. */
    let playing: { audio: HTMLAudioElement; url: string } | null = null
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
          played += text.length
          onProgress?.(played)
          audio.onended = () => {
            URL.revokeObjectURL(url)
            busy = false
            playing = null
            if (settled) return
            pump()
          }
          audio.onerror = () => {
            URL.revokeObjectURL(url)
            busy = false
            playing = null
            if (!settled) settleFail('音频播放失败')
          }
          void audio.play().catch(error => {
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
          if (playing !== null) {
            playing.audio.pause()
            playing.audio.src = ''
            URL.revokeObjectURL(playing.url)
            playing = null
          }
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
  #sources = new Set<AudioBufferSourceNode>()
  #cancelled = false

  constructor() {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor === undefined) throw new Error('此浏览器不支持 Web Audio（需要 Chrome/Edge）')
    this.#context = new Ctor({ sampleRate: 24_000 })
    this.#gain = this.#context.createGain()
    this.#gain.connect(this.#context.destination)
  }

  /** Feed one raw PCM delta (Int16LE mono); schedules it gapless. */
  push(data: ArrayBuffer): void {
    if (this.#cancelled || data.byteLength < 2) return
    const view = new DataView(data)
    const frames = Math.floor(data.byteLength / 2)
    const buffer = this.#context.createBuffer(1, frames, 24_000)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32_768
    }
    const source = this.#context.createBufferSource()
    source.buffer = buffer
    source.connect(this.#gain)
    const now = this.#context.currentTime
    // First chunk starts immediately; later chunks chain at the exact sample
    // boundary of the previous one.
    if (this.#nextTime < now + 0.02) this.#nextTime = now + 0.02
    source.start(this.#nextTime)
    this.#nextTime += buffer.duration
    this.#sources.add(source)
    source.onended = () => { this.#sources.delete(source) }
  }

  /** Seconds of audio still queued (drains toward the session settle point). */
  get pendingSeconds(): number {
    return Math.max(0, this.#nextTime - this.#context.currentTime)
  }

  /** True once everything fed so far has finished playing. */
  get drained(): boolean {
    return this.pendingSeconds <= 0.01
  }

  /** Stop now (barge-in / skip): unschedule everything, drop queued audio. */
  cancel(): void {
    this.#cancelled = true
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
    let played = 0
    const pending: string[] = []
    let resolveDone: (() => void) | null = null
    let failDone: ((error: Error) => void) | null = null
    const finished = new Promise<void>((resolve, reject) => {
      resolveDone = resolve
      failDone = reject
    })

    const settleFail = (message: string): void => {
      if (settled) return
      settled = true
      socket?.close()
      player?.cancel()
      failDone?.(new Error(message))
    }
    const settleCancel = (): void => {
      if (settled) return
      settled = true
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
      settled = true
      try { socket?.close() } catch { /* already down */ }
      resolveDone?.()
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
        // Realtime synthesis starts on append; audio follows within a beat,
        // so the push position is the marker (slightly leading the speaker).
        played += text.length
        onProgress?.(played)
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
    return session
  }

  cancel(): void {
    const session = this.#activeSession
    this.#activeSession = null
    session?.cancel()
  }
}
