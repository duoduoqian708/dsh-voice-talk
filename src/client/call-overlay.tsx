// The call overlay: the whole voice interaction lives here. An opaque light
// canvas split in two glass tiles: the LEFT panel is the call face (hero row:
// DeepSeek whale | live waveform | mute key, centered; duration above;
// controls — speaker / rate / hang-up — below); the RIGHT column is the
// session's message stream, a structural mirror of the native stream (prose,
// collapsible reasoning, tool cards) with a karaoke marker over the parts
// the readout has actually played, collapsible for a focused call.
//
// Signature motion (v2 "Apple" direction): WHO speaks breathes — the whale
// swells during speaking, the mute key during listening; both driven by a
// two-layer signal (3.6s rest rhythm + heavily smoothed mic/synth amplitude).
// All motion is transform/opacity.

import { createPortal } from 'react-dom'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { QuestionAnswerView, QuestionItemView, TranscriptSegment, TranscriptState, VoiceStatus } from './types.ts'
import type { ObservableSource } from './store.ts'
import { QUESTION_CANCELLED, QUESTION_UNANSWERED, type VoiceKey, type VoiceTranslate } from './locales.ts'
import { CallBreath } from './voice-wave.ts'
import { WavePrint } from './wave-print.ts'
import { speakersForTheme, voiceThemeOf } from './voice-themes.ts'
import { RateMagnetSlider } from './rate-magnet.tsx'
import { rawPrefixForCleaned } from './readout.ts'
import { Markdown, type MarkRange } from './markdown.tsx'
import { VoicePicker } from './voice-picker.tsx'
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
  /** Live resolved settings (rate/voiceName read here per render). */
  settings: () => { rate: number; voiceName: string; voiceLang: string; ttsTheme: string; speakerByTheme: Record<string, string>; waveStyle: string; asrTheme: string }
  /** Namespace-bound translator (the framework locale seat). */
  t: VoiceTranslate
}

/** Dictionary keys of the phase words (translated per render). */
const PHASE_KEY: Record<VoiceStatus['phase'], VoiceKey> = {
  idle: 'phase.idle',
  listening: 'phase.listening',
  thinking: 'phase.thinking',
  speaking: 'phase.speaking',
}

/** Utterance cap (mirrors the controller): the window forced out at this age. */
const UTTERANCE_CAP_MS = 60_000
/** Countdown becomes visible in the final stretch of the cap window. */
const COUNTDOWN_VISIBLE_MS = 10_000
/** Render window of the stream: only the newest slice of the transcript is
 *  mounted; older messages prepend on scroll-to-top and the window trims
 *  back to the tail while pinned to the bottom. Keeps the DOM bounded no
 *  matter how long the session grows. */
const STREAM_PAGE = 20
const STREAM_TRIM_AT = 80
const STREAM_KEEP = 40

/**
 * The 60s utterance-cap ring: a stroke circle around the mic key that erodes
 * clockwise from 12 o'clock while the utterance runs; gone = force submit.
 * (Negative dashoffset sweeps the erasing edge clockwise; a positive one
 * would run it counterclockwise — the path itself starts at 12 via rotate.)
 */
