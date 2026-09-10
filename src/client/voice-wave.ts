// The call face's motion engine (v2 "Apple" direction). One class drives:
//   - the waveform row: 19 round-capped ink bars, live mic RMS while
//     listening, synth-pulse motion while speaking, near-still when
//     thinking/idle (quiet = respect);
//   - the two breath targets: the whale circle swells while SPEAKING, the
//     hang-up key swells while LISTENING — "who speaks breathes".
// Breath is a two-layer signal: a 3.6s rest rhythm (alive even in silence)
// plus a heavily smoothed amplitude (no jitter). Transform/opacity only.
// Self-contained: the overlay mounts/unmounts it and feeds phase changes.

import type { VoicePhase } from './types.ts'

/** Grace period before the procedural fallback gives the mic another shot. */
const MIC_RETRY_MS = 8_000
const BARS = 19
/** Rest-breath period (seconds): close to a calm human breathing rhythm. */
const BREATH_PERIOD_S = 3.6
/** Amplitude smoothing factor per frame (heavy: no jitter, slow bloom). */
const AMP_SMOOTH = 0.06

/** Breath targets (refs into the overlay DOM). */
export interface BreathTargets {
  whale: HTMLElement
  key: HTMLElement
}

export class CallBreath {
  readonly #targets: BreathTargets
  readonly #wave: HTMLElement
  readonly #withBars: boolean
  readonly #bars: HTMLDivElement[] = []
  readonly #phaseOf: () => VoicePhase
  #phase: VoicePhase = 'idle'
  #muted = false
  #raf: number | null = null
  #t = 0
  #amp = 0.3
  #ampSlow = 0.3
  #audioCtx: AudioContext | null = null
  #analyser: AnalyserNode | null = null
  #stream: MediaStream | null = null
  #micTriedAt = 0
  #micFailed = false
  #data: Uint8Array | null = null

  /** withBars=false hands the wave slot to the lottie voice-print; the
   *  engine then only drives the breath targets. */
  constructor(targets: BreathTargets, waveContainer: HTMLElement, phaseOf: () => VoicePhase, withBars = true) {
    this.#targets = targets
    this.#wave = waveContainer
    this.#withBars = withBars
    this.#phaseOf = phaseOf
    this.#phase = phaseOf()
    for (let i = 0; withBars && i < BARS; i++) {
      const bar = document.createElement('div')
      bar.className = 'dsh-voice-wave-bar'
      waveContainer.appendChild(bar)
      this.#bars.push(bar)
    }
    // Hold ONE mic capture for the whole call: attach at mount, release at
    // dispose. Per-phase capture churn made the system recording indicator
    // flicker; a held capture keeps it steady and kills re-open latency.
    void this.attachMic()
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

  /** Stop the parallel capture (bars/breath keep moving procedurally). */
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

  /**
   * Mic muted: the analyser capture is released (the tab's recording
   * indicator goes dark) and the motion engine runs at its idle register.
   */
  setMuted(muted: boolean): void {
    if (this.#muted === muted) return
    this.#muted = muted
    if (muted) this.releaseMic()
    else void this.attachMic()
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
    const reported = this.#phaseOf()
    if (reported !== this.#phase) this.#phase = reported
    // Muted reads as idle: near-still bars, no breath, no live analyser.
    const phase: VoicePhase = this.#muted ? 'idle' : this.#phase
    const live = phase === 'listening' ? this.#liveAmp() : null
    const target = live ?? this.#proceduralAmp(phase)
    this.#amp += (target - this.#amp) * (live !== null ? 0.35 : 0.12)
    this.#ampSlow += (this.#amp - this.#ampSlow) * AMP_SMOOTH

    this.#tickWave(phase)
    this.#tickBreath(phase)
  }

  // ---- waveform row ---------------------------------------------------------

  /** Per-bar random-walk level (each bar dances on its own target). */
  readonly #barLevel = new Array<number>(BARS).fill(0.35)
  readonly #barTarget = new Array<number>(BARS).fill(0.5)

  /**
   * Equalizer-style bars: every bar chases its own wandering target, so the
   * row rises and falls per-bar instead of holding a fixed middle-high
   * envelope. The overall volume still gates the row (mic while listening,
   * synth pulse while speaking); per-bar motion is what makes it alive.
   */
  #tickWave(phase: VoicePhase): void {
    if (!this.#withBars) return
    for (let i = 0; i < BARS; i++) {
      // Random walk: occasionally pick a fresh target, otherwise nudge it.
      // Every bar moves independently (no shared frequency or envelope).
      const t = this.#barTarget[i]!
      this.#barTarget[i] = Math.random() < 0.05
        ? Math.random()
        : Math.max(0.08, Math.min(1, t + (Math.random() - 0.5) * 0.22))
      this.#barLevel[i]! += (this.#barTarget[i]! - this.#barLevel[i]!) * 0.3
      const level = this.#barLevel[i]!
      let heightPx: number
      switch (phase) {
        case 'listening':
          heightPx = 6 + this.#amp * 46 * level
          break
        case 'speaking':
          heightPx = 8 + this.#amp * 48 * level
          break
        case 'thinking':
          heightPx = 5 + this.#amp * 12 * level
          break
        default:
          heightPx = 5
      }
      // Base bar height is 6px; scaleY keeps the transform GPU-only.
      this.#bars[i]!.style.transform = `scaleY(${(heightPx / 6).toFixed(3)})`
    }
  }

  #proceduralAmp(phase: VoicePhase): number {
    switch (phase) {
      case 'listening': {
        // Speech-like clusters: word bursts separated by short gaps.
        const cluster = Math.pow(Math.abs(Math.sin(this.#t * 1.9 + 1)), 2.2)
        return 0.15 + 0.85 * cluster * (0.6 + 0.4 * Math.sin(this.#t * 13))
      }
      case 'thinking':
        return 0.12 + 0.04 * Math.sin(this.#t * 1.1)
      case 'speaking': {
        const pulse = Math.pow(Math.abs(Math.sin(this.#t * 4.4)), 2)
        return 0.3 + 0.7 * pulse
      }
      default:
        return 0.08
    }
  }

  // ---- breath targets --------------------------------------------------------

  /** Two-layer breath: rest rhythm + smoothed amplitude; peak ~11%. */
  #breathDrive(): number {
    const breath = 0.5 + 0.5 * Math.sin(this.#t * (Math.PI * 2) / BREATH_PERIOD_S - Math.PI / 2)
    return breath * 0.035 + this.#ampSlow * 0.075
  }

  #tickBreath(phase: VoicePhase): void {
    const { whale, key } = this.#targets
    if (phase === 'speaking') {
      const drive = this.#breathDrive()
      whale.style.transform = `scale(${(1 + drive).toFixed(4)})`
    } else {
      whale.style.transform = ''
    }
    if (phase === 'listening') {
      const drive = this.#breathDrive()
      key.style.transform = `scale(${(1 + drive * 1.1).toFixed(4)})`
    } else {
      key.style.transform = ''
    }
  }
}
