// Voice theme registry: speakable engines a deployment can pick from. A theme
// is one id + label + provider factory; the controller resolves the active
// theme from settings on every round, so adding a cloud engine later is one
// register call plus an enum value — no controller change.

import { SystemTtsProvider, type TtsProvider } from './speech.ts'
import { QwenRealtimeTtsProvider, XfyunTtsProvider } from './cloud-tts.ts'

/** One selectable voice theme. */
export interface VoiceTheme {
  /** Stable id stored in settings (`voice.ttsTheme`). */
  readonly id: string
  /** Human label for the settings card. */
  readonly label: string
  /** Create one provider instance (cheap; controllers hold none across themes). */
  create(): TtsProvider
  /**
   * Whether the theme needs setup before it can speak (credentials etc.);
   * `true` themes surface a setup guide in the settings card and a hint in
   * the call overlay until configured.
   */
  readonly needsSetup?: boolean
  /** One-line pricing/setup note shown next to the theme picker. */
  readonly note?: string
  /** Registration/console URL for paid themes. */
  readonly setupUrl?: string
  /** Default speaker for the theme (the picker's initial selection). */
  readonly defaultSpeaker?: string
}

const themes = new Map<string, VoiceTheme>()

/** Register a theme; a duplicate id throws (fail loud, misconfiguration). */
export function registerVoiceTheme(theme: VoiceTheme): void {
  if (themes.has(theme.id)) {
    throw new Error(`voice theme "${theme.id}" is already registered`)
  }
  themes.set(theme.id, theme)
}

/** The registered theme for an id, or undefined when unknown. */
export function voiceThemeOf(id: string | undefined): VoiceTheme | undefined {
  return themes.get(id ?? '')
}

/** All registered themes (settings card ordering). */
export function listVoiceThemes(): readonly VoiceTheme[] {
  return [...themes.values()]
}

registerVoiceTheme({
  id: 'system',
  label: '系统语音',
  create: () => new SystemTtsProvider(),
})

registerVoiceTheme({
  id: 'qwen',
  label: '阿里千问',
  create: () => new QwenRealtimeTtsProvider(),
  needsSetup: true,
  note: '约 1 元 / 万字符',
  setupUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
  defaultSpeaker: 'Cherry',
})

registerVoiceTheme({
  id: 'xfyun',
  label: '讯飞',
  create: () => new XfyunTtsProvider(),
  needsSetup: true,
  note: '约 500 次 / 日免费',
  setupUrl: 'https://www.xfyun.cn/services/online_tts',
  defaultSpeaker: 'x4_yezi',
})

/* ---- speaker roster per theme ---- */

/** Speaker options for the system (speechSynthesis) theme. */
export interface SpeakerOption {
  /** speechSynthesis voice name / vendor voice id (`voice` param). */
  readonly id: string
  /** Chinese display label. */
  readonly label: string
  /** Optional group marker: the picker renders group headers when present. */
  readonly group?: string
}

/** Curated zh-CN shortlist for the system theme (novelty voices excluded). */
export const RECOMMENDED_SPEAKERS: readonly SpeakerOption[] = [
  { id: 'Tingting', label: '婷婷 · 标准女声' },
  { id: 'Shelley', label: 'Shelley · 女声' },
  { id: 'Flo', label: 'Flo · 女声' },
  { id: 'Sandy', label: 'Sandy · 女声' },
  { id: 'Reed', label: 'Reed · 男声' },
]

const NOVELTY = /^(Eddy|Grandma|Grandpa|Rocko)\b/i

/** System-theme roster: curated hits first, then the platform tail, then default. */
export function speakerOptions(lang: string): Array<SpeakerOption | { id: string; label: string; more: true }> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [{ id: '', label: '系统默认', more: true }]
  }
  const prefix = lang.split('-')[0] ?? ''
  const available = window.speechSynthesis.getVoices()
    .filter(v => v.lang.toLowerCase().startsWith(prefix.toLowerCase()))
  const roster: Array<SpeakerOption | { id: string; label: string; more: true }> = []
  for (const rec of RECOMMENDED_SPEAKERS) {
    if (available.some(v => v.name === rec.id)) roster.push({ ...rec })
  }
  for (const v of available) {
    if (NOVELTY.test(v.name)) continue
    if (roster.some(r => r.id === v.name)) continue
    roster.push({ id: v.name, label: v.name, more: true })
  }
  roster.push({ id: '', label: '系统默认', more: true })
  return roster
}

