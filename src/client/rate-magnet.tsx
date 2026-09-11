// The magnet rate slider used by the call overlay's bottom control row.
// A fully transparent native <input type=range> underneath keeps the pointer,
// touch, keyboard, and a11y semantics; the visible track/fill/thumb are driven
// by a CSS variable set straight from input events, so a drag never waits on a
// React render. The numeric label and the active tick only re-render when the
// nearest stop changes, and releasing (or an arrow key) glides the thumb onto
// that stop — the magnetic snap.

import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { RATE_STOPS, nearestRateIndex, nearestRateLabel } from './voice-settings.ts'

const TRAVEL = RATE_STOPS.length - 1

export function RateMagnetSlider({ rate, onChange, className }: {
  rate: number
  onChange(next: number): void
  className?: string
}): ReactElement {
  // Displayed stop. Only the user moves it, and always onto a stop, so the
  // `rate` prop needs no external-sync path (nothing else writes it).
  const [index, setIndex] = useState(() => nearestRateIndex(rate))
  const indexRef = useRef(index)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const snapTimer = useRef<number | null>(null)

  const setRatio = (ratio: number): void => {
    rootRef.current?.style.setProperty('--dsh-rate-ratio', String(ratio))
  }

  // Paint the initial position once. The var is imperative afterwards, so a
  // parent re-render mid-drag cannot yank the thumb back onto a stop.
  useLayoutEffect(() => { setRatio(indexRef.current / TRAVEL) }, [])
  useLayoutEffect(() => () => {
    if (snapTimer.current !== null) window.clearTimeout(snapTimer.current)
  }, [])

  const commit = (next: number): void => {
    if (next === indexRef.current) return
    indexRef.current = next
    setIndex(next)
    onChange(RATE_STOPS[next]!)
  }

  /** Glide onto a stop (release / keyboard): animate, pin the input, commit. */
  const snapTo = (next: number): void => {
    const clamped = Math.min(TRAVEL, Math.max(0, next))
    const root = rootRef.current
    if (root !== null) {
      root.classList.add('is-snapping')
      if (snapTimer.current !== null) window.clearTimeout(snapTimer.current)
      snapTimer.current = window.setTimeout(() => { root.classList.remove('is-snapping') }, 180)
    }
    setRatio(clamped / TRAVEL)
    if (inputRef.current !== null) inputRef.current.value = String(clamped)
    commit(clamped)
  }

  // Continuous drag: follow the pointer verbatim; only stop crossings render.
  const onInput = (event: React.FormEvent<HTMLInputElement>): void => {
    const value = Number(event.currentTarget.value)
    rootRef.current?.classList.remove('is-snapping')
    setRatio(value / TRAVEL)
    commit(Math.round(value))
  }

  // The native range keeps the pointer during a drag, so pointerup can land
  // anywhere — finish through window listeners and snap from the input value.
  const onPointerDown = (): void => {
    const root = rootRef.current
    root?.classList.remove('is-snapping')
    root?.classList.add('is-dragging')
    const finish = (): void => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      root?.classList.remove('is-dragging')
      const value = inputRef.current?.value
      if (value !== undefined) snapTo(Math.round(Number(value)))
    }
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const current = indexRef.current
    let next: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') next = current - 1
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') next = current + 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TRAVEL
    if (next === null) return
    event.preventDefault()
    snapTo(next)
  }

  const label = nearestRateLabel(RATE_STOPS[index]!)
  return (
    <>
      <span className='dsh-voice-ctl-value'>{label}</span>
      <span ref={rootRef} className={`dsh-voice-rate-magnet${className ? ` ${className}` : ''}`}>
        <span className='dsh-voice-rate-track' aria-hidden='true' />
        <span className='dsh-voice-rate-fill' aria-hidden='true' />
        <span className='dsh-voice-rate-thumb' aria-hidden='true' />
        <input
          ref={inputRef}
          type='range'
          min='0'
          max={TRAVEL}
          step='0.01'
          defaultValue={index}
          onChange={onInput}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          aria-label='语速'
          aria-valuemin={0}
          aria-valuemax={TRAVEL}
          aria-valuenow={index}
          aria-valuetext={label}
        />
        <span className='dsh-voice-rate-ticks' aria-hidden='true'>
          {RATE_STOPS.map((stop, i) => (
            <i key={stop} className={i === index ? 'is-active' : ''} />
          ))}
        </span>
      </span>
    </>
  )
}
