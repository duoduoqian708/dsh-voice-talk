// The voice settings card: one card in the web settings page's plugin
// configuration tab, keyed by the `voice` namespace. It draws its own chrome
// (the section's card model is not importable across plugins) and writes
// field-by-field through the settings scope, revision-fenced by the wire.

import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { VoiceSettings } from './voice-settings.ts'
import { listVoiceThemes, speakersForTheme, voiceThemeOf, type VoiceTheme } from './voice-themes.ts'
import { VoicePicker } from './voice-picker.tsx'
import { RateMagnetSlider } from './rate-magnet.tsx'
import { CloudRecognizer, type AsrVendor } from './asr.ts'
import { bridgeErrorKey, type VoiceKey, type VoiceTranslate } from './locales.ts'
import type { RecognitionHandle } from './speech.ts'

/** Card state: the resolved section plus which fields the user overrode. */
export interface VoiceCardState {
  status: 'loading' | 'ready' | 'unavailable'
  value: Required<VoiceSettings>
  user: Record<string, unknown>
  writable: boolean
}

/** Card face the inject factory returns (hooks bound to useVoiceCard). */
export interface VoiceCardInjected {
  hooks: {
    /** The framework binds this source as the `useVoiceCard` hook. */
    voiceCard: { getSnapshot(): VoiceCardState; subscribe(listener: () => void): () => void }
  }
  set(field: string, value: unknown): void
  /** Credential read/write for the theme setup guides (keys stay host-side). */
  credentials: {
    describe(payload: { refs: string[] }): Promise<{ result: { ok: boolean; value?: { credentials: Record<string, { configured: boolean }> } } }>
    set(payload: { ref: string; value: string }): Promise<{ result: { ok: boolean } }>
  }
}

/** Component props: the injected face with hooks bound (framework share). */
export interface VoiceCardProps {
  /** Selector hook over the card snapshot (framework-bound from hooks.voiceCard). */
  useVoiceCard: <S>(selector: (snapshot: VoiceCardState) => S, eq?: (a: S, b: S) => boolean) => S
  set(field: string, value: unknown): void
  /** Credential read/write (framework share from the inject face). */
  credentials: VoiceCardInjected['credentials']
  /** Namespace-bound translator (the framework locale seat). */
  t: VoiceTranslate
}

/** Credential refs per theme id (must match the host bridge's table).
 *  mask: false = display plain (APPID); true = show head****tail only. */
const THEME_CREDENTIAL_REFS: Record<string, readonly { ref: string; label: string; mask: boolean }[]> = {
  qwen: [
    { ref: 'VOICE_QWEN_API_KEY', label: 'DashScope API Key', mask: true },
  ],
  xfyun: [
    { ref: 'VOICE_XF_APP_ID', label: 'APPID', mask: false },
    { ref: 'VOICE_XF_API_SECRET', label: 'API Secret', mask: true },
    { ref: 'VOICE_XF_API_KEY', label: 'API Key', mask: true },
  ],
}

/** Theme → which settings fields its modal exposes (hard-coded, no framework). */
const THEME_MODAL_FIELDS: Record<string, readonly { field: string; label: VoiceKey; hint?: VoiceKey; placeholder?: string }[]> = {
  qwen: [
    { field: 'qwenModel', label: 'modal.model', placeholder: 'qwen3-tts-flash-realtime' },
    { field: 'qwenEndpoint', label: 'modal.endpoint', placeholder: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime' },
  ],
  xfyun: [
    { field: 'xfyunEndpoint', label: 'modal.endpoint', placeholder: 'wss://tts-api.xfyun.cn/v2/tts' },
  ],
}

/** 声纹效果 presets：静态缩略图（不引 lottie、不播动画），选中即写入 waveStyle。 */
const WAVE_PRINTS: readonly { id: string; art: ReactElement }[] = [
  {
    id: 'equalizer',
    art: (
      <svg viewBox='0 0 120 48' aria-hidden='true'>
        {[12, 22, 14, 34, 18, 40, 24, 30, 12, 36, 16, 26, 20, 10].map((h, i) => (
          <rect key={i} x={6 + i * 8} y={24 - h / 2} width={5} height={h} rx={2.5} fill='#3D9BE9' />
        ))}
      </svg>
    ),
  },
  {
    id: 'wave',
    art: (
      <svg viewBox='0 0 120 48' aria-hidden='true' fill='none'>
        <path d='M4 24 Q14 10 24 24 T44 24 T64 24 T84 24 T104 24 T120 24' stroke='#7DD5D9' strokeWidth={2} strokeLinecap='round' />
        <path d='M4 24 Q14 17 24 24 T44 24 T64 24 T84 24 T104 24 T120 24' stroke='#7DD5D9' strokeWidth={1} strokeLinecap='round' opacity={0.55} />
      </svg>
    ),
  },
]

/** Toggle row: a plain CSS dot slider (platform-style switch). */
function Toggle({ label, hint, on, disabled, onChange }: { label: string; hint?: string; on: boolean; disabled?: boolean; onChange(next: boolean): void }): ReactElement {
  return (
    <label className='dsh-voice-row'>
      <span className='dsh-voice-row-left'>
        <span className='dsh-voice-row-label'>{label}</span>
        {hint !== undefined && hint !== '' && <span className='dsh-voice-row-hint'>{hint}</span>}
      </span>
      <button
        type='button'
        role='switch'
        aria-checked={on}
        disabled={disabled}
        className={`dsh-voice-switch${on ? ' is-on' : ''}`}
        onClick={() => onChange(!on)}
      >
        <i className='dsh-voice-switch-knob' aria-hidden='true' />
      </button>
    </label>
  )
}

/** Number/text row with an inline apply-on-blur write. */
function Field({ label, hint, value, placeholder, disabled, onCommit }: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  disabled?: boolean
  onCommit(next: string): void
}): ReactElement {
  return (
    <label className='dsh-voice-row'>
      <span className='dsh-voice-row-left'>
        <span className='dsh-voice-row-label'>{label}</span>
        {hint !== undefined && hint !== '' && <span className='dsh-voice-row-hint'>{hint}</span>}
      </span>
      <input
        className='dsh-voice-input'
        defaultValue={value}
        placeholder={placeholder}
        disabled={disabled}
        onBlur={event => {
          if (event.target.value !== value) onCommit(event.target.value)
        }}
      />
    </label>
  )
}


