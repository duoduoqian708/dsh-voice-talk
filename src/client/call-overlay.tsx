// The call overlay: the whole voice interaction lives here. The page beneath
// stays visible through a light radial dim (you can watch the agent work) and
// fully interactive — the veil passes pointer events except to HUD controls.
//
// Visual language (finalized "微光" direction): an aurora ambience layer, a
// row of live mic-driven wave bars, frameless floating captions, a glass
// hang-up key. No panels, no state lamps.

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { VoiceStatus } from './types.ts'
import { VoiceWave } from './voice-wave.ts'
import { speakersForTheme, voiceThemeOf } from './voice-themes.ts'
import { RateMagnetSlider } from './rate-magnet.tsx'
import { nearestRateLabel } from './voice-settings.ts'

/** Selector-hook shape over the shared voice status. */
export type VoiceSelectorHook = <S>(selector: (snapshot: VoiceStatus) => S, eq?: (a: S, b: S) => boolean) => S

/** Props of the call overlay (the injected face, hooks bound). */
export interface CallOverlayProps {
  useVoice: VoiceSelectorHook
  /** Hang up = leave the voice loop (same as Esc). */
  hangUp(): void
  /** Skip the current readout. */
  stopSpeaking(): void
  /** Flip the auto-readout switch. */
  setAutoSpeak(enabled: boolean): void
  /** Session-scope rate override (HUD writes; dies with the session). */
  setRateOverride(rate: number): void
  /** Session-scope speaker override (same lifecycle as the rate override). */
  setVoiceOverride(voice: string): void
  /** Persist one settings field (settings-page writes ride the wire). */
  setField(field: string, value: unknown): void
  /** Live resolved settings (rate/voiceName read here per render). */
  settings: () => { rate: number; voiceName: string; voiceLang: string; ttsTheme: string; speakerByTheme: Record<string, string> }
}

const PHASE_WORD: Record<VoiceStatus['phase'], string> = {
  idle: '待命',
  listening: '聆听中',
  thinking: '思考中',
  speaking: '播报中',
}

interface CaptionEntry {
  kind: 'user' | 'ai'
  text: string
}

/** One frameless floating caption line. */
function Caption({ entry }: { entry: CaptionEntry }): ReactElement {
  return (
    <div className={`dsh-voice-cap dsh-voice-cap-${entry.kind}`}>
      <span className='dsh-voice-cap-dot' aria-hidden='true' />
      <span>{entry.text}</span>
    </div>
  )
}

/**
 * The full-screen voice layer, rendered only while the loop is armed.
 * The dim never captures events; only the controls do.
 */
