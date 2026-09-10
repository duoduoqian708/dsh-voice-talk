// The voice-print wave: plays the settings-selected lottie preset inside the
// call face's wave slot. 'wave' is the directional flowing line — it flips
// with the speaker (listening = the user speaks → the wave runs toward the
// whale). Decorative by design: lottie drives its own clock, the only thing
// we own is the slot, the flip, and teardown. The slot is wide and thin while
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

export class WavePrint {
  readonly #host: HTMLElement
  readonly #style: string
  readonly #phaseOf: () => VoicePhase
  #anim: AnimationItem | null = null
  #flipped = false

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
    this.#applyFlip()
  }

  /** Direction flip for the flowing wave: listening (user speaks) mirrors it. */
  setPhase(phase: VoicePhase): void {
    if (this.#style !== 'wave') return
    const flipped = phase === 'listening'
    if (flipped !== this.#flipped) {
      this.#flipped = flipped
      this.#applyFlip()
    }
  }

  #applyFlip(): void {
    this.#host.style.transform = this.#flipped ? 'scaleX(-1)' : ''
  }

  dispose(): void {
    this.#anim?.destroy()
    this.#anim = null
    this.#host.style.transform = ''
    this.#host.replaceChildren()
  }
}