/** Display a saved credential for on-page confirmation. Non-masked refs
 *  (APPID) show the value in full; masked refs (secret/key) show only
 *  head****tail — the store never hands values back for re-display. */
function maskRef(mask: boolean, value: string): string {
  const v = value.trim()
  if (!mask || v.length <= 8) return v
  return `${v.slice(0, 4)}****${v.slice(-4)}`
}

/** Fixed empty refs list (module constant — a per-render `?? []` churned identity). */
const EMPTY_REFS: readonly { ref: string; label: string }[] = []

/** Session cache of per-theme credential-configured state: cuts repeat
 *  describe() IPC when the settings page is revisited while state is stable.
 *  Cleared by the save flow (onRefresh) so a fresh check follows a write. */
const configuredCache = new Map<string, boolean>()

/** The try-listen player singleton + generation counter: a newer 试听 stops
 *  the one on the air the moment it is clicked, and an older in-flight fetch
 *  is discarded on arrival — two voices can never overlap. */
let tryAudio: HTMLAudioElement | null = null
let tryUrl: string | null = null
let trySeq = 0

function stopTryAudio(): void {
  if (tryAudio !== null) {
    tryAudio.pause()
    tryAudio.src = ''
    tryAudio = null
  }
  if (tryUrl !== null) {
    URL.revokeObjectURL(tryUrl)
    tryUrl = null
  }
}

