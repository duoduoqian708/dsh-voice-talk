// The voice settings card: one card in the web settings page's plugin
// configuration tab, keyed by the `voice` namespace. It draws its own chrome
// (the section's card model is not importable across plugins) and writes
// field-by-field through the settings scope, revision-fenced by the wire.

import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { VoiceSettings } from './voice-settings.ts'
import { listVoiceThemes, speakersForTheme, type VoiceTheme } from './voice-themes.ts'

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
const THEME_MODAL_FIELDS: Record<string, readonly { field: string; label: string; hint?: string }[]> = {
  qwen: [
    { field: 'qwenModel', label: '模型 ID', hint: '需为 qwen3-tts-*-realtime 系列' },
    { field: 'qwenEndpoint', label: '接口地址' },
  ],
  xfyun: [
    { field: 'xfyunEndpoint', label: '接口地址' },
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

/** The sentence the try-listen buttons read. */
const TRY_TEXT = '你好，我是你的语音助手，很高兴为你朗读内容。'

/** Fixed empty refs list (module constant — a per-render `?? []` churned identity). */
const EMPTY_REFS: readonly { ref: string; label: string }[] = []

/** Session cache of per-theme credential-configured state: cuts repeat
 *  describe() IPC when the settings page is revisited while state is stable.
 *  Cleared by the save flow (onRefresh) so a fresh check follows a write. */
const configuredCache = new Map<string, boolean>()
/** Try-listen always reads at the default rate; live speed lives on the HUD. */
const TRY_RATE = 1.0

/** Try-listen through the one-shot bridge route (cloud themes). */
function tryCloud(theme: string, voice: string, extra: Record<string, string>): void {
  void fetch(`/voice-tts/${theme}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: TRY_TEXT, voice, rate: TRY_RATE, ...extra }),
  }).then(async response => {
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      window.alert(body?.error ?? '云端合成失败')
      return
    }
    const url = URL.createObjectURL(await response.blob())
    new Audio(url).play().catch(() => undefined)
  })
}

/** Try-listen for the system theme (speechSynthesis). */
function trySystem(voiceName: string, lang: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(TRY_TEXT)
  utterance.lang = lang
  utterance.rate = TRY_RATE
  if (voiceName !== '') {
    const voice = window.speechSynthesis.getVoices().find(v => v.name === voiceName)
    if (voice !== undefined) utterance.voice = voice
  }
  window.speechSynthesis.speak(utterance)
}

/** Try-listen for a theme given resolved settings + a speaker override. */
function tryListen(theme: string, settings: Required<VoiceSettings>, speakerOverride: string): void {
  const voice = speakerOverride || settings.speakerByTheme[theme] || ''
  if (theme === 'system') {
    trySystem(voice || settings.voiceName, settings.voiceLang)
    return
  }
  const extra: Record<string, string> = {}
  if (theme === 'qwen') {
    extra.model = settings.qwenModel
    extra.endpoint = settings.qwenEndpoint
  }
  if (theme === 'xfyun') extra.endpoint = settings.xfyunEndpoint
  tryCloud(theme, voice, extra)
}

/** Theme → endpoint settings field (used to build the modal try-listen). */
function themeExtras(theme: string, value: Required<VoiceSettings>): Record<string, string> {
  if (theme === 'qwen') return { model: value.qwenModel, endpoint: value.qwenEndpoint }
  if (theme === 'xfyun') return { endpoint: value.xfyunEndpoint }
  return {}
}

/** One engine row inside the unified panel: name + status + actions. */
function EngineRow({
  theme, value, credentials, set, refreshKey, onActivate, onRefresh,
}: {
  theme: VoiceTheme
  value: Required<VoiceSettings>
  credentials: VoiceCardProps['credentials']
  set(field: string, value: unknown): void
  /** Bumped after a save so the credential check re-runs (cache invalidated). */
  refreshKey: number
  onActivate(): void
  onRefresh(): void
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
    ? (active ? '当前启用' : '就绪')
    : configured === null ? '检查凭证中…'
      : configured ? (active ? '当前启用' : '凭证已配置')
        : '凭证未配置'

  return (
    <div className='dsh-voice-engine-row'>
      <div className='dsh-voice-engine-info'>
        <div className='dsh-voice-engine-line'>
          <span className={`dsh-voice-engine-name${active ? ' is-active' : ''}`}>{theme.label}</span>
          <span className={`dsh-voice-engine-status${configured === false ? ' is-missing' : ''}`}>{statusWord}</span>
        </div>
        {theme.note !== undefined && <p className='dsh-voice-engine-note'>{theme.note}</p>}
      </div>
      <div className='dsh-voice-provider-actions'>
        <button type='button' className='dsh-voice-provider-btn is-primary' disabled={active}
          onClick={onActivate}>
          {active ? '已启用' : '启用'}
        </button>
        <button type='button' className='dsh-voice-provider-btn'
          onClick={() => tryListen(theme.id, value, value.speakerByTheme[theme.id] ?? theme.defaultSpeaker ?? '')}>
          试听
        </button>
        {needsSetup && (
          <button type='button' className='dsh-voice-provider-btn' onClick={() => setModalOpen(true)}>
            设置
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
        />
      )}
    </div>
  )
}

/** The per-provider settings modal: credentials + fields + try-listen area.
 *  Filling a credential saves it on blur (no manual 保存): the page then shows
 *  the saved APPID in full and head/tail of the two keys, since the credential
 *  store only ever reports "configured" — never the value back. */
function ProviderModal({
  theme, value, credentials, set, onRefresh, onClose,
}: {
  theme: VoiceTheme
  value: Required<VoiceSettings>
  credentials: VoiceCardProps['credentials']
  set(field: string, value: unknown): void
  onRefresh(): void
  onClose(): void
}): ReactElement {
  const refs = THEME_CREDENTIAL_REFS[theme.id] ?? EMPTY_REFS
  const fields = THEME_MODAL_FIELDS[theme.id] ?? []
  const speakers = speakersForTheme(theme.id, value.voiceLang)
  const savedSpeaker = value.speakerByTheme[theme.id] ?? theme.defaultSpeaker ?? ''
  const [credState, setCredState] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  /** Masked preview of values saved THIS session (head/tail of keys). */
  const [savedPreview, setSavedPreview] = useState<Record<string, string>>({})
  const [fieldDraft, setFieldDraft] = useState<Record<string, string>>(
    Object.fromEntries(fields.map(f => [f.field, String(value[f.field as keyof Required<VoiceSettings>] ?? '')])),
  )
  const [speakerDraft, setSpeakerDraft] = useState(savedSpeaker)
  const [promptDraft, setPromptDraft] = useState(TRY_TEXT)
  const [message, setMessage] = useState<string | null>(null)
  const speakerChanged = speakerDraft !== savedSpeaker

  useEffect(() => {
    if (refs.length === 0) return
    let alive = true
    void credentials.describe({ refs: refs.map(r => r.ref) }).then(response => {
      if (!alive || !response.result.ok) return
      const list = response.result.value?.credentials ?? {}
      setCredState(Object.fromEntries(refs.map(r => [r.ref, list[r.ref]?.configured === true])))
    }).catch(() => { /* inputs stay editable */ })
    return () => { alive = false }
  }, [credentials, refs])

  /** Auto-save one credential on blur; on success show its value (plain or masked). */
  const saveCred = (ref: string, mask: boolean): void => {
    const text = draft[ref]?.trim() ?? ''
    if (text === '') return
    setMessage(null)
    void credentials.set({ ref, value: text }).then(res => {
      if (res.result.ok) {
        setCredState(c => ({ ...c, [ref]: true }))
        setSavedPreview(p => ({ ...p, [ref]: maskRef(mask, text) }))
        setMessage('已保存')
        onRefresh()
      } else {
        setMessage('保存失败，请重试')
      }
    }).catch(() => setMessage('保存失败，请重试'))
  }

  /** Auto-save a model/endpoint field on blur when it actually changed. */
  const saveField = (field: string): void => {
    const next = (fieldDraft[field] ?? '').trim()
    const prev = String(value[field as keyof Required<VoiceSettings>] ?? '')
    if (next !== '' && next !== prev) {
      set(field, next)
      setMessage('已保存')
      onRefresh()
    }
  }

  const tryIt = (): void => {
    if (theme.id === 'system') {
      trySystem(speakerDraft || value.voiceName, value.voiceLang)
      return
    }
    void fetch(`/voice-tts/${theme.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: promptDraft,
        voice: speakerDraft,
        rate: TRY_RATE,
        ...themeExtras(theme.id, {
          ...value,
          qwenModel: fieldDraft.qwenModel ?? value.qwenModel,
          qwenEndpoint: fieldDraft.qwenEndpoint ?? value.qwenEndpoint,
          xfyunEndpoint: fieldDraft.xfyunEndpoint ?? value.xfyunEndpoint,
        }),
      }),
    }).then(async response => {
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        window.alert(body?.error ?? '云端合成失败')
        return
      }
      const url = URL.createObjectURL(await response.blob())
      new Audio(url).play().catch(() => undefined)
    })
  }

  return (
    <div className='dsh-voice-modal-veil' onClick={onClose}>
      <div className='dsh-voice-modal' onClick={event => event.stopPropagation()}>
      <div className='dsh-voice-modal-head'>
        <h4 className='dsh-voice-modal-title'>{theme.label.replace(/（.*?）/, '')}</h4>
        <button type='button' className='dsh-voice-modal-close' onClick={onClose} aria-label='关闭'>✕</button>
      </div>
      {theme.setupUrl !== undefined && (
        <p className='dsh-voice-setup-note'>
          {theme.note} <a href={theme.setupUrl} target='_blank' rel='noreferrer' className='dsh-voice-setup-link'>注册并获取密钥 ↗</a>
        </p>
      )}
      {(refs.length > 0 || fields.length > 0) && <div className='dsh-voice-modal-divider'>服务配置</div>}
        {refs.map(({ ref, label, mask }) => (
          <label key={ref} className='dsh-voice-row'>
            <span className='dsh-voice-row-label'>{label}</span>
            <span className='dsh-voice-cred-cell'>
              <input
                className='dsh-voice-input dsh-voice-input-wide'
                type={mask ? 'password' : 'text'}
                placeholder={credState[ref] === true
                  ? (mask ? '••••••••' : '已保存')
                  : (mask ? '粘贴密钥' : '输入 APPID')}
                value={draft[ref] ?? ''}
                onChange={event => setDraft(d => ({ ...d, [ref]: event.target.value }))}
                onBlur={() => saveCred(ref, mask)}
                onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
              />
              {savedPreview[ref] !== undefined
                ? <span className='dsh-voice-cred-badge'>{savedPreview[ref]}</span>
                : credState[ref] === true && <span className='dsh-voice-cred-badge'>{mask ? '已配置' : '已保存'}</span>}
            </span>
          </label>
        ))}
        {fields.map(({ field, label, hint }) => (
          <label key={field} className='dsh-voice-row'>
            <span className='dsh-voice-row-label'>
              {label}
              {hint !== undefined && <span className='dsh-voice-modal-hint'>（{hint}）</span>}
            </span>
            <input
              className='dsh-voice-input dsh-voice-input-wide'
              value={fieldDraft[field] ?? ''}
              onChange={event => setFieldDraft(d => ({ ...d, [field]: event.target.value }))}
              onBlur={() => saveField(field)}
              onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
            />
          </label>
        ))}
        <div className='dsh-voice-modal-divider'>试听</div>
        <label className='dsh-voice-row'>
          <span className='dsh-voice-row-label'>音色</span>
          <span className='dsh-voice-cred-cell'>
            <select
              className='dsh-voice-input dsh-voice-input-wide'
              value={speakerDraft}
              onChange={event => setSpeakerDraft(event.target.value)}
            >
              {renderSpeakerOptions(speakers)}
            </select>
            <button
              type='button'
              className='dsh-voice-provider-btn'
              disabled={!speakerChanged}
              onClick={() => {
                set('speakerByTheme', { ...value.speakerByTheme, [theme.id]: speakerDraft })
                onRefresh()
                setMessage('已设为默认音色')
              }}
            >
              设为默认
            </button>
          </span>
        </label>
        <label className='dsh-voice-row'>
          <span className='dsh-voice-row-label'>试听提示词</span>
          <input
            className='dsh-voice-input dsh-voice-input-wide'
            value={promptDraft}
            onChange={event => setPromptDraft(event.target.value)}
          />
        </label>
        <div className='dsh-voice-provider-actions'>
          <button type='button' className='dsh-voice-provider-btn is-primary' onClick={tryIt}>试听</button>
        </div>
        <div className='dsh-voice-modal-footer'>
          <button type='button' className='dsh-voice-provider-btn' onClick={onClose}>完成</button>
          {message !== null && <span className='dsh-voice-setup-ok'>{message}</span>}
        </div>
      </div>
    </div>
  )
}

