// The voice-print wave: plays the settings-selected lottie preset inside the
// call face's wave slot. 'wave' is the directional flowing line — it flips
// with the speaker (listening = the user speaks → the wave runs toward the
// whale). Decorative by design: the only things we own are the slot, the
// flip, the amplitude squash, and teardown. The slot is wide and thin while
// both comps are tall, so the renderer fills the width and crops the empty
// vertical bands (xMidYMid slice — sound_waves spans x 12..498 of 512, the
// wave line sits on the comp's vertical center).

import lottie from 'lottie-web/build/player/lottie.min.js'
import type { AnimationItem } from 'lottie-web'
import equalizerData from './assets/lottie/sound_waves.json' with { type: 'json' }
import waveData from './assets/lottie/wave-wave.json' with { type: 'json' }
import type { VoicePhase } from './types.ts'

/** Preset id → lottie animation data (matches the settings picker's ids). */
const DATA: Record<string, object> = { equalizer: equalizerData, wave: waveData }

/** scaleY of the idle line — the squashed frame, paused, reads as a flat line. */
const IDLE_SCALE = 0.04
/** Smoothed level at which an idle print settles and the lottie pauses. */
const IDLE_SETTLE_LEVEL = 0.015

export class WavePrint {
  readonly #host: HTMLElement
  readonly #style: string
  readonly #phaseOf: () => VoicePhase
  #anim: AnimationItem | null = null
  #flipped = false
  /** Smoothed display amplitude 0..1 — 0 renders the flat idle line. */
  #level = 0
  /** Whether the lottie clock runs (paused while idle, see setLevel). */
  #playing = true
  /** Last transform written (idle frames must not touch the DOM at all). */
  #lastTransform = ''

  constructor(host: HTMLElement, style: string, phaseOf: () => VoicePhase) {
    this.#host = host
    this.#style = style
    this.#phaseOf = phaseOf
    this.#mount()
  }

  /** Mount the selected preset (a fresh data copy — lottie keeps and can
   *  mutate the object it is handed, so remounts never share state). */
  #mount(): void {
    const data = DATA[this.#style]
    if (data === undefined) return
    this.#anim = lottie.loadAnimation({
      container: this.#host,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: JSON.parse(JSON.stringify(data)) as object,
      rendererSettings: { preserveAspectRatio: 'xMidYMid slice' },
    })
    this.#flipped = this.#style === 'wave' && this.#phaseOf() === 'listening'
    this.#applyTransform()
  }

  /** Direction flip for the flowing wave: listening (user speaks) mirrors it. */
  setPhase(phase: VoicePhase): void {
    if (this.#style !== 'wave') return
    const flipped = phase === 'listening'
    if (flipped !== this.#flipped) {
      this.#flipped = flipped
      this.#applyTransform()
    }
  }

  /**
   * Per-frame mic level from the shared capture: 0 renders the flat idle
   * line, speech expands the wave (scaleY) with fast attack / slow release.
   * Fed every frame by the breath's rAF — no own clock, driven passively.
   */
  setLevel(level: number): void {
    const target = level <= 0.05 ? 0 : Math.min(1, level)
    this.#level += (target - this.#level) * (target > this.#level ? 0.4 : 0.18)
    // Idle must be motionless: once the release envelope has settled, pause
    // the lottie — squashing an animating comp to 4% used to leave a fast
    // jitter as the visible "line". Any real level resumes the clock.
    if (target > 0) {
      if (!this.#playing) {
        this.#playing = true
        this.#anim?.play()
      }
    } else if (this.#playing && this.#level < IDLE_SETTLE_LEVEL) {
      this.#playing = false
      this.#anim?.pause()
    }
    this.#applyTransform()
  }

  /** Flip + amplitude on one transform: scaleY compresses toward the comp's
   *  vertical center, which both presets share — idle is a plain line. */
  #applyTransform(): void {
    const s = IDLE_SCALE + this.#level * 1.2
    const transform = `${this.#flipped ? 'scaleX(-1) ' : ''}scaleY(${s.toFixed(3)})`
    if (transform === this.#lastTransform) return
    this.#lastTransform = transform
    this.#host.style.transform = transform
  }

  dispose(): void {
    this.#anim?.destroy()
    this.#anim = null
    this.#host.style.transform = ''
    this.#host.replaceChildren()
  }
}