/** Qwen3-TTS realtime zh roster: 28 mandarin + 10 dialect voices. */
export const QWEN_SPEAKERS: readonly SpeakerOption[] = [
  // ---- mandarin (28) ----
  { id: 'Cherry', label: '芊悦 · 阳光亲切小姐姐', group: '普通话' },
  { id: 'Serena', label: '苏瑶 · 温柔小姐姐', group: '普通话' },
  { id: 'Ethan', label: '晨煦 · 阳光温暖男声', group: '普通话' },
  { id: 'Chelsie', label: '千雪 · 二次元女友', group: '普通话' },
  { id: 'Momo', label: '茉兔 · 撒娇搞怪', group: '普通话' },
  { id: 'Vivian', label: '十三 · 拽拽小暴躁', group: '普通话' },
  { id: 'Moon', label: '月白 · 率性帅气男声', group: '普通话' },
  { id: 'Maia', label: '四月 · 知性温柔', group: '普通话' },
  { id: 'Kai', label: '凯 · 耳朵的 SPA', group: '普通话' },
  { id: 'Nofish', label: '不吃鱼 · 平翘舌设计师', group: '普通话' },
  { id: 'Bella', label: '萌宝 · 小萝莉', group: '普通话' },
  { id: 'Jennifer', label: '詹妮弗 · 电影质感美语', group: '普通话' },
  { id: 'Ryan', label: '甜茶 · 戏感男声', group: '普通话' },
  { id: 'Katerina', label: '卡捷琳娜 · 御姐', group: '普通话' },
  { id: 'Aiden', label: '艾登 · 美语大男孩', group: '普通话' },
  { id: 'Eldric Sage', label: '沧明子 · 沉稳睿智老者', group: '普通话' },
  { id: 'Mia', label: '乖小妹 · 温顺乖巧', group: '普通话' },
  { id: 'Mochi', label: '沙小弥 · 早慧小大人', group: '普通话' },
  { id: 'Bellona', label: '燕铮莺 · 洪亮热血', group: '普通话' },
  { id: 'Vincent', label: '田叔 · 沙哑烟嗓江湖', group: '普通话' },
  { id: 'Bunny', label: '萌小姬 · 萌系萝莉', group: '普通话' },
  { id: 'Neil', label: '阿闻 · 新闻主持人', group: '普通话' },
  { id: 'Elias', label: '墨讲师 · 严谨讲师', group: '普通话' },
  { id: 'Arthur', label: '徐大爷 · 质朴讲古', group: '普通话' },
  { id: 'Nini', label: '邻家妹妹 · 软黏甜嗓', group: '普通话' },
  { id: 'Seren', label: '小婉 · 舒缓助眠', group: '普通话' },
  { id: 'Pip', label: '顽屁小孩 · 调皮童声', group: '普通话' },
  { id: 'Stella', label: '少女阿月 · 甜腻少女', group: '普通话' },
  // ---- dialect (10) ----
  { id: 'Jada', label: '上海-阿珍 · 沪上阿姐', group: '方言' },
  { id: 'Dylan', label: '北京-晓东 · 胡同少年', group: '方言' },
  { id: 'Li', label: '南京-老李 · 瑜伽老师', group: '方言' },
  { id: 'Marcus', label: '陕西-秦川 · 老陕', group: '方言' },
  { id: 'Roy', label: '闽南-阿杰 · 市井诙谐', group: '方言' },
  { id: 'Peter', label: '天津-李彼得 · 相声捧哏', group: '方言' },
  { id: 'Sunny', label: '四川-晴儿 · 甜心川妹', group: '方言' },
  { id: 'Eric', label: '四川-程川 · 成都男子', group: '方言' },
  { id: 'Rocky', label: '粤语-阿强 · 幽默陪聊', group: '方言' },
  { id: 'Kiki', label: '粤语-阿清 · 港妹闺蜜', group: '方言' },
]

/** iFlytek streaming-TTS speaker ids (control-console 试用 list). */
export const XFYUN_SPEAKERS: readonly SpeakerOption[] = [
  { id: 'x4_yezi', label: '小露 · 女声（默认）' },
  { id: 'x4_xiaoyan', label: '小燕 · 女声' },
  { id: 'aisjiuxu', label: '许久 · 男声' },
  { id: 'aisjinger', label: '小婧 · 女声' },
  { id: 'aisbabyxu', label: '许小宝 · 童声' },
]

/**
 * Speaker roster for a theme id. Grouped rosters render with `<optgroup>`
 * headers (the caller detects groups by the shared `group` field).
 */
export function speakersForTheme(themeId: string, lang: string): Array<SpeakerOption | { id: string; label: string; more: true }> {
  if (themeId === 'qwen') {
    return [...QWEN_SPEAKERS.map(o => ({ ...o })), { id: '', label: '主题默认（芊悦）', more: true }]
  }
  if (themeId === 'xfyun') {
    return [...XFYUN_SPEAKERS.map(o => ({ ...o })), { id: '', label: '主题默认（小露）', more: true }]
  }
  return speakerOptions(lang)
}
