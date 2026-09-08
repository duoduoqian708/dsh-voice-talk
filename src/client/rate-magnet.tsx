// The magnet rate slider, shared by the call overlay and the settings modal.
// One discrete stop per notch (RATE_STOPS), drawn with tick dots under the
// track; an off-grid stored rate displays its nearest stop without writing
// back (the value only persists when the user moves the slider).

import type { ReactElement } from 'react'
import { RATE_STOPS, nearestRateIndex } from './voice-settings.ts'

/** Props: current rate, the write-through setter, and an extra class hook. */
export function RateMagnetSlider({ rate, onChange, className }: {
  rate: number
  onChange(next: number): void
  className?: string
}): ReactElement {
  const index = nearestRateIndex(rate)
  return (
    <span className={`dsh-voice-rate-magnet${className ? ` ${className}` : ''}`}>
      <input
        type='range'
        min='0'
        max={RATE_STOPS.length - 1}
        step='1'
        value={index}
        onChange={event => { onChange(RATE_STOPS[Number(event.target.value)]!) }}
        aria-label='语速'
      />
      <span className='dsh-voice-rate-ticks' aria-hidden='true'>
        {RATE_STOPS.map(stop => (
          <i key={stop} className={stop === RATE_STOPS[index] ? 'is-active' : ''} />
        ))}
      </span>
    </span>
  )
}
