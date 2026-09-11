// Text-mode surface: ONE mic button on the composer tool row. Everything
// voice — speaking, reading aloud, status, controls — lives inside the call
// overlay; the text mode stays pure text.

import type { ReactElement } from 'react'
import type { TranscriptState, VoiceStatus } from './types.ts'
import type { ObservableSource } from './store.ts'
import type { VoiceTranslate } from './locales.ts'

/**
 * Selector-hook shape the renderer binds for each inject `hooks` member
 * (structural match of the framework's SnapshotSelectorHook).
 */
export type VoiceSelectorHook = <S>(selector: (snapshot: VoiceStatus) => S, eq?: (a: S, b: S) => boolean) => S

/**
 * Business face the inject factory returns (the raw shape: hooks compartment
 * + verbs). The framework binds each hooks member into a `use<Name>` selector
 * hook, so components receive {@link VoiceSurfaceProps}.
 */
export interface VoiceInjected {
  /** The shared voice status source (bound to `useVoice`). */
  hooks: {
    voice: { getSnapshot(): VoiceStatus; subscribe(listener: () => void): () => void }
  }
  /** The session transcript source (bound to `useTranscript`); absent on mic button. */
  transcript?: ObservableSource<TranscriptState>
  /** Enter or leave the voice loop (pure on/off; same as the mic button). */
  toggleVoice(): void
  /** Leave the voice loop (explicit off; the overlay hang-up uses it). */
  hangUp(): void
  /** Toggle in-call mic mute (capture off, the loop stays armed). */
  toggleMute(): void
  /** Skip the current readout. */
  stopSpeaking(): void
  /** Session-scope rate override (HUD writes; dies with the session). */
  setRateOverride(rate: number): void
  /** Session-scope speaker override (same lifecycle as the rate override). */
  setVoiceOverride(voice: string): void
  /** Persist one settings field (settings-page writes ride the wire). */
  setField(field: string, value: unknown): void
  /** Live session-effective settings (speaker/rate read per render). */
  settings(): { rate: number; voiceName: string; voiceLang: string; ttsTheme: string; speakerByTheme: Record<string, string>; storedSpeakerByTheme: Record<string, string>; waveStyle: string; asrTheme: string }
}

/** Component props: the injected face with the hooks compartment bound. */
export interface VoiceSurfaceProps {
  /** Selector hook over the shared voice status (framework-bound). */
  useVoice: VoiceSelectorHook
  /** The session transcript source (overlay binds its own hook). */
  transcript?: ObservableSource<TranscriptState>
  /** Enter or leave the voice loop (pure on/off). */
  toggleVoice(): void
  /** Leave the voice loop (explicit off). */
  hangUp(): void
  /** Toggle in-call mic mute (capture off, the loop stays armed). */
  toggleMute(): void
  /** Skip the current readout. */
  stopSpeaking(): void
  /** Session-scope rate override (HUD writes; dies with the session). */
  setRateOverride(rate: number): void
  /** Session-scope speaker override (same lifecycle as the rate override). */
  setVoiceOverride(voice: string): void
  /** Persist one settings field (settings-page writes ride the wire). */
  setField(field: string, value: unknown): void
  /** Live session-effective settings (speaker/rate read per render). */
  settings(): { rate: number; voiceName: string; voiceLang: string; ttsTheme: string; speakerByTheme: Record<string, string>; storedSpeakerByTheme: Record<string, string>; waveStyle: string; asrTheme: string }
}

/** Props of the mic button (composer tool-row seat): the injected face plus
 *  the framework-injected locale seat (`locale: NS` on the registration). */
export type MicButtonProps = VoiceSurfaceProps & { t: VoiceTranslate }

/**
 * The mic button: the text mode's single voice affordance. Idle → click arms
 * the hands-free loop (the call overlay mounts with it); any active state →
 * click hangs up. Ambiguity-free: a second click always closes, never submits.
 */
export function MicButton({ useVoice, toggleVoice, t }: MicButtonProps): ReactElement {
  const mode = useVoice(s => s.mode)
  const phase = useVoice(s => s.phase)
  const active = mode === 'loop'
  const className = [
    'dsh-voice-mic',
    active ? 'is-loop' : '',
    phase === 'listening' ? 'is-listening' : '',
  ].filter(Boolean).join(' ')
  const title = active ? t('mic.titleActive') : t('mic.titleIdle')
  return (
    <button
      type='button'
      className={className}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={toggleVoice}
    >
      <MicIcon />
      {active && <span className='dsh-voice-mic-badge'>{t('mic.badge')}</span>}
    </button>
  )
}

function MicIcon(): ReactElement {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor'
      strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z' />
      <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
      <line x1='12' y1='19' x2='12' y2='22' />
    </svg>
  )
}
