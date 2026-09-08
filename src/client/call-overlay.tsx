// The call overlay: the whole voice interaction lives here. An opaque light
// canvas split in two glass tiles: the LEFT panel is the call face (hero row:
// DeepSeek whale | live waveform | hang-up key, centered; duration above;
// controls below); the RIGHT column is the session's message stream,
// collapsible for a focused call.
//
// Signature motion (v2 "Apple" direction): WHO speaks breathes — the whale
// swells during speaking, the hang-up key during listening; both driven by a
// two-layer signal (3.6s rest rhythm + heavily smoothed mic/synth amplitude)
// with a halo that opens up the edges. All motion is transform/opacity.

import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { TranscriptState, VoiceStatus } from './types.ts'
import type { ObservableSource } from './store.ts'
import { CallBreath } from './voice-wave.ts'
import { speakersForTheme, voiceThemeOf } from './voice-themes.ts'
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

/** The DeepSeek whale, inline (vector; fill follows currentColor). */
function WhaleMark({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox='0 0 23.16 17.04' fill='none' aria-hidden='true'>
      <path d='M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z' fill='currentColor' />
    </svg>
  )
}

/**
 * The call face's hero row: whale | waveform | hang-up. One CallBreath engine
 * drives both breath targets (whale while speaking, key while listening) and
 * their halos; the live mic analyser feeds it while listening.
 */