/** Try-listen through the one-shot bridge route (cloud themes). */
function tryCloud(theme: string, voice: string, rate: number, extra: Record<string, string>, text: string, t: VoiceTranslate): void {
  const seq = ++trySeq
  stopTryAudio()
  void fetch(`/voice-tts/${theme}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, rate, ...extra }),
  }).then(async response => {
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null
      const key = bridgeErrorKey(body?.code)
      window.alert(key !== null ? t(key) : (body?.error ?? t('modal.cloudFail')))
      return
    }
    const url = URL.createObjectURL(await response.blob())
    if (seq !== trySeq) {
      // A newer click happened while this fetch was in flight — drop it.
      URL.revokeObjectURL(url)
      return
    }
    stopTryAudio()
    tryUrl = url
    tryAudio = new Audio(url)
    void tryAudio.play().catch(() => undefined)
  })
}

/** Try-listen for the system theme (speechSynthesis). */
function trySystem(voiceName: string, lang: string, rate: number, text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = rate
  if (voiceName !== '') {
    const voice = window.speechSynthesis.getVoices().find(v => v.name === voiceName)
    if (voice !== undefined) utterance.voice = voice
  }
  window.speechSynthesis.speak(utterance)
}

/** Try-listen for a theme given resolved settings + a speaker override. */
function tryListen(theme: string, settings: Required<VoiceSettings>, speakerOverride: string, t: VoiceTranslate): void {
  const voice = speakerOverride || settings.speakerByTheme[theme] || ''
  const rate = settings.rateByTheme[theme] ?? settings.rate
  const text = t('modal.tryText')
  if (theme === 'system') {
    trySystem(voice || settings.voiceName, settings.voiceLang, rate, text)
    return
  }
  const extra: Record<string, string> = {}
  if (theme === 'qwen') {
    extra.model = settings.qwenModel
    extra.endpoint = settings.qwenEndpoint
  }
  if (theme === 'xfyun') extra.endpoint = settings.xfyunEndpoint
  tryCloud(theme, voice, rate, extra, text, t)
}

/** Theme → endpoint settings field (used to build the modal try-listen). */
function themeExtras(theme: string, value: Required<VoiceSettings>): Record<string, string> {
  if (theme === 'qwen') return { model: value.qwenModel, endpoint: value.qwenEndpoint }
  if (theme === 'xfyun') return { endpoint: value.xfyunEndpoint }
  return {}
}

/** The listening engines: same credential refs as their 说 twins share. */
const ASR_ENGINES: readonly { id: string; labelKey: VoiceKey; refs: readonly string[]; noteKey?: VoiceKey; setupUrl?: string }[] = [
  {
    id: 'qwen', labelKey: 'theme.qwen', refs: ['VOICE_QWEN_API_KEY'],
    noteKey: 'theme.asrQwenNote',
  },
  {
    id: 'xfyun', labelKey: 'theme.xfyun', refs: ['VOICE_XF_APP_ID', 'VOICE_XF_API_KEY', 'VOICE_XF_API_SECRET'],
    noteKey: 'theme.asrXfyunNote',
    setupUrl: 'https://console.xfyun.cn/services/iat',
  },
]

/** The 听 modal's per-engine settings fields (model/endpoint override). */
const ASR_MODAL_FIELDS: Record<string, readonly { field: string; label: VoiceKey; hint?: VoiceKey; placeholder?: string }[]> = {
  qwen: [
    { field: 'asrQwenModel', label: 'modal.model', placeholder: 'qwen3-asr-flash-realtime' },
    { field: 'asrQwenEndpoint', label: 'modal.endpoint', placeholder: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime' },
  ],
  xfyun: [
    { field: 'asrXfyunEndpoint', label: 'modal.endpoint', placeholder: 'wss://iat-api.xfyun.cn/v2/iat' },
  ],
}

/**
 * One listening-engine row: pick the ASR engine the loop's recognizer uses.
 * The credential status reads the same VOICE_* refs the 说 engines configure
 * (one engine, two directions), so the check mirrors EngineRow's — session
 * cache first, describe() IPC only when it misses.
 */
function AsrRow({
  engine, value, credentials, set, refreshKey, disabled, onActivate, onRefresh, t,
}: {
  engine: { id: string; labelKey: VoiceKey; refs: readonly string[]; noteKey?: VoiceKey; setupUrl?: string }
  value: Required<VoiceSettings>
  credentials: VoiceCardProps['credentials']
  set(field: string, value: unknown): void
  refreshKey: number
  disabled: boolean
  onActivate(): void
  onRefresh(): void
  t: VoiceTranslate
}): ReactElement {
  const refs = ASR_CREDENTIAL_REFS[engine.id] ?? EMPTY_REFS
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)

  useEffect(() => {
    const cacheKey = `asr:${engine.id}`
    const cached = configuredCache.get(cacheKey)
    if (cached !== undefined) {
      setConfigured(cached)
      return
    }
    let alive = true
    void credentials.describe({ refs: [...engine.refs] }).then(response => {
      if (!alive || !response.result.ok) return
      const list = response.result.value?.credentials ?? {}
      const ok = engine.refs.every(ref => list[ref]?.configured === true)
      configuredCache.set(cacheKey, ok)
      if (alive) setConfigured(ok)
    }).catch(() => { if (alive) setConfigured(false) })
    return () => { alive = false }
  }, [credentials, engine.id, engine.refs, refreshKey])

  const active = value.asrTheme === engine.id
  const statusWord = configured === null
    ? t('engine.checking')
    : configured ? (active ? t('engine.active') : t('engine.configured')) : t('engine.missing')
  const pseudoTheme = voiceThemeOf(engine.id) ?? voiceThemeOf('system')!
  return (
    <div className='dsh-voice-engine-row'>
      <div className='dsh-voice-engine-info'>
        <div className='dsh-voice-engine-line'>
          <span className={`dsh-voice-engine-name${active ? ' is-active' : ''}`}>{t(engine.labelKey)}</span>
          <span className={`dsh-voice-engine-status${configured === false ? ' is-missing' : ''}`}>{statusWord}</span>
        </div>
      </div>
      <div className='dsh-voice-provider-actions'>
        <button type='button' className='dsh-voice-provider-btn is-primary' disabled={active}
          onClick={onActivate}>
          {active ? t('engine.enabled') : t('engine.enable')}
        </button>
        <button type='button' className='dsh-voice-provider-btn' onClick={() => setTestOpen(true)}>
          {t('engine.test')}
        </button>
        <button type='button' className='dsh-voice-provider-btn' onClick={() => setModalOpen(true)}>
          {t('engine.setup')}
        </button>
      </div>
      {testOpen && <AsrTestModal engine={engine} value={value} onClose={() => setTestOpen(false)} t={t} />}
      {modalOpen && (
        <ProviderModal
          theme={pseudoTheme}
          value={value}
          credentials={credentials}
          set={set}
          onRefresh={onRefresh}
          onClose={() => setModalOpen(false)}
          variant={{
            title: t(engine.labelKey),
            refs,
            fields: ASR_MODAL_FIELDS[engine.id] ?? [],
            note: engine.noteKey !== undefined ? t(engine.noteKey) : undefined,
            setupUrl: engine.setupUrl,
            tryListen: false,
          }}
          t={t}
        />
      )}
    </div>
  )
}

/** Credential display spec per 听 engine id (mirrors the 说 twins' refs). */
const ASR_CREDENTIAL_REFS: Record<string, readonly { ref: string; label: string; mask: boolean }[]> = {
  qwen: [
    { ref: 'VOICE_QWEN_API_KEY', label: 'DashScope API Key', mask: true },
  ],
  xfyun: [
    { ref: 'VOICE_XF_APP_ID', label: 'APPID', mask: false },
    { ref: 'VOICE_XF_API_SECRET', label: 'API Secret', mask: true },
    { ref: 'VOICE_XF_API_KEY', label: 'API Key', mask: true },
  ],
}

/** The 听 module's mic test: one standalone recognition session, transcript
 *  streams into a read-only box; closing tears the session down for real
 *  (socket closed, mic tracks stopped — the same stop discipline as the loop).
 *  Credential/vendor failures surface here in plain text, so the settings
 *  page can self-diagnose without a call. */
function AsrTestModal({
  engine, value, onClose, t,
}: {
  engine: { id: string; labelKey: VoiceKey; refs: readonly string[]; noteKey?: VoiceKey; setupUrl?: string }
  value: Required<VoiceSettings>
  onClose(): void
  t: VoiceTranslate
}): ReactElement {
  const [lines, setLines] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<RecognitionHandle | null>(null)

  useEffect(() => {
    const recognizer = new CloudRecognizer(engine.id as AsrVendor, t)
    if (!recognizer.supported()) {
      setError(t('err.micPage'))
      return
    }
    handleRef.current = recognizer.start({
      onInterim: setInterim,
      onFinal: text => { setLines(list => [...list, text]); setInterim('') },
      onEnd: () => { /* unexpected drops re-arm inside the recognizer */ },
      onError: (message, fatal, code) => {
        if (!fatal) return
        const key = bridgeErrorKey(code)
        setError(key !== null ? t(key) : message)
      },
    }, {
      // 所配即所测：弹窗里配的模型/端点/语言原样带进 hello 帧。
      lang: value.voiceLang,
      model: engine.id === 'qwen' ? value.asrQwenModel : undefined,
      endpoint: engine.id === 'qwen' ? value.asrQwenEndpoint : value.asrXfyunEndpoint,
    })
    return () => {
      handleRef.current?.stop()
      handleRef.current = null
    }
  }, [engine.id, value.voiceLang, value.asrQwenModel, value.asrQwenEndpoint, value.asrXfyunEndpoint, t])

  return (
    <div className='dsh-voice-modal-veil' onClick={onClose}>
      <div className='dsh-voice-modal' onClick={event => event.stopPropagation()}>
        <div className='dsh-voice-modal-head'>
          <h4 className='dsh-voice-modal-title'>{t('modal.testTitle', { name: t(engine.labelKey) })}</h4>
          <button type='button' className='dsh-voice-modal-close' onClick={onClose} aria-label={t('modal.close')}>✕</button>
        </div>
        {error !== null
          ? <p className='dsh-voice-card-warn'>{error}</p>
          : <p className='dsh-voice-setup-note'><i className='dsh-voice-test-dot' aria-hidden='true' />{t('modal.testHint')}</p>}
        <div className='dsh-voice-asr-test-text'>
          {lines.map((line, i) => <p key={i}>{line}</p>)}
          {interim !== '' && <p className='dsh-voice-asr-test-interim'>{interim}</p>}
          {lines.length === 0 && interim === '' && error === null && <p className='dsh-voice-asr-test-waiting'>…</p>}
        </div>
        <div className='dsh-voice-modal-footer'>
          {error === null && <span className='dsh-voice-setup-ok'>{t('modal.testStop')}</span>}
          <button type='button' className='dsh-voice-provider-btn' onClick={onClose}>{t('modal.done')}</button>
        </div>
      </div>
    </div>
  )
}

/** One engine row inside the unified panel: name + status + actions. */
function EngineRow({
  theme, value, credentials, set, refreshKey, onActivate, onRefresh, t,
}: {
  theme: VoiceTheme
  value: Required<VoiceSettings>
  credentials: VoiceCardProps['credentials']
  set(field: string, value: unknown): void
  /** Bumped after a save so the credential check re-runs (cache invalidated). */
  refreshKey: number
  onActivate(): void
  onRefresh(): void
  t: VoiceTranslate
}): ReactElement {
  const refs = THEME_CREDENTIAL_REFS[theme.id] ?? EMPTY_REFS
  const needsSetup = theme.needsSetup === true && refs.length > 0
  const [configured, setConfigured] = useState<boolean | null>(needsSetup ? null : true)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    if (!needsSetup) return
    // Serve from the session cache — a settings-page revisit must not refire
    // describe() IPC while the credential state is unchanged.
    const cached = configuredCache.get(theme.id)
    if (cached !== undefined) {
      setConfigured(cached)
      return
    }
    let alive = true
    void credentials.describe({ refs: refs.map(r => r.ref) }).then(response => {
      if (!alive || !response.result.ok) return
      const list = response.result.value?.credentials ?? {}
      const ok = refs.every(r => list[r.ref]?.configured === true)
      configuredCache.set(theme.id, ok)
      if (alive) setConfigured(ok)
    }).catch(() => { if (alive) setConfigured(false) })
    return () => { alive = false }
  }, [credentials, needsSetup, refs, theme.id, refreshKey])

  const active = value.ttsTheme === theme.id
  const statusWord = !needsSetup
    ? (active ? t('engine.active') : t('engine.ready'))
    : configured === null ? t('engine.checking')
      : configured ? (active ? t('engine.active') : t('engine.configured'))
        : t('engine.missing')

  return (
    <div className='dsh-voice-engine-row'>
      <div className='dsh-voice-engine-info'>
        <div className='dsh-voice-engine-line'>
          <span className={`dsh-voice-engine-name${active ? ' is-active' : ''}`}>{t(theme.labelKey)}</span>
          <span className={`dsh-voice-engine-status${configured === false ? ' is-missing' : ''}`}>{statusWord}</span>
        </div>
        {theme.noteKey !== undefined && <p className='dsh-voice-engine-note'>{t(theme.noteKey)}</p>}
      </div>
      <div className='dsh-voice-provider-actions'>
        <button type='button' className='dsh-voice-provider-btn is-primary' disabled={active}
          onClick={onActivate}>
          {active ? t('engine.enabled') : t('engine.enable')}
        </button>
        <button type='button' className='dsh-voice-provider-btn'
          onClick={() => tryListen(theme.id, value, value.speakerByTheme[theme.id] ?? theme.defaultSpeaker ?? '', t)}>
          {t('engine.preview')}
        </button>
        {needsSetup && (
          <button type='button' className='dsh-voice-provider-btn' onClick={() => setModalOpen(true)}>
            {t('engine.setup')}
          </button>
        )}
      </div>
      {modalOpen && (
        <ProviderModal
          theme={theme}
          value={value}
          credentials={credentials}
          set={set}
          onRefresh={onRefresh}
          onClose={() => setModalOpen(false)}
          t={t}
        />
      )}
    </div>
  )
}

/** The per-provider settings modal: credentials + fields + try-listen area.
 *  Filling a credential saves it on blur (no manual 保存): the page then shows
 *  the saved APPID in full and head/tail of the two keys, since the credential
 *  store only ever reports "configured" — never the value back. */
/** Non-TTS modality override for the shared modal (the 听 rows use it). */
interface ProviderModalVariant {
  title: string
  refs: readonly { ref: string; label: string; mask: boolean }[]
  fields: readonly { field: string; label: VoiceKey; hint?: VoiceKey; placeholder?: string }[]
  note?: string
  setupUrl?: string
  /** false hides the TTS-only preview section (speaker + prompt + buttons). */
  tryListen?: boolean
}

function ProviderModal({
  theme, value, credentials, set, onRefresh, onClose, variant, t,
}: {
  theme: VoiceTheme
  value: Required<VoiceSettings>
  credentials: VoiceCardProps['credentials']
  set(field: string, value: unknown): void
  onRefresh(): void
  onClose(): void
  /** Set for the 听 rows: their tables + no TTS try-listen. */
  variant?: ProviderModalVariant
  t: VoiceTranslate
}): ReactElement {
  const refs = variant?.refs ?? THEME_CREDENTIAL_REFS[theme.id] ?? EMPTY_REFS
  const fields = variant?.fields ?? THEME_MODAL_FIELDS[theme.id] ?? []
  const speakers = speakersForTheme(theme.id, value.voiceLang)
  // A stored '' (the retired 主题默认 option) reads as the theme default.
  const storedSpeaker = value.speakerByTheme[theme.id]
  const savedSpeaker = (storedSpeaker === undefined || storedSpeaker === '')
    ? (theme.defaultSpeaker ?? '')
    : storedSpeaker
  const [credState, setCredState] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  /** Masked preview of values saved THIS session (head/tail of keys). */
  const [savedPreview, setSavedPreview] = useState<Record<string, string>>({})
  /** Stored credentials as head****tail, served by the host status route —
   *  so the preview survives reloads (the browser never gets full values). */
  const [storedPreview, setStoredPreview] = useState<Record<string, string>>({})
  /** Which credential rows are in edit mode: editing rows show the typed
   *  draft (password dots); idle rows SHOW the stored mask in the field
   *  itself — the standard credential display (GitHub/OpenAI style). */
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [fieldDraft, setFieldDraft] = useState<Record<string, string>>(
    Object.fromEntries(fields.map(f => [f.field, String(value[f.field as keyof Required<VoiceSettings>] ?? '')])),
  )
  const [speakerDraft, setSpeakerDraft] = useState(savedSpeaker)
  const [promptDraft, setPromptDraft] = useState(() => t('modal.tryText'))
  const [message, setMessage] = useState<string | null>(null)
  const speakerChanged = speakerDraft !== savedSpeaker
  // Per-theme default rate, mirroring the speaker: the stored entry for this
  // theme (falling back to the global rate) is the draft's starting point.
  const savedRate = value.rateByTheme[theme.id] ?? value.rate
  const [rateDraft, setRateDraft] = useState(savedRate)
  const rateChanged = rateDraft !== savedRate

  useEffect(() => {
    if (refs.length === 0) return
    let alive = true
    void credentials.describe({ refs: refs.map(r => r.ref) }).then(response => {
      if (!alive || !response.result.ok) return
      const list = response.result.value?.credentials ?? {}
      setCredState(Object.fromEntries(refs.map(r => [r.ref, list[r.ref]?.configured === true])))
    }).catch(() => { /* inputs stay editable */ })
    // The host masks stored values head****tail itself; this is what makes
    // the preview survive a reload (fresh session, no savedPreview yet).
    void fetch('/voice-tts/status').then(r => r.json()).then((body: { previews?: Record<string, string> }) => {
      if (!alive) return
      setStoredPreview(body.previews ?? {})
    }).catch(() => { /* badge falls back to 已配置 */ })
    return () => { alive = false }
  }, [credentials, refs])

  /** Auto-save one credential on blur; on success show its value (plain or masked). */
  /** What the idle field shows: this session's just-saved mask, else the
   *  stored credential's head****tail (full value for the plain APPID). */
  const displayOf = (ref: string): string => savedPreview[ref] ?? storedPreview[ref] ?? ''

  const saveCred = (ref: string, mask: boolean): void => {
    const text = draft[ref]?.trim() ?? ''
    if (text === '') return
    setMessage(null)
    void credentials.set({ ref, value: text }).then(res => {
      if (res.result.ok) {
        setCredState(c => ({ ...c, [ref]: true }))
        setSavedPreview(p => ({ ...p, [ref]: maskRef(mask, text) }))
        setMessage(t('modal.saved'))
        onRefresh()
      } else {
        setMessage(t('modal.saveFailed'))
      }
    }).catch(() => setMessage(t('modal.saveFailed')))
  }

  /** Auto-save a model/endpoint field on blur when it actually changed. */
  const saveField = (field: string): void => {
    const next = (fieldDraft[field] ?? '').trim()
    const prev = String(value[field as keyof Required<VoiceSettings>] ?? '')
    if (next !== '' && next !== prev) {
      set(field, next)
      setMessage(t('modal.saved'))
      onRefresh()
    }
  }

  const tryIt = (): void => {
    if (theme.id === 'system') {
      trySystem(speakerDraft || value.voiceName, value.voiceLang, rateDraft, promptDraft)
      return
    }
    tryCloud(theme.id, speakerDraft, rateDraft, themeExtras(theme.id, {
      ...value,
      qwenModel: fieldDraft.qwenModel ?? value.qwenModel,
      qwenEndpoint: fieldDraft.qwenEndpoint ?? value.qwenEndpoint,
      xfyunEndpoint: fieldDraft.xfyunEndpoint ?? value.xfyunEndpoint,
    }), promptDraft, t)
  }

  return (
    <div className='dsh-voice-modal-veil' onClick={onClose}>
      <div className='dsh-voice-modal' onClick={event => event.stopPropagation()}>
      <div className='dsh-voice-modal-head'>
        <h4 className='dsh-voice-modal-title'>{variant?.title ?? t(theme.labelKey)}</h4>
        <button type='button' className='dsh-voice-modal-close' onClick={onClose} aria-label={t('modal.close')}>✕</button>
      </div>
      {(variant?.setupUrl ?? theme.setupUrl) !== undefined && (
        <p className='dsh-voice-setup-note'>
          {variant?.note ?? (theme.noteKey !== undefined ? t(theme.noteKey) : '')} <a href={(variant?.setupUrl ?? theme.setupUrl)!} target='_blank' rel='noreferrer' className='dsh-voice-setup-link'>{t('modal.register')}</a>
        </p>
      )}
      {(refs.length > 0 || fields.length > 0) && <div className='dsh-voice-modal-divider'>{t('modal.serviceConfig')}</div>}
        {refs.map(({ ref, label, mask }) => (
          <label key={ref} className='dsh-voice-row'>
            <span className='dsh-voice-row-label'>{label}</span>
            <span className='dsh-voice-cred-cell'>
              <input
                className='dsh-voice-input dsh-voice-input-wide'
                type={editing[ref] === true && mask ? 'password' : 'text'}
                placeholder={displayOf(ref) !== ''
                  ? ''
                  : credState[ref] === true
                    ? (mask ? '••••••••' : t('modal.saved'))
                    : (mask ? t('modal.placeholderSecret') : t('modal.placeholderAppId'))}
                value={editing[ref] === true ? (draft[ref] ?? '') : displayOf(ref)}
                onFocus={() => setEditing(e => ({ ...e, [ref]: true }))}
                onChange={event => setDraft(d => ({ ...d, [ref]: event.target.value }))}
                onBlur={() => { saveCred(ref, mask); setEditing(e => ({ ...e, [ref]: false })) }}
                onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
              />
            </span>
          </label>
        ))}
        {fields.map(({ field, label, hint, placeholder }) => (
          <label key={field} className='dsh-voice-row'>
            <span className='dsh-voice-row-label'>
              {t(label)}
              {hint !== undefined && <span className='dsh-voice-modal-hint'>（{t(hint)}）</span>}
            </span>
            <input
              className='dsh-voice-input dsh-voice-input-wide'
              value={fieldDraft[field] ?? ''}
              placeholder={placeholder ?? undefined}
              onChange={event => setFieldDraft(d => ({ ...d, [field]: event.target.value }))}
              onBlur={() => saveField(field)}
              onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
            />
          </label>
        ))}
        {variant?.tryListen !== false && (<>
        <div className='dsh-voice-modal-divider'>{t('modal.trySection')}</div>
        <label className='dsh-voice-row'>
          <span className='dsh-voice-row-label'>{t('modal.speaker')}</span>
          <span className='dsh-voice-cred-cell'>
            <VoicePicker
              options={speakers}
              value={speakerDraft}
              defaultId={savedSpeaker}
              t={t}
              ariaLabel={t('modal.speaker')}
              strategy='portal'
              onChange={setSpeakerDraft}
            />
            <button
              type='button'
              className='dsh-voice-provider-btn'
              disabled={!speakerChanged}
              onClick={() => {
                set('speakerByTheme', { ...value.speakerByTheme, [theme.id]: speakerDraft })
                onRefresh()
                setMessage(t('modal.defaultVoiceSaved'))
              }}
            >
              {t('modal.setDefault')}
            </button>
          </span>
        </label>
        <label className='dsh-voice-row'>
          <span className='dsh-voice-row-label'>{t('modal.rate')}</span>
          <span className='dsh-voice-cred-cell'>
            <RateMagnetSlider rate={rateDraft} onChange={setRateDraft} t={t} />
            <button
              type='button'
              className='dsh-voice-provider-btn'
              disabled={!rateChanged}
              onClick={() => {
                set('rateByTheme', { ...value.rateByTheme, [theme.id]: rateDraft })
                setMessage(t('modal.defaultRateSaved'))
              }}
            >
              {t('modal.setDefault')}
            </button>
          </span>
        </label>
        <label className='dsh-voice-row dsh-voice-row-top'>
          <span className='dsh-voice-row-label'>{t('modal.prompt')}</span>
          <textarea
            className='dsh-voice-input dsh-voice-input-wide dsh-voice-input-area'
            rows={3}
            value={promptDraft}
            onChange={event => setPromptDraft(event.target.value)}
          />
        </label>
        <div className='dsh-voice-try-row'>
          <button type='button' className='dsh-voice-provider-btn is-primary' onClick={tryIt}>{t('modal.try')}</button>
        </div>
        </>)}
        <div className='dsh-voice-modal-footer'>
          {message !== null && <span className='dsh-voice-setup-ok'>{message}</span>}
          <button type='button' className='dsh-voice-provider-btn' onClick={onClose}>{t('modal.done')}</button>
        </div>
      </div>
    </div>
  )
}

/** Render the voice settings card. */
export function VoiceSettingsCard({ useVoiceCard, set, credentials, t }: VoiceCardProps): ReactElement {
  const status = useVoiceCard(s => s.status)
  const value = useVoiceCard(s => s.value)
  const writable = useVoiceCard(s => s.writable)
  const disabled = !writable

  // The system-theme speaker picker needs the platform roster, which arrives
  // asynchronously in Chrome (voiceschanged); re-read it until non-empty.
  const [voicesTick, tickVoices] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    if (window.speechSynthesis.getVoices().length > 0) return
    // Chrome can fire voiceschanged in bursts as voices load; throttle the
    // re-renders and stop after a few attempts so a quiet roster doesn't
    // re-render the whole card on a loop.
    let attempts = 0
    let lastAt = 0
    const onChange = (): void => {
      const now = Date.now()
      if (now - lastAt < 250) return
      lastAt = now
      if (++attempts > 8) {
        window.speechSynthesis.removeEventListener('voiceschanged', onChange)
        return
      }
      tickVoices(n => n + 1)
    }
    window.speechSynthesis.addEventListener('voiceschanged', onChange)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', onChange)
  }, [])

  if (status !== 'ready') {
    return (
      <div className='dsh-voice-card'>
        <h3 className='dsh-voice-card-title'>{t('card.title')}</h3>
        <p className='dsh-voice-card-empty'>{status === 'loading' ? t('card.loading') : t('card.unavailable')}</p>
      </div>
    )
  }
  return (
    <div className='dsh-voice-card'>
      <h3 className='dsh-voice-card-title'>{t('card.title')}</h3>
      <div className='dsh-voice-panel'>
        <div className='dsh-voice-panel-sec'>
          <div className='dsh-voice-panel-title'>{t('card.basic')}</div>
          <Toggle label={t('card.bargeIn')} hint={value.allowInterrupt ? t('card.bargeInHint') : undefined}
            on={value.allowInterrupt} disabled={disabled}
            onChange={next => { set('allowInterrupt', next) }} />
          <Field label={t('card.silence')} value={String(value.silenceTimeout)} placeholder={t('card.silencePlaceholder')} disabled={disabled}
            onCommit={next => { const n = Number(next); if (Number.isFinite(n)) set('silenceTimeout', Math.min(6, Math.max(0.4, n))) }} />
        </div>

        <div className='dsh-voice-panel-sep' aria-hidden='true' />

        <div className='dsh-voice-panel-sec'>
          <div className='dsh-voice-panel-title'>{t('card.wave')}</div>
          <div className='dsh-voice-print-grid'>
            {WAVE_PRINTS.map(print => (
              <button key={print.id} type='button'
                className={`dsh-voice-print-card${value.waveStyle === print.id ? ' is-selected' : ''}`}
                disabled={disabled}
                onClick={() => { if (!disabled) set('waveStyle', print.id) }}>
                <span className='dsh-voice-print-thumb'>{print.art}</span>
              </button>
            ))}
          </div>
        </div>

        <div className='dsh-voice-panel-sep' aria-hidden='true' />

        <div className='dsh-voice-panel-sec'>
          <div className='dsh-voice-panel-title'>{t('card.speak')}</div>
          {listVoiceThemes().map(theme => (
            <EngineRow
              key={theme.id}
              theme={theme}
              value={value}
              credentials={credentials}
              set={set}
              refreshKey={voicesTick}
              onActivate={() => { if (!disabled) set('ttsTheme', theme.id) }}
              onRefresh={() => { configuredCache.clear(); tickVoices(n => n + 1) }}
              t={t}
            />
          ))}
        </div>

        <div className='dsh-voice-panel-sep' aria-hidden='true' />

        <div className='dsh-voice-panel-sec'>
          <div className='dsh-voice-panel-title'>{t('card.hear')}</div>
          {ASR_ENGINES.map(engine => (
            <AsrRow
              key={engine.id}
              engine={engine}
              value={value}
              credentials={credentials}
              set={set}
              refreshKey={voicesTick}
              disabled={disabled}
              onActivate={() => { if (!disabled) set('asrTheme', engine.id) }}
              onRefresh={() => { configuredCache.clear(); tickVoices(n => n + 1) }}
              t={t}
            />
          ))}
        </div>
      </div>

    </div>
  )
}