function MicRing({ startAt }: { startAt: number | null }): ReactElement | null {
  const ringRef = useRef<SVGCircleElement | null>(null)
  useEffect(() => {
    if (startAt === null) return
    const circumference = 2 * Math.PI * 36
    let raf = 0
    const frame = (): void => {
      raf = requestAnimationFrame(frame)
      const progress = Math.min(1, Math.max(0, (Date.now() - startAt) / UTTERANCE_CAP_MS))
      if (ringRef.current !== null) ringRef.current.style.strokeDashoffset = String(-progress * circumference)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [startAt])
  if (startAt === null) return null
  const circumference = 2 * Math.PI * 36
  return (
    <svg className='dsh-voice-mic-ring' viewBox='0 0 80 80' aria-hidden='true'>
      <circle ref={ringRef} cx='40' cy='40' r='36' strokeDasharray={circumference} strokeDashoffset={0}
        transform='rotate(-90 40 40)' />
    </svg>
  )
}

/** The cap's last ten seconds: one number popping each second, then silence. */
function ListenCountdown({ startAt, visible, t }: { startAt: number | null; visible: boolean; t: VoiceTranslate }): ReactElement | null {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (startAt === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [startAt])
  if (startAt === null || !visible) return null
  const remaining = Math.max(0, UTTERANCE_CAP_MS - (now - startAt))
  if (remaining > COUNTDOWN_VISIBLE_MS) return null
  const sec = Math.max(1, Math.ceil(remaining / 1000))
  return (
    <div className='dsh-voice-countdown' role='timer' aria-label={t('countdown.aria')}>
      <span key={sec} className='dsh-voice-countdown-num'>{sec}</span>
    </div>
  )
}

/** No-op store fallbacks for overlays mounted without a transcript source. */
const subscribeNoop = (): (() => void) => () => { }
const snapshotNoop = (): TranscriptState => ({ messages: [], streaming: [], pending: 0, runningTools: [] })

/** The DeepSeek whale, inline (vector; fill follows currentColor). */
function WhaleMark({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox='0 0 23.16 17.04' fill='none' aria-hidden='true'>
      <path d='M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.2775 7.89187 13.0545 7.70787C12.8735 7.55786 12.6435 7.51636 12.39 7.51636C12.2955 7.51636 12.2095 7.47486 12.1445 7.44136C12.0395 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.2925 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.2775 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z' fill='currentColor' />
    </svg>
  )
}

/** Mic shape (on). */
function MicGlyph({ off }: { off?: boolean }): ReactElement {
  return (
    <svg width='34' height='34' viewBox='0 0 24 24' fill='none' stroke='currentColor'
      strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z' />
      <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
      <line x1='12' y1='19' x2='12' y2='22' />
      {off === true && <line x1='4' y1='3' x2='21' y2='21' />}
    </svg>
  )
}

/** Phone shape for the hang-up cell. */
function PhoneGlyph(): ReactElement {
  return (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
      <path d='M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.17-.42.28-.68.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.18-.29-.43-.29-.71 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.5 2.48c-.18.18-.43.29-.71.29-.26 0-.5-.11-.68-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z' />
    </svg>
  )
}

/**
 * The call face's hero row: whale | waveform | mute key. One CallBreath
 * engine drives both breath targets (whale while speaking, key while
 * listening); the live mic analyser feeds it while listening.
 * The wave slot itself is owned by the settings' voice-print: a lottie
 * preset ('equalizer' | 'wave') or the legacy mic-reactive bars fallback.
 */
function Hero({ useVoice, toggleMute, phase, muted, waveStyle, utteranceStartAt, t }: { useVoice: VoiceSelectorHook; toggleMute(): void; phase: VoiceStatus['phase']; muted: boolean; waveStyle: string; utteranceStartAt: number | null; t: VoiceTranslate }): ReactElement {
  const breathRef = useRef<CallBreath | null>(null)
  const printRef = useRef<WavePrint | null>(null)
  const whaleRef = useRef<HTMLDivElement | null>(null)
  const keyRef = useRef<HTMLButtonElement | null>(null)
  const waveRef = useRef<HTMLDivElement | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    const waveEl = waveRef.current
    const whaleEl = whaleRef.current
    const keyEl = keyRef.current
    if (waveEl === null || whaleEl === null || keyEl === null) return
    // Known presets hand the slot to lottie; anything else keeps the legacy
    // mic-reactive bars (defensive fallback for a hand-edited config).
    const withBars = waveStyle !== 'equalizer' && waveStyle !== 'wave'
    const breath = new CallBreath({
      whale: whaleEl, key: keyEl,
    }, waveEl, () => phaseRef.current, withBars)
    breathRef.current = breath
    breath.start()
    const print = withBars ? null : new WavePrint(waveEl, waveStyle, () => phaseRef.current)
    printRef.current = print
    // The breath's per-frame mic level drives the print's amplitude: silent
    // or muted capture collapses the wave into its flat idle line.
    breath.setLevelSink(print === null ? null : level => print.setLevel(level))
    return () => {
      print?.dispose()
      printRef.current = null
      breath.dispose()
      breathRef.current = null
    }
    // Re-run on waveStyle so a settings change swaps the print live mid-call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveStyle])
  useEffect(() => {
    breathRef.current?.setPhase(phase)
    printRef.current?.setPhase(phase)
  }, [phase])
  useEffect(() => {
    breathRef.current?.setMuted(muted)
  }, [muted])

  return (
    <div className='dsh-voice-hero'>
      <div className='dsh-voice-avatar-wrap' data-phase={phase}>
        <div className='dsh-voice-avatar-circle' ref={whaleRef}>
          <WhaleMark className='dsh-voice-whale' />
        </div>
      </div>

      <div className='dsh-voice-wave' ref={waveRef} aria-hidden='true' />

      <div className='dsh-voice-mic-wrap'>
        <MicRing startAt={phase === 'listening' && !muted ? utteranceStartAt : null} />
        <button
          type='button'
          className='dsh-voice-mickey'
          data-muted={muted}
          ref={keyRef}
          onClick={toggleMute}
          title={muted ? t('hero.unmuteTitle') : t('hero.muteTitle')}
          aria-label={t('hero.muteAria')}
          aria-pressed={muted}
        >
          <MicGlyph off={muted} />
        </button>
      </div>
    </div>
  )
}

/** Collapsible reasoning block (the native stream's "thinking" section). */
const ReasoningSection = memo(function ReasoningSection({ text, t }: { text: string; t: VoiceTranslate }): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className='dsh-voice-reasoning' data-open={open}>
      <button type='button' className='dsh-voice-reasoning-head' onClick={() => setOpen(o => !o)}>
        <i aria-hidden='true' />
        {t('reasoning.done')}
        <span className='dsh-voice-reasoning-toggle'>{open ? t('common.collapse') : t('common.expand')}</span>
      </button>
      {open && <p className='dsh-voice-reasoning-body'>{text}</p>}
    </div>
  )
})

