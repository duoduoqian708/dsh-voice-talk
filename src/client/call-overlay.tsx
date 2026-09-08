// The call overlay: the whole voice interaction lives here. An opaque
// deep-sea stage split in two: the LEFT panel is the call face (DeepSeek
// avatar with live mic-driven ripples, phase word, live transcript line,
// controls); the RIGHT column is the session's message stream rendered from
// the same conversation snapshot the host page reads.
//
// Per-frame motion is transform/opacity only; backdrop-filter sits on small,
// static-backdrop surfaces only, so the glass never costs a repaint storm.

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { TranscriptState, VoiceStatus } from './types.ts'
import type { ObservableSource } from './store.ts'
import { VoiceRipple } from './voice-wave.ts'
import { speakersForTheme, voiceThemeOf } from './voice-themes.ts'
import { RateMagnetSlider } from './rate-magnet.tsx'
import { nearestRateLabel } from './voice-settings.ts'
import avatarUrl from './assets/avatar.png'

/** Selector-hook shape over the shared voice status. */
export type VoiceSelectorHook = <S>(selector: (snapshot: VoiceStatus) => S, eq?: (a: S, b: S) => boolean) => S

/** Props of the call overlay (the injected face, hooks bound). */
export interface CallOverlayProps {
  useVoice: VoiceSelectorHook
  /** The session transcript source (same snapshot the host stream reads). */
  transcript?: ObservableSource<TranscriptState>
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

/** No-op store fallbacks for overlays mounted without a transcript source. */
const subscribeNoop = (): (() => void) => () => { }
const snapshotNoop = (): TranscriptState => ({ messages: [], streaming: '', pending: 0 })

/** Extract the fenced-code parts of a message for the stream's code styling. */
function splitCode(text: string): { kind: 'text' | 'code'; body: string }[] {
  const parts: { kind: 'text' | 'code'; body: string }[] = []
  const re = /```(\w*)\n?([\s\S]*?)(?:```|$)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push({ kind: 'text', body: text.slice(last, m.index) })
    parts.push({ kind: 'code', body: m[2] ?? '' })
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', body: text.slice(last) })
  return parts.filter(p => p.body !== '')
}