/** Render a (possibly grouped) speaker roster as select children. */
function renderSpeakerOptions(speakers: ReturnType<typeof speakersForTheme>): ReactElement[] {
  const groups = [...new Set(speakers.filter(o => 'group' in o).map(o => (o as { group: string }).group))]
  if (groups.length === 0) {
    return speakers.map(option => (
      <option key={option.id || '__default'} value={option.id}>
        {'more' in option ? `更多 · ${option.label}` : option.label}
      </option>
    ))
  }
  const out: ReactElement[] = []
  for (const group of groups) {
    out.push(
      <optgroup key={group} label={group}>
        {speakers.filter(o => 'group' in o && (o as { group: string }).group === group).map(option => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </optgroup>,
    )
  }
  const tail = speakers.filter(o => !('group' in o))
  for (const option of tail) {
    out.push(<option key={option.id || '__default'} value={option.id}>{'more' in option ? option.label : option.label}</option>)
  }
  return out
}

/** Render the voice settings card. */
export function VoiceSettingsCard({ useVoiceCard, set, credentials }: VoiceCardProps): ReactElement {
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
        <h3 className='dsh-voice-card-title'>语音对话</h3>
        <p className='dsh-voice-card-empty'>{status === 'loading' ? '读取设置中…' : '设置不可用（内存模式）'}</p>
      </div>
    )
  }
  return (
    <div className='dsh-voice-card'>
      <h3 className='dsh-voice-card-title'>语音对话</h3>
      <div className='dsh-voice-panel'>
        <div className='dsh-voice-panel-sec'>
          <div className='dsh-voice-panel-title'>基础设置</div>
          <Toggle label='说话打断播报' hint={value.allowInterrupt ? '说话即可打断播报，播报回音自动滤除' : undefined}
            on={value.allowInterrupt} disabled={disabled}
            onChange={next => { set('allowInterrupt', next) }} />
          <Field label='停顿多久自动发送（秒）' value={String(value.silenceTimeout)} placeholder='默认 2' disabled={disabled}
            onCommit={next => { const n = Number(next); if (Number.isFinite(n)) set('silenceTimeout', Math.min(6, Math.max(0.4, n))) }} />
          <Field label='播报字数上限' hint={value.maxReadoutChars === 0 ? '0 = 不限；播报自动剔除推理与代码' : '播报自动剔除推理与代码'}
            value={String(value.maxReadoutChars)} placeholder='0 = 不限' disabled={disabled}
            onCommit={next => { const n = Number(next); if (Number.isFinite(n) && n >= 0) set('maxReadoutChars', Math.min(5000, n)) }} />
        </div>

        <div className='dsh-voice-panel-sep' aria-hidden='true' />

        <div className='dsh-voice-panel-sec'>
          <div className='dsh-voice-panel-title'>声纹效果</div>
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
          <div className='dsh-voice-panel-title'>音色引擎</div>
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
            />
          ))}
        </div>
      </div>

    </div>
  )
}