/** One tool card: call head (+args, expandable) or its settled result. */
const ToolCard = memo(function ToolCard({ name, args, ok, text, running, t }: {
  name: string
  args?: string
  ok?: boolean
  text?: string
  running?: boolean
  t: VoiceTranslate
}): ReactElement {
  const [open, setOpen] = useState(false)
  const argsPreview = (args ?? '').split('\n')[0]?.slice(0, 90) ?? ''
  const detail = (args ?? text ?? '')
  return (
    <div className='dsh-voice-tool' data-ok={ok} data-running={running === true}>
      <button type='button' className='dsh-voice-tool-head' onClick={() => setOpen(o => !o)}>
        <span className='dsh-voice-tool-status' aria-hidden='true'>
          {running === true ? '◌' : ok === undefined ? '▸' : ok ? '✓' : '✗'}
        </span>
        <span className='dsh-voice-tool-name'>{name}</span>
        {argsPreview !== '' && <code className='dsh-voice-tool-args'>{argsPreview}</code>}
        {detail !== '' && <span className='dsh-voice-tool-toggle'>{open ? t('common.collapse') : t('common.expand')}</span>}
      </button>
      {open && detail !== '' && <pre className='dsh-voice-tool-body'>{detail}</pre>}
    </div>
  )
})

/**
 * The live transcript card: a fixed, pre-reserved display area below the hero
 * that only lights up while recognizable text is streaming. Its space stays
 * even when empty (the hero and controls never shift); long dictations
 * scroll, with the newest line followed until the user scrolls up.
 */
const LiveTranscript = memo(function LiveTranscript({ text }: { text: string }): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const followRef = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el !== null && followRef.current) el.scrollTop = el.scrollHeight
  }, [text])
  const onScroll = (): void => {
    const el = ref.current
    if (el === null) return
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  }
  return (
    <div className='dsh-voice-transcript' data-visible={text !== ''}>
      <div className='dsh-voice-transcript-scroll' ref={ref} onScroll={onScroll}>{text}</div>
    </div>
  )
})

/**
 * One question interaction (the questions-protocol card: ask_user_question
 * and anything else that speaks the same args/result shape). Display-only —
 * the voice loop answers; the card mirrors the ask, then the chosen labels.
 * Unsettled asks read as pending; an unparsable/error result reads as a note.
 */