export function CallOverlay({ useVoice, hangUp, stopSpeaking, setAutoSpeak, setRateOverride, setVoiceOverride, setField, settings }: CallOverlayProps): ReactElement | null {
  const mode = useVoice(s => s.mode)
  const active = mode === 'loop'
  const phase = useVoice(s => s.phase)
  const interim = useVoice(s => s.interim)
  const caption = useVoice(s => s.caption)
  const lastPrompt = useVoice(s => s.lastPrompt)
  const pendingCount = useVoice(s => s.pendingCount)
  const error = useVoice(s => s.error)
  const autoSpeak = useVoice(s => s.autoSpeak)

  const waveRef = useRef<HTMLDivElement | null>(null)
  const waveRef2 = useRef<VoiceWave | null>(null)
  const [history, setHistory] = useState<CaptionEntry[]>([])
  const lastPromptSeen = useRef('')
  const lastCaptionSeen = useRef('')
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(Date.now())

  const [setupMissing, setSetupMissing] = useState(false)
  const themeId = settings().ttsTheme

  // Theme setup check: a cloud theme that still needs credentials surfaces a
  // caption instead of a confusing synth error mid-round.
  useEffect(() => {
    if (!active) return
    const def = voiceThemeOf(themeId)
    if (def?.needsSetup !== true) {
      setSetupMissing(false)
      return
    }
    let alive = true
    void fetch('/voice-tts/status').then(r => r.json()).then((body: { providers?: Record<string, boolean> }) => {
      if (alive) setSetupMissing(body.providers?.[themeId] !== true)
    }).catch(() => { if (alive) setSetupMissing(false) })
    return () => { alive = false }
  }, [active, themeId])

  // Caption history: finalized prompts and readouts scroll here; the live
  // interim rides above them while listening.
  useEffect(() => {
    if (lastPrompt !== '' && lastPrompt !== lastPromptSeen.current) {
      lastPromptSeen.current = lastPrompt
      setHistory(h => [...h.slice(-5), { kind: 'user', text: lastPrompt }])
    }
  }, [lastPrompt])
  useEffect(() => {
    if (caption !== '' && caption !== lastCaptionSeen.current) {
      lastCaptionSeen.current = caption
      setHistory(h => [...h.slice(-5), { kind: 'ai', text: caption }])
    }
  }, [caption])

  // The wave engine mounts WITH the overlay DOM (the component itself mounts
  // at plugin load while the layer renders only when the loop arms): key the
  // engine's lifecycle on `active`, then ride phase changes after that.
  useEffect(() => {
    if (mode !== 'loop') return
    const container = waveRef.current
    if (container === null) return
    const wave = new VoiceWave(container)
    waveRef2.current = wave
    wave.setPhase(phase)
    if (phase === 'listening') void wave.attachMic()
    wave.start()
    return () => {
      wave.dispose()
      waveRef2.current = null
    }
    // phase intentionally omitted on mount: the phase effect below follows it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])
  useEffect(() => {
    const wave = waveRef2.current
    if (wave == null) return
    wave.setPhase(phase)
    if (phase === 'listening') void wave.attachMic()
  }, [phase])

  // Call timer, mm:ss — restarted with each armed loop.
  useEffect(() => {
    if (mode !== 'loop') return
    startedAt.current = Date.now()
    setElapsed(0)
    setHistory([])
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500)
    return () => clearInterval(id)
  }, [mode])

  if (mode !== 'loop') return null

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return createPortal(
    <div className='dsh-voice-call' data-phase={phase}>
      <div className='dsh-voice-aurora' aria-hidden='true'>
        <i className='dsh-voice-aur1' /><i className='dsh-voice-aur2' /><i className='dsh-voice-aur3' />
      </div>
      <div className='dsh-voice-grain' aria-hidden='true' />

      <div className='dsh-voice-stage'>
        <div className='dsh-voice-topline'>{mm}:{ss}</div>

        <div className='dsh-voice-center'>
          <div className='dsh-voice-wave' ref={waveRef} aria-hidden='true' />
          <div className='dsh-voice-state-word'>{PHASE_WORD[phase]}</div>
        </div>

        <div className='dsh-voice-captions' aria-live='polite'>
          {pendingCount > 0 && (
            <div className='dsh-voice-cap dsh-voice-cap-pending'>
              <span className='dsh-voice-cap-dot' aria-hidden='true' />
              <span>{pendingCount} 项待确认 — 点击下方穿透区域处理底层页面的卡片</span>
            </div>
          )}
          {error !== null && (
            <div className='dsh-voice-cap dsh-voice-cap-error'>
              <span className='dsh-voice-cap-dot' aria-hidden='true' />
              <span>{error}</span>
            </div>
          )}
          {setupMissing && (
            <div className='dsh-voice-cap dsh-voice-cap-pending'>
              <span className='dsh-voice-cap-dot' aria-hidden='true' />
              <span>该音色主题尚未配置凭证 — 到 设置 → 插件 → 语音对话 完成接入，或切回系统语音</span>
            </div>
          )}
          {phase === 'listening' && interim !== '' && (
            <div className='dsh-voice-cap dsh-voice-cap-live'>
              <span className='dsh-voice-cap-dot' aria-hidden='true' />
              <span>{interim}</span>
            </div>
          )}
          {history.map((entry, i) => (
            <Caption key={`${entry.kind}-${i}`} entry={entry} />
          ))}
        </div>

        <div className='dsh-voice-controls'>
          <button
            type='button'
            className={`dsh-voice-speak-toggle${autoSpeak ? '' : ' off'}`}
            onClick={() => setAutoSpeak(!autoSpeak)}
            title='朗读每轮回复的结论'
          >
            <span className='dsh-voice-st-dot' aria-hidden='true' />自动播报
          </button>
          <SpeakerPicker settings={settings} setVoiceOverride={setVoiceOverride} />
          <RateSlider settings={settings} setRateOverride={setRateOverride} />
          <button
            type='button'
            className='dsh-voice-hangup'
            onClick={hangUp}
            title='结束语音对话（Esc）'
            aria-label='结束语音对话'
          >
            <svg width='22' height='22' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <path d='M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.17-.42.28-.68.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.18-.29-.43-.29-.71 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.5 2.48c-.18.18-.43.29-.71.29-.26 0-.5-.11-.68-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z' />
            </svg>
          </button>
          <button
            type='button'
            className={`dsh-voice-skip${phase === 'speaking' ? '' : ' hidden'}`}
            onClick={stopSpeaking}
          >
            跳过播报
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Speaker picker: roster follows the active theme. */
function SpeakerPicker({ settings, setVoiceOverride }: { settings: () => { voiceName: string; voiceLang: string; ttsTheme: string; speakerByTheme: Record<string, string> }; setVoiceOverride(voice: string): void }): ReactElement {
  const theme = settings().ttsTheme
  const current = settings().speakerByTheme[theme]
    ?? voiceThemeOf(theme)?.defaultSpeaker
    ?? settings().voiceName
  const lang = settings().voiceLang
  const options = speakersForTheme(theme, lang)
  const labelOf = (id: string): string => {
    const hit = options.find(o => o.id === id)
    return hit !== undefined && !('more' in hit) ? hit.label : (id === '' ? '系统默认' : id)
  }
  // Grouped roster (qwen): render optgroup headers; flat rosters unchanged.
  const grouped = options.every(o => 'group' in o || 'more' in o)
    && options.some(o => 'group' in o)
  const pick = (id: string): void => {
    // Session-scope override: the HUD speaker choice holds for this session
    // only (survives hang-ups) and never touches the stored defaults.
    setVoiceOverride(id)
  }
  return (
    <label className='dsh-voice-ctl' title='说话人'>
      <select
        className='dsh-voice-ctl-select'
        value={current}
        onChange={event => { pick(event.target.value) }}
        aria-label='说话人'
      >
        {grouped
          ? [...new Set(options.filter(o => 'group' in o).map(o => (o as { group: string }).group))].map(group => (
            <optgroup key={group} label={group}>
              {options.filter(o => 'group' in o && (o as { group: string }).group === group).map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </optgroup>
          ))
          : options.map(option => (
            <option key={option.id || '__default'} value={option.id}>
              {'more' in option ? `更多 · ${option.label}` : option.label}
            </option>
          ))}
      </select>
      <span className='dsh-voice-ctl-value'>{labelOf(current)}</span>
    </label>
  )
}

/** Magnet-rate slider: five discrete stops (1.0–2.0), ticks under the track. */
function RateSlider({ settings, setRateOverride }: { settings: () => { rate: number }; setRateOverride(rate: number): void }): ReactElement {
  const rate = settings().rate
  return (
    <label className='dsh-voice-ctl dsh-voice-rate' title='语速（磁吸档位，仅本会话）'>
      <RateMagnetSlider rate={rate} onChange={setRateOverride} />
      <span className='dsh-voice-rate-value'>{nearestRateLabel(rate)}</span>
    </label>
  )
}
