// Shared custom voice dropdown: the call overlay's speaker picker and the
// settings provider-modal's 音色 field use this one component, so both
// surfaces stay visually and behaviorally identical.
//
// Popup strategies:
//   'absolute' (default) — inside the root, opening upward; the overlay host
//     never clips it, and this is the overlay's original behavior.
//   'portal' — portaled to <body> and fixed-positioned, re-anchored to the
//     trigger while open: the settings modal scrolls (overflow-y: auto) and
//     would clip an absolutely positioned popup, and the modal veil
//     (z-index 10000) also sits above the dialog.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactElement } from 'react'
import type { speakersForTheme } from './voice-themes.ts'
import type { VoiceTranslate, VoiceKey } from './locales.ts'

interface VoicePickerProps {
  options: ReturnType<typeof speakersForTheme>
  /** Selected id ('' = the theme/platform default). */
  value: string
  /** Id marked with （默认）; nothing is marked when undefined. */
  defaultId?: string
  /** While true the trigger refuses to open and an open popup folds. */
  locked?: boolean
  /** Tooltip for the locked trigger. */
  lockHint?: string
  /** Namespace-bound translator (the framework locale seat). */
  t: VoiceTranslate
  ariaLabel: string
  strategy?: 'absolute' | 'portal'
  onChange(id: string): void
}

interface Anchor {
  left: number
  top: number | null
  bottom: number | null
  width: number
  maxHeight: number
}

export function VoicePicker({ options, value, defaultId = '', locked = false, lockHint, t, ariaLabel, strategy = 'absolute', onChange }: VoicePickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const currentRef = useRef<HTMLButtonElement | null>(null)

  /** The '' row is the theme/platform default: its label is copy, not data. */
  const displayLabel = (option: { id: string; label: string }): string =>
    option.id === '' ? t('picker.systemDefault') : option.label
  const labelOf = (id: string): string => {
    const hit = options.find(o => o.id === id)
    return hit !== undefined && !('more' in hit) ? displayLabel(hit) : (id === '' ? t('picker.systemDefault') : id)
  }
  const groups = [...new Set(options.flatMap(o => ('group' in o && o.group !== undefined ? [o.group] : [])))] as VoiceKey[]

  // Outside click / Esc folds the popup. The portal popup lives outside the
  // root, so it is checked explicitly.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) === true) return
      if (popRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (locked) setOpen(false)
  }, [locked])

  // Portal: anchor above the trigger (flip below when there is no room) and
  // follow it through modal scrolling / window resizing.
  useLayoutEffect(() => {
    if (!open || strategy !== 'portal') return
    const place = (): void => {
      const trigger = rootRef.current
      if (trigger === null) return
      const rect = trigger.getBoundingClientRect()
      const margin = 8
      const gap = 10
      const width = Math.max(rect.width, 240)
      const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin))
      const spaceAbove = rect.top - gap - margin
      const spaceBelow = window.innerHeight - rect.bottom - gap - margin
      const openUp = spaceAbove >= spaceBelow
      const maxHeight = Math.max(120, Math.min(300, openUp ? spaceAbove : spaceBelow))
      setAnchor(openUp
        ? { left, width, top: null, bottom: window.innerHeight - rect.top + gap, maxHeight }
        : { left, width, top: rect.bottom + gap, bottom: null, maxHeight })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, strategy])

  // Open onto the current row, not the top of a long roster.
  useEffect(() => {
    if (open) currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open, anchor])

  const pick = (id: string): void => {
    onChange(id)
    setOpen(false)
  }
  const item = (option: { id: string; label: string }): ReactElement => (
    <button
      key={option.id || '__default'}
      ref={option.id === value ? currentRef : undefined}
      type='button'
      role='option'
      aria-selected={option.id === value}
      className='dsh-voice-speaker-item'
      data-current={option.id === value || undefined}
      onClick={() => pick(option.id)}
    >
      <span className='dsh-voice-speaker-check' aria-hidden='true'>{option.id === value ? '✓' : ''}</span>
      <span className='dsh-voice-speaker-label'>{displayLabel(option)}{option.id === defaultId ? t('picker.defaultMark') : ''}</span>
    </button>
  )
  const popup = (
    <div
      ref={popRef}
      className={strategy === 'portal' ? 'dsh-voice-speaker-pop is-portal' : 'dsh-voice-speaker-pop'}
      role='listbox'
      aria-label={ariaLabel}
      style={strategy === 'portal' && anchor !== null
        ? { left: anchor.left, top: anchor.top ?? undefined, bottom: anchor.bottom ?? undefined, width: anchor.width, maxHeight: anchor.maxHeight, height: 'auto' }
        : undefined}
    >
      {groups.length === 0
        ? options.map(option => item(option))
        : groups.map(group => (
          <div key={group} role='group' aria-label={t(group)}>
            <div className='dsh-voice-speaker-group'>{t(group)}</div>
            {options.filter(o => 'group' in o && o.group === group).map(option => item(option))}
          </div>
        ))}
    </div>
  )
  return (
    <>
      <div className='dsh-voice-speaker' ref={rootRef}>
        <button
          type='button'
          className='dsh-voice-speaker-btn'
          data-locked={locked || undefined}
          onClick={() => { if (!locked) setOpen(o => !o) }}
          title={locked ? (lockHint ?? ariaLabel) : ariaLabel}
          aria-haspopup='listbox'
          aria-expanded={open}
          aria-label={ariaLabel}
        >
          <span className='dsh-voice-ctl-value'>{labelOf(value)}</span>
          <i className='dsh-voice-speaker-caret' aria-hidden='true' />
        </button>
        {strategy === 'absolute' && open && popup}
      </div>
      {strategy === 'portal' && open && anchor !== null && createPortal(popup, document.body)}
    </>
  )
}
