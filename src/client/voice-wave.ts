// The ripple visual: concentric rings around the avatar breathing with the
// live microphone amplitude while listening (AnalyserNode over a parallel
// getUserMedia capture — Chrome allows it beside SpeechRecognition),
// procedural motion for thinking/speaking. Transform/opacity only (GPU
// composited, no layout work per frame), self-contained: the component only
// mounts/unmounts it and feeds phase changes.

import type { VoicePhase } from './types.ts'

/** Grace period before the procedural fallback gives the mic another shot. */
const MIC_RETRY_MS = 8_000
const DEFAULT_RINGS = 3

export class VoiceRipple {
  readonly #container: HTMLElement
  readonly #rings: HTMLDivElement[] = []
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

  constructor(container: HTMLElement, ringCount = DEFAULT_RINGS) {
    this.#container = container
    for (let i = ringCount - 1; i >= 0; i--) {
      const ring = document.createElement('div')
      ring.className = 'dsh-voice-ring'
      ring.dataset.ring = String(i)
      container.appendChild(ring)
      this.#rings.push(ring)
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

  /** Stop the parallel capture (keeps the rings alive procedurally). */
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
    for (const ring of this.#rings) ring.remove()
    this.#rings.length = 0
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
    const n = this.#rings.length
    for (let i = 0; i < n; i++) {
      const depth = (n - 1 - Number(this.#rings[i]!.dataset.ring)) / Math.max(1, n - 1)
      const scale = this.#ringScale(depth)
      const opacity = this.#ringOpacity(depth)
      this.#rings[i]!.style.transform = `scale(${scale.toFixed(3)})`
      this.#rings[i]!.style.opacity = opacity.toFixed(3)
    }
  }

  /** Outer rings travel farther; phase scales the whole envelope. */
  #ringScale(depth: number): number {
    const wave = Math.sin(this.#t * 2.1 - depth * 1.9)
    switch (this.#phase) {
      case 'listening':
        return 1 + depth * (0.10 + this.#amp * 0.55) * (0.72 + 0.28 * wave)
      case 'thinking':
        return 1 + depth * 0.16 * (0.7 + 0.3 * wave)
      case 'speaking':
        return 1 + depth * (0.16 + this.#amp * 0.6) * (0.75 + 0.25 * wave)
      default:
        return 1 + depth * 0.06
    }
  }

  #ringOpacity(depth: number): number {
    switch (this.#phase) {
      case 'listening':
        return 0.14 + this.#amp * 0.5 * (1 - depth * 0.55)
      case 'thinking':
        return 0.1 + 0.06 * Math.sin(this.#t * 1.2)
      case 'speaking':
        return 0.16 + this.#amp * 0.55 * (1 - depth * 0.55)
      default:
        return 0.08
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