function Hero({ useVoice, hangUp, phase }: { useVoice: VoiceSelectorHook; hangUp(): void; phase: VoiceStatus['phase'] }): ReactElement {
  const breathRef = useRef<CallBreath | null>(null)
  const whaleRef = useRef<HTMLDivElement | null>(null)
  const keyRef = useRef<HTMLButtonElement | null>(null)
  const haloWhaleRef = useRef<HTMLSpanElement | null>(null)
  const haloKeyRef = useRef<HTMLSpanElement | null>(null)
  const waveRef = useRef<HTMLDivElement | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    const waveEl = waveRef.current
    const whaleEl = whaleRef.current
    const keyEl = keyRef.current
    const haloWhaleEl = haloWhaleRef.current
    const haloKeyEl = haloKeyRef.current
    if (waveEl === null || whaleEl === null || keyEl === null || haloWhaleEl === null || haloKeyEl === null) return
    const breath = new CallBreath({
      whale: whaleEl, key: keyEl, haloWhale: haloWhaleEl, haloKey: haloKeyEl,
    }, waveEl, () => phaseRef.current)
    breathRef.current = breath
    breath.start()
    return () => {
      breath.dispose()
      breathRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const breath = breathRef.current
    if (breath == null) return
    breath.setPhase(phase)
  }, [phase])

  return (
    <div className='dsh-voice-hero'>
      <div className='dsh-voice-avatar-wrap' data-phase={phase}>
        <span className='dsh-voice-halo dsh-voice-halo-blue' ref={haloWhaleRef} aria-hidden='true' />
        <div className='dsh-voice-avatar-circle' ref={whaleRef}>
          <WhaleMark className='dsh-voice-whale' />
        </div>
      </div>

      <div className='dsh-voice-wave' ref={waveRef} aria-hidden='true' />

      <div className='dsh-voice-hangup-wrap'>
        <span className='dsh-voice-halo dsh-voice-halo-red' ref={haloKeyRef} aria-hidden='true' />
        <button
          type='button'
          className='dsh-voice-hangup'
          ref={keyRef}
          onClick={hangUp}
          title='结束语音对话（Esc）'
          aria-label='结束语音对话'
        >
          <svg width='26' height='26' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
            <path d='M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.17-.42.28-.68.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.18-.29-.43-.29-.71 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.5 2.48c-.18.18-.43.29-.71.29-.26 0-.5-.11-.68-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z' />
          </svg>
        </button>
      </div>
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
export function CallOverlay({ useVoice, transcript, hangUp, stopSpeaking, setRateOverride, setVoiceOverride, setField, settings }: CallOverlayProps): ReactElement | null {
  const mode = useVoice(s => s.mode)
  const active = mode === 'loop'
  const phase = useVoice(s => s.phase)
  const interim = useVoice(s => s.interim)
  const pendingCount = useVoice(s => s.pendingCount)
  const error = useVoice(s => s.error)

  // Duration of the CURRENT call: reset on every armed loop (hang-up → reopen
  // starts from 00:00), not the session's total age.
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(Date.now())

  const [setupMissing, setSetupMissing] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const themeId = settings().ttsTheme

  // Transcript subscription: the store is change-gated, so the snapshot
  // reference only moves when content actually changed. The store's methods
  // are class members with private state — passing them detached hands React
  // a `this`-less function (the '#snapshot' crash); bind through closures and
  // memoize on the store identity so React keeps one subscription.
  const subscribe = useMemo(
    () => transcript === undefined ? subscribeNoop : (listener: () => void) => transcript.subscribe(listener),
    [transcript],
  )
  const getSnapshot = useMemo(
    () => transcript === undefined ? snapshotNoop : () => transcript.getSnapshot(),
    [transcript],
  )
  const streamState = useSyncExternalStore(subscribe, getSnapshot)
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
  const rate = settings().rate

  return createPortal(
    <div className='dsh-voice-call' data-phase={phase}>
      <aside className='dsh-voice-left'>
        <div className='dsh-voice-duration'>{mm}:{ss}</div>

        <Hero useVoice={useVoice} hangUp={hangUp} phase={phase} />

        <div className='dsh-voice-state-word'>{PHASE_WORD[phase]}</div>

        <div className='dsh-voice-live' aria-live='polite'>
          {error !== null && <div className='dsh-voice-live-error'>{error}</div>}
          {setupMissing && <div className='dsh-voice-live-warn'>该引擎尚未配置凭证 — 到设置页完成接入，或切回系统语音</div>}
          {pendingCount > 0 && <div className='dsh-voice-live-warn'>{pendingCount} 项待确认 — 点击底层页面卡片处理</div>}
          {phase === 'listening' && interim !== '' && <div className='dsh-voice-live-interim'>{interim}</div>}
          {phase !== 'listening' && (error === null && !setupMissing && pendingCount === 0) && (
            <div className='dsh-voice-live-hint'>{phase === 'thinking' ? '正在组织回复…' : phase === 'speaking' ? '正在播报' : '说话即发送'}</div>
          )}
        </div>

        <div className='dsh-voice-controls'>
          <SpeakerPicker settings={settings} setVoiceOverride={setVoiceOverride} />
          <button
            type='button'
            className='dsh-voice-ctl dsh-voice-rate'
            title={`语速（仅本会话）：${nearestRateLabel(rate)}`}
            onClick={() => {
              // Cycle the five magnet stops; writes the session override.
              const stops = [1.0, 1.2, 1.5, 1.8, 2.0]
              const next = stops[(stops.indexOf(Math.round(rate * 10) / 10) + 1) % stops.length]
                ?? stops.find(s => s > rate)!
                ?? stops[0]!
              setRateOverride(next)
            }}
          >
            <span className='dsh-voice-ctl-value'>{nearestRateLabel(rate)}</span>
          </button>
        </div>

        <div className='dsh-voice-hangup-row'>
          <button
            type='button'
            className='dsh-voice-skip'
            data-visible={phase === 'speaking'}
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
            <div className='dsh-voice-msg dsh-voice-msg-ai dsh-voice-streaming'>
              <img className='dsh-voice-msg-avatar' src={avatarUrl} alt='' draggable={false} />
              <div className='dsh-voice-msg-body'>
                <p className='dsh-voice-prose'>{streaming}<span className='dsh-voice-caret' aria-hidden='true' /></p>
              </div>
            </div>
          )}
          {phase === 'thinking' && streaming === '' && (
            <div className='dsh-voice-msg dsh-voice-msg-ai dsh-voice-typing-row'>
              <img className='dsh-voice-msg-avatar' src={avatarUrl} alt='' draggable={false} />
              <div className='dsh-voice-typing' aria-label='正在生成'><i /><i /><i /></div>
            </div>
          )}
        </div>
        <button
          type='button'
          className='dsh-voice-collapse'
          title={collapsed ? '展开信息流' : '收起信息流'}
          aria-label='收起或展开信息流'
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(c => !c)}
        >
          <i />
        </button>
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