/** The DeepSeek avatar with the live ripple rings around it. */
function Avatar({ useVoice }: { useVoice: VoiceSelectorHook }): ReactElement {
  const phase = useVoice(s => s.phase)
  const rippleRef = useRef<HTMLDivElement | null>(null)
  const rippleRef2 = useRef<VoiceRipple | null>(null)

  useEffect(() => {
    const container = rippleRef.current
    if (container === null) return
    const ripple = new VoiceRipple(container)
    rippleRef2.current = ripple
    ripple.setPhase(phase)
    if (phase === 'listening') void ripple.attachMic()
    ripple.start()
    return () => {
      ripple.dispose()
      rippleRef2.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const ripple = rippleRef2.current
    if (ripple == null) return
    ripple.setPhase(phase)
    if (phase === 'listening') void ripple.attachMic()
  }, [phase])

  return (
    <div className='dsh-voice-avatar-wrap' data-phase={phase}>
      <div className='dsh-voice-ripples' ref={rippleRef} aria-hidden='true' />
      <img className='dsh-voice-avatar' src={avatarUrl} alt='DeepSeek' draggable={false} />
    </div>
  )
}

/** One stream message: user bubble right, assistant prose left. */
function StreamMessage({ role, text }: { role: 'user' | 'assistant'; text: string }): ReactElement {
  if (role === 'user') {
    return (
      <div className='dsh-voice-msg dsh-voice-msg-user'>
        <div className='dsh-voice-bubble'>{text}</div>
      </div>
    )
  }
  const parts = splitCode(text)
  return (
    <div className='dsh-voice-msg dsh-voice-msg-ai'>
      <img className='dsh-voice-msg-avatar' src={avatarUrl} alt='' draggable={false} />
      <div className='dsh-voice-msg-body'>
        {parts.length === 0
          ? <span className='dsh-voice-msg-empty'>…</span>
          : parts.map((part, i) => part.kind === 'code'
            ? <pre key={i} className='dsh-voice-code'><code>{part.body}</code></pre>
            : <p key={i} className='dsh-voice-prose'>{part.body}</p>)}
      </div>
    </div>
  )
}

/**
 * The full-screen call stage, rendered only while the loop is armed.
 */
export function CallOverlay({ useVoice, transcript, hangUp, stopSpeaking, setAutoSpeak, setRateOverride, setVoiceOverride, setField, settings }: CallOverlayProps): ReactElement | null {
  const mode = useVoice(s => s.mode)
  const active = mode === 'loop'
  const phase = useVoice(s => s.phase)
  const interim = useVoice(s => s.interim)
  const pendingCount = useVoice(s => s.pendingCount)
  const error = useVoice(s => s.error)
  const autoSpeak = useVoice(s => s.autoSpeak)

  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(Date.now())

  const [setupMissing, setSetupMissing] = useState(false)
  const themeId = settings().ttsTheme

  // Transcript subscription: the store is change-gated, so the snapshot
  // reference only moves when content actually changed.
  const streamState = useSyncExternalStore(
    transcript?.subscribe ?? subscribeNoop,
    transcript?.getSnapshot ?? snapshotNoop,
  )
  const messages = streamState.messages
  const streaming = streamState.streaming

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

  // Call timer, mm:ss — restarted with each armed loop.
  useEffect(() => {
    if (mode !== 'loop') return
    startedAt.current = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500)
    return () => clearInterval(id)
  }, [mode])

  // Stream auto-scroll: follow the tail unless the user scrolled up.
  const streamRef = useRef<HTMLDivElement | null>(null)
  const followRef = useRef(true)
  useEffect(() => {
    const el = streamRef.current
    if (el === null || !followRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, streaming])
  const onStreamScroll = (): void => {
    const el = streamRef.current
    if (el === null) return
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  if (mode !== 'loop') return null

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return createPortal(
    <div className='dsh-voice-call' data-phase={phase}>
      <aside className='dsh-voice-left'>
        <div className='dsh-voice-topline'>{mm}:{ss}</div>
        <Avatar useVoice={useVoice} />
        <div className='dsh-voice-state-word'>{PHASE_WORD[phase]}</div>

        <div className='dsh-voice-live' aria-live='polite'>
          {error !== null && <div className='dsh-voice-live-error'>{error}</div>}
          {setupMissing && <div className='dsh-voice-live-warn'>该引擎尚未配置凭证 — 到设置页完成接入，或切回系统语音</div>}
          {pendingCount > 0 && <div className='dsh-voice-live-warn'>{pendingCount} 项待确认 — 点击底层页面卡片处理</div>}
          {phase === 'listening' && interim !== '' && <div className='dsh-voice-live-interim'>{interim}</div>}
          {phase !== 'listening' && (error === null && !setupMissing && pendingCount === 0) && (
            <div className='dsh-voice-live-hint'>{phase === 'thinking' ? '正在组织回复…' : phase === 'speaking' ? '正在播报，可随时打断' : '说话即发送'}</div>
          )}
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
      </aside>

      <section className='dsh-voice-right' aria-label='会话内容'>
        <div className='dsh-voice-stream' ref={streamRef} onScroll={onStreamScroll}>
          {messages.map(m => <StreamMessage key={m.seq} role={m.role} text={m.text} />)}
          {streaming !== '' && phase === 'thinking' && (
            <div className='dsh-voice-msg dsh-voice-msg-ai'>
              <img className='dsh-voice-msg-avatar' src={avatarUrl} alt='' draggable={false} />
              <div className='dsh-voice-msg-body'>
                <p className='dsh-voice-prose dsh-voice-typing'>{streaming}<span className='dsh-voice-caret' aria-hidden='true' /></p>
              </div>
            </div>
          )}
        </div>
      </section>
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
