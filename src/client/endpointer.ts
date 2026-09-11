// Local voice-activity endpointer: turns the raw mic level into an
// "is the user speaking" signal. Pure and timer-free — the caller feeds one
// RMS frame per captured chunk and reads `active`.
//
// The noise floor adapts while quiet, so steady room noise (fans, hum) is
// learned as the floor instead of counting as speech. Thresholds are
// hysteretic (a higher bar to open than to stay open) and opening needs a
// short run of loud frames, so clicks, key taps and door slams never count.

/** Floor multiple a frame must clear to OPEN voice. */
const VOICE_ON_RATIO = 3
/** Floor multiple a frame must fall under to CLOSE voice. */
const VOICE_OFF_RATIO = 1.6
/** Absolute loudness floor: below this nothing counts as voice. */
const MIN_LEVEL = 0.004
/** Consecutive loud frames needed to open (short transients never reach it). */
const OPEN_FRAMES = 3
/** Consecutive quiet frames needed to close (word gaps do not). */
const CLOSE_FRAMES = 5
/** Noise-floor adaptation rate while quiet, per frame. */
const FLOOR_ALPHA = 0.05

export class VoiceEndpointer {
  #floor = MIN_LEVEL
  #open = false
  #loud = 0
  #quiet = 0

  /** Feed one RMS frame (0..1); returns whether voice is active after it. */
  push(rms: number): boolean {
    const on = Math.max(this.#floor * VOICE_ON_RATIO, MIN_LEVEL)
    const off = Math.max(this.#floor * VOICE_OFF_RATIO, MIN_LEVEL)
    if (this.#open) {
      if (rms >= off) {
        this.#quiet = 0
      } else if (++this.#quiet >= CLOSE_FRAMES) {
        this.#open = false
        this.#loud = 0
        this.#quiet = 0
      }
      return this.#open
    }
    // Track the floor only while quiet: speech never inflates it.
    const capped = Math.min(rms, this.#floor * 2)
    this.#floor = Math.max(this.#floor * (1 - FLOOR_ALPHA) + capped * FLOOR_ALPHA, MIN_LEVEL / 4)
    if (rms >= on) {
      if (++this.#loud >= OPEN_FRAMES) {
        this.#open = true
        this.#quiet = 0
      }
    } else {
      this.#loud = 0
    }
    return this.#open
  }

  get active(): boolean {
    return this.#open
  }

  /** Drop the live state (the learned floor is kept — rooms do not change). */
  reset(): void {
    this.#open = false
    this.#loud = 0
    this.#quiet = 0
  }
}
