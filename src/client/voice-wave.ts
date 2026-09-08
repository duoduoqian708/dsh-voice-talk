// The wave visual: a row of thin bars breathing with the live microphone
// amplitude while listening (AnalyserNode over a parallel getUserMedia
// capture — Chrome allows it beside SpeechRecognition), procedural motion
// for thinking/speaking. DOM-driven (bar heights via rAF), self-contained:
// the component only mounts/unmounts it and feeds phase changes.

import type { VoicePhase } from './types.ts'

/** Grace period before the procedural fallback gives the mic another shot. */
const MIC_RETRY_MS = 8_000
const DEFAULT_BARS = 9

/** Amplitude source for one frame: live RMS or a procedural envelope. */
export interface WaveDriver {
  /** Current 0..1 amplitude. */
  amp(): number
}

export class VoiceWave {
  readonly #container: HTMLElement
  readonly #bars: HTMLDivElement[] = []
  #phase: VoicePhase = 'idle'
  #raf: number | null = null
  #t = 0
  #amp = 0.3
  #audioCtx: AudioContext | null = null
  #analyser: AnalyserNode | null = null
  #stream: MediaStream | null = null
  #micTriedAt = 0
  #micFailed = false
  #data: Uint8Array | null = null

  constructor(container: HTMLElement, barCount = DEFAULT_BARS) {
    this.#container = container
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div')
      bar.className = 'dsh-voice-wave-bar'
      container.appendChild(bar)
      this.#bars.push(bar)
    }
  }

  /** Mount the live mic analyser (silently degrades to procedural motion). */
  async attachMic(): Promise<void> {
    if (this.#analyser !== null || (this.#micFailed && Date.now() - this.#micTriedAt < MIC_RETRY_MS)) return
    if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) {
      this.#micFailed = true
      return
    }
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx === undefined) throw new Error('no AudioContext')
      this.#audioCtx = new Ctx()
      if (this.#audioCtx.state === 'suspended') await this.#audioCtx.resume()
      const source = this.#audioCtx.createMediaStreamSource(this.#stream)
      const analyser = this.#audioCtx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.55
      source.connect(analyser)
      this.#analyser = analyser
      this.#data = new Uint8Array(analyser.fftSize)
    } catch {
      // Permission refused or capture unavailable: procedural motion carries on.
      this.#micFailed = true
      this.#micTriedAt = Date.now()
      this.releaseMic()
    }
  }

  /** Stop the parallel capture (keeps the bars alive procedurally). */
  releaseMic(): void {
    this.#stream?.getTracks().forEach(track => track.stop())
    this.#stream = null
    void this.#audioCtx?.close().catch(() => { /* already closed */ })
    this.#audioCtx = null
    this.#analyser = null
    this.#data = null
  }

  setPhase(phase: VoicePhase): void {
    this.#phase = phase
  }

  start(): void {
    if (this.#raf !== null) return
    const frame = (): void => {
      this.#raf = requestAnimationFrame(frame)
      this.#tick()
    }
    this.#raf = requestAnimationFrame(frame)
  }

  dispose(): void {
    if (this.#raf !== null) cancelAnimationFrame(this.#raf)
    this.#raf = null
    this.releaseMic()
    for (const bar of this.#bars) bar.remove()
    this.#bars.length = 0
  }

  /** Live microphone RMS, 0..1 (null while no analyser). */
  #liveAmp(): number | null {
    if (this.#analyser === null || this.#data === null) return null
    this.#analyser.getByteTimeDomainData(this.#data as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 0; i < this.#data.length; i++) {
      const v = (this.#data[i]! - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / this.#data.length)
    return Math.min(1, rms * 6)
  }

  #tick(): void {
    this.#t += 1 / 60
    const live = this.#phase === 'listening' ? this.#liveAmp() : null
    const target = live ?? this.#proceduralAmp()
    this.#amp += (target - this.#amp) * (live !== null ? 0.35 : 0.12)
    const center = (this.#bars.length - 1) / 2
    for (let i = 0; i < this.#bars.length; i++) {
      const spread = Math.abs(i - center) / center
      const jitter = 0.5 + 0.5 * Math.abs(Math.sin(this.#t * 9 + i * 1.7))
      const height = this.#barHeight(spread, jitter)
      this.#bars[i]!.style.height = `${height.toFixed(1)}px`
    }
  }

  #barHeight(spread: number, jitter: number): number {
    const shape = 1.18 - spread * 0.85
    switch (this.#phase) {
      case 'listening':
        // Live voice: amplitude-driven with a comfortable floor so the row
        // never looks dead between words.
        return 10 + this.#amp * 74 * shape * (0.55 + 0.45 * jitter)
      case 'thinking':
        return 10 + this.#amp * 30 * shape * (0.4 + 0.6 * jitter)
      case 'speaking':
        return 12 + this.#amp * 84 * shape * (0.45 + 0.55 * jitter)
      default:
        return 10
    }
  }

  #proceduralAmp(): number {
    switch (this.#phase) {
      case 'listening': {
        // Speech-like clusters: word bursts separated by short gaps.
        const cluster = Math.pow(Math.abs(Math.sin(this.#t * 1.9 + 1)), 2.2)
        return 0.15 + 0.85 * cluster * (0.6 + 0.4 * Math.sin(this.#t * 13))
      }
      case 'thinking':
        return 0.12 + 0.06 * Math.sin(this.#t * 1.2)
      case 'speaking': {
        const pulse = Math.pow(Math.abs(Math.sin(this.#t * 4.4)), 2)
        return 0.3 + 0.7 * pulse
      }
      default:
        return 0.2
    }
  }
}