const QuestionCard = memo(function QuestionCard({ questions, answers, error, t }: {
  questions: readonly QuestionItemView[]
  answers: readonly QuestionAnswerView[] | null
  error: string
  t: VoiceTranslate
}): ReactElement {
  const errorLabel = error === QUESTION_CANCELLED
    ? t('question.cancelled')
    : error === QUESTION_UNANSWERED ? t('question.unanswered') : error
  return (
    <div className='dsh-voice-question' data-settled={answers !== null || error !== ''}>
      <div className='dsh-voice-question-head'>
        <span className='dsh-voice-question-badge'>{t('question.badge')}</span>
        {answers === null && error === '' && <span className='dsh-voice-question-wait'>{t('question.waiting')}</span>}
        {error !== '' && <span className='dsh-voice-question-error'>{errorLabel}</span>}
      </div>
      {questions.map((question, qi) => {
        const answer = answers?.find(item => item.id === question.id)
        const chosen = answer?.selected ?? []
        return (
          <div className='dsh-voice-question-item' key={`${qi}:${question.id}`}>
            {question.header !== '' && <div className='dsh-voice-question-header'>{question.header}</div>}
            <div className='dsh-voice-question-text'>{question.question}</div>
            {question.detail !== '' && <div className='dsh-voice-question-detail'>{question.detail}</div>}
            {question.options.length > 0
              ? (
                <ul className='dsh-voice-question-options'>
                  {question.options.map(option => {
                    const picked = chosen.includes(option.label)
                    return (
                      <li className='dsh-voice-question-option' data-picked={picked} key={option.label}>
                        <span className='dsh-voice-question-mark' aria-hidden='true'>{picked ? '✓' : '○'}</span>
                        <span className='dsh-voice-question-label'>{option.label}</span>
                        {option.description !== '' && <span className='dsh-voice-question-desc'>{option.description}</span>}
                      </li>
                    )
                  })}
                </ul>
              )
              : <div className='dsh-voice-question-free'>{question.multiSelect ? t('question.multi') : t('question.free')}</div>}
            {answer !== undefined && (
              <div className='dsh-voice-question-picked'>
                {chosen.length > 0 && t('question.selected', { list: chosen.join(t('question.listSep')) })}
                {chosen.length > 0 && answer.custom !== '' && t('question.sep')}
                {answer.custom !== '' && t('question.typed', { text: answer.custom })}
                {chosen.length === 0 && answer.custom === '' && t('question.skipped')}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})

/** Segments of one assistant message (or the live streaming bubble).
 *  Text segments render through the markdown engine; the karaoke range is
 *  raw offsets into the message's JOINED prose (text segments joined with
 *  '\n\n' — same space `proseOf` builds and the readout counts against), so
 *  it is translated per segment here. */
function SegmentList({ segments, mark, t }: { segments: readonly TranscriptSegment[]; mark: MarkRange | null; t: VoiceTranslate }): ReactElement {
  // Raw position of the NEXT text segment within the joined prose.
  let acc = 0
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'reasoning') return <ReasoningSection key={i} text={segment.text} t={t} />
        if (segment.kind === 'question') return <QuestionCard key={i} questions={segment.questions} answers={segment.answers} error={segment.error} t={t} />
        if (segment.kind === 'tool-call') return <ToolCard key={i} name={segment.name} args={segment.args} t={t} />
        if (segment.kind === 'tool-result') return <ToolCard key={i} name={segment.name} ok={segment.ok} text={segment.text} t={t} />
        const start = acc
        acc += segment.text.length + 2 // '\n\n' separator consumed by proseOf
        const length = segment.text.length
        const from = mark === null ? 0 : Math.max(0, Math.min(mark.from - start, length))
        const to = mark === null ? 0 : Math.max(0, Math.min(mark.to - start, length))
        return <Markdown key={i} text={segment.text} mark={mark === null || to <= from ? null : { from, to }} />
      })}
    </>
  )
}

/**
 * One stream message: user bubble right, assistant prose left. Memoized —
 * the transcript store reuses message objects while unchanged, so a
 * streaming tick re-renders only the live bubble, not the whole history.
 */
const StreamMessage = memo(function StreamMessage({ role, text, segments, mark, t }: {
  role: 'user' | 'assistant'
  text: string
  segments: readonly TranscriptSegment[]
  mark: MarkRange | null
  t: VoiceTranslate
}): ReactElement {
  if (role === 'user') {
    return (
      <div className='dsh-voice-msg dsh-voice-msg-user'>
        <div className='dsh-voice-bubble'>{text}</div>
      </div>
    )
  }
  return (
    <div className='dsh-voice-msg dsh-voice-msg-ai'>
      <img className='dsh-voice-msg-avatar' src={avatarUrl} alt='' draggable={false} />
      <div className='dsh-voice-msg-body'>
        {segments.length === 0
          ? <span className='dsh-voice-msg-empty'>…</span>
          : <SegmentList segments={segments} mark={mark} t={t} />}
      </div>
    </div>
  )
})

/**
 * The full-screen call stage, rendered only while the loop is armed.
 */
export function CallOverlay({ useVoice, transcript, hangUp, toggleMute, stopSpeaking, setRateOverride, setVoiceOverride, setField, settings, t }: CallOverlayProps): ReactElement | null {
  const mode = useVoice(s => s.mode)
  const active = mode === 'loop'
  const phase = useVoice(s => s.phase)
  const interim = useVoice(s => s.interim)
  const pendingCount = useVoice(s => s.pendingCount)
  const error = useVoice(s => s.error)
  const micMuted = useVoice(s => s.micMuted)
  const spokenTurn = useVoice(s => s.spokenTurn)
  const spokenChars = useVoice(s => s.spokenChars)
  const spokenFrom = useVoice(s => s.spokenFrom)
  // Hooks stay above the `mode !== 'loop'` early return — a conditional hook
  // crashes the overlay on the loop-on render (mic click looked dead).
  const utteranceStartAt = useVoice(s => s.utteranceStartAt)

  // Duration of the CURRENT call: reset on every armed loop (hang-up → reopen
  // starts from 00:00), not the session's total age. Accrues only while the
  // call runs: muting banks the live segment and freezes the display.
  const [elapsed, setElapsed] = useState(0)
  const bankedMs = useRef(0)
  const runningSince = useRef<number | null>(null)

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
  const runningTools = streamState.runningTools

  // Karaoke range: raw offsets into the turn being read out. The text pieces
  // the readout has handed to the engine are cleaned-character slices; map
  // both ends (clause start / clause end) back onto the rendered raw text.
  const markOf = (turn: number): MarkRange | null => {
    if (spokenTurn === null || spokenTurn !== turn) return null
    const raw = messages.find(m => m.turn === turn && m.role === 'assistant')?.text ?? ''
    return { from: rawPrefixForCleaned(raw, spokenFrom), to: rawPrefixForCleaned(raw, spokenChars) }
  }

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
    bankedMs.current = 0
    runningSince.current = Date.now()
    setElapsed(0)
    const id = setInterval(() => {
      const since = runningSince.current
      const ms = bankedMs.current + (since === null ? 0 : Date.now() - since)
      setElapsed(Math.floor(ms / 1000))
    }, 500)
    return () => clearInterval(id)
  }, [mode])

  // Mute = pause: bank the running segment; unmuting starts a fresh one.
  useEffect(() => {
    if (mode !== 'loop') return
    if (micMuted) {
      const since = runningSince.current
      if (since !== null) {
        bankedMs.current += Date.now() - since
        runningSince.current = null
      }
    } else if (runningSince.current === null) {
      runningSince.current = Date.now()
    }
  }, [micMuted, mode])

  // Stream follow + render window. Entry pins to the newest message; follow
  // is direction-based (only a real upward scroll leaves the tail, so content
  // growth and programmatic snaps never break it); the render window keeps at
  // most a slice of the transcript mounted.
  const streamRef = useRef<HTMLDivElement | null>(null)
  const followRef = useRef(true)
  const [following, setFollowing] = useState(true)
  const [windowStart, setWindowStart] = useState<number | null>(null)
  const lastTopRef = useRef(0)
  const anchorRef = useRef<{ top: number; height: number } | null>(null)
  const start = Math.min(
    windowStart ?? Math.max(0, messages.length - STREAM_PAGE),
    Math.max(0, messages.length - 1),
  )
  const visible = messages.slice(start)

  // Entry (every armed loop): follow on, window back to the tail, pinned.
  useLayoutEffect(() => {
    if (mode !== 'loop') return
    followRef.current = true
    setFollowing(true)
    lastTopRef.current = 0
    anchorRef.current = null
    setWindowStart(null)
    const el = streamRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [mode])

  // Follow the tail while pinned; trim the window once the mounted list
  // outgrows the cap (invisible while the viewport sits at the bottom).
  useLayoutEffect(() => {
    const el = streamRef.current
    if (el === null || !followRef.current) return
    el.scrollTop = el.scrollHeight
    if (messages.length - start > STREAM_TRIM_AT) {
      anchorRef.current = null
      setWindowStart(messages.length - STREAM_KEEP)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, streaming])

  // Prepend anchoring: after older messages land, hold the viewport still.
  useLayoutEffect(() => {
    const el = streamRef.current
    const anchor = anchorRef.current
    if (el === null || anchor === null) return
    anchorRef.current = null
    el.scrollTop = anchor.top + (el.scrollHeight - anchor.height)
  }, [start])

  const onStreamScroll = (): void => {
    const el = streamRef.current
    if (el === null) return
    const top = el.scrollTop
    const gap = el.scrollHeight - top - el.clientHeight
    if (top < lastTopRef.current - 2) followRef.current = false
    if (gap < 48) followRef.current = true
    lastTopRef.current = top
    setFollowing(followRef.current)
    if (top < 60 && start > 0) {
      anchorRef.current = { top, height: el.scrollHeight }
      setWindowStart(Math.max(0, start - STREAM_PAGE))
    }
  }

  const jumpToLatest = (): void => {
    const el = streamRef.current
    if (el === null) return
    followRef.current = true
    setFollowing(true)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  if (mode !== 'loop') return null

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const rate = settings().rate
  const waveStyle = settings().waveStyle
  const mutedIdle = phase === 'listening' && micMuted

  return createPortal(
    <div className={`dsh-voice-call${collapsed ? ' is-collapsed' : ''}`} data-phase={phase}>
      <aside className='dsh-voice-left'>
        <div className='dsh-voice-duration'>{mm}:{ss}</div>
        <ListenCountdown startAt={phase === 'listening' && !micMuted ? utteranceStartAt : null} visible={phase === 'listening' && !micMuted} t={t} />

        <Hero useVoice={useVoice} toggleMute={toggleMute} phase={phase} muted={micMuted} waveStyle={waveStyle} utteranceStartAt={utteranceStartAt} t={t} />

        <div className='dsh-voice-state-word' style={mutedIdle ? { visibility: 'hidden' } : undefined} aria-hidden={mutedIdle || undefined}>
          <span>{t(PHASE_KEY[phase])}</span>
          <button
            type='button'
            className='dsh-voice-skip'
            data-visible={phase === 'speaking'}
            onClick={stopSpeaking}
          >
            {t('hud.skip')}
          </button>
        </div>

        <div className='dsh-voice-live' aria-live='polite'>
          {error !== null && <div className='dsh-voice-live-error'>{error}</div>}
          {setupMissing && <div className='dsh-voice-live-warn'>{t('hud.setupMissing')}</div>}
          {pendingCount > 0 && <div className='dsh-voice-live-warn'>{t('hud.pending', { count: pendingCount })}</div>}
        </div>

        <LiveTranscript text={phase === 'listening' && !micMuted ? interim : ''} />

        <div className='dsh-voice-controls'>
          <SpeakerPicker settings={settings} setVoiceOverride={setVoiceOverride} phase={phase} t={t} />
          <div className='dsh-voice-rate-control' title={t('hud.rateTitle')}>
            <RateMagnetSlider rate={rate} onChange={setRateOverride} t={t} />
          </div>
          <button
            type='button'
            className='dsh-voice-hangup-ctl'
            onClick={hangUp}
            title={t('hud.hangupTitle')}
            aria-label={t('hud.hangupAria')}
          >
            <PhoneGlyph />
          </button>
        </div>

        {/* Collapse handle rides the left tile's right edge — the divider
            line itself — so the flex transition carries it along the fold. */}
        <button
          type='button'
          className='dsh-voice-collapse'
          title={collapsed ? t('hud.expandStream') : t('hud.collapseStream')}
          aria-label={t('hud.toggleStreamAria')}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(c => !c)}
        >
          <i />
        </button>
      </aside>

      <section className='dsh-voice-right' aria-label={t('hud.streamAria')}>
        <div className='dsh-voice-stream' ref={streamRef} onScroll={onStreamScroll}>
          {visible.map(m => (
            <StreamMessage
              key={m.seq}
              role={m.role}
              text={m.text}
              segments={m.segments}
              mark={m.role === 'assistant' ? markOf(m.turn) : null}
              t={t}
            />
          ))}
          {/* Live partial shows whenever it streams — a multi-step turn keeps
              generating after the first step, even while earlier audio plays. */}
          {streaming.length > 0 && (
            <div className='dsh-voice-msg dsh-voice-msg-ai dsh-voice-streaming'>
              <img className='dsh-voice-msg-avatar' src={avatarUrl} alt='' draggable={false} />
              <div className='dsh-voice-msg-body'>
                {streaming.map((segment, i) => {
                  if (segment.kind === 'reasoning') return <ReasoningSection key={i} text={segment.text} t={t} />
                  if (segment.kind === 'question') return <QuestionCard key={i} questions={segment.questions} answers={segment.answers} error={segment.error} t={t} />
                  if (segment.kind === 'tool-call') return <ToolCard key={i} name={segment.name} args={segment.args} running t={t} />
                  if (segment.kind === 'tool-result') return <ToolCard key={i} name={segment.name} ok={segment.ok} text={segment.text} t={t} />
                  // The caret rides the last live text run (streaming markdown
                  // is never fully formed mid-generation; render it raw).
                  const last = i === streaming.length - 1
                  return (
                    <p key={i} className='dsh-voice-prose'>
                      {segment.text}{last && <span className='dsh-voice-caret' aria-hidden='true' />}
                    </p>
                  )
                })}
              </div>
            </div>
          )}
          {phase === 'thinking' && streaming.length === 0 && (
            <div className='dsh-voice-msg dsh-voice-msg-ai dsh-voice-typing-row'>
              <img className='dsh-voice-msg-avatar' src={avatarUrl} alt='' draggable={false} />
              <div className='dsh-voice-typing' aria-label={t('hud.typingAria')}>
                <i /><i /><i />
                {runningTools.length > 0 && (
                  <span className='dsh-voice-typing-label'>{t('hud.callingTools', { tools: runningTools.join(' · ') })}</span>
                )}
              </div>
            </div>
          )}
          {phase === 'thinking' && runningTools.length > 0 && (
            <div className='dsh-voice-msg dsh-voice-msg-ai dsh-voice-running-row'>
              <img className='dsh-voice-msg-avatar' src={avatarUrl} alt='' draggable={false} />
              <div className='dsh-voice-msg-body'>
                {runningTools.map(name => <ToolCard key={name} name={name} running t={t} />)}
              </div>
            </div>
          )}
        </div>
        {!following && (
          <button
            type='button'
            className='dsh-voice-jump'
            onClick={jumpToLatest}
            title={t('hud.jumpTitle')}
            aria-label={t('hud.jumpAria')}
          >
            <i />
          </button>
        )}
      </section>
    </div>,
    document.body,
  )
}

/**
 * Speaker picker: roster follows the active theme. Locked while the loop is
 * working (thinking/speaking): the TTS session is created at submit time with
 * the voice baked in, so a mid-round switch could only apply NEXT round —
 * the lock keeps the control honest with that (switchable = takes effect).
 * The dropdown itself is the shared VoicePicker (same component the settings
 * provider modal uses).
 */
function SpeakerPicker({ settings, setVoiceOverride, phase, t }: { settings: () => { voiceName: string; voiceLang: string; ttsTheme: string; speakerByTheme: Record<string, string> }; setVoiceOverride(voice: string): void; phase: VoiceStatus['phase']; t: VoiceTranslate }): ReactElement {
  const theme = settings().ttsTheme
  // A stored '' (the retired 主题默认 option) reads as the theme default.
  const storedSpeaker = settings().speakerByTheme[theme]
  const current = (storedSpeaker === undefined || storedSpeaker === '')
    ? (voiceThemeOf(theme)?.defaultSpeaker ?? settings().voiceName)
    : storedSpeaker
  return (
    <VoicePicker
      options={speakersForTheme(theme, settings().voiceLang)}
      value={current}
      defaultId={voiceThemeOf(theme)?.defaultSpeaker ?? ''}
      locked={phase === 'thinking' || phase === 'speaking'}
      lockHint={t('picker.lockHint')}
      t={t}
      ariaLabel={t('picker.speakerAria')}
      onChange={setVoiceOverride}
    />
  )
}
