// Browser mirror of the `voice` settings namespace (registered by the host
// half through the same schemastery schema). The browser reads the resolved
// section through its settings-scope service and falls back to these defaults
// whenever the namespace is unavailable (memory mode, plugin off).

/** Resolved settings shape as served by the host schema. */
export interface VoiceSettings {
  allowInterrupt?: boolean
  silenceTimeout?: number
  rate?: number
  voiceLang?: string
  voiceName?: string
  ttsTheme?: string
  ttsParams?: Record<string, unknown>
  maxReadoutChars?: number
  /** Speaker per theme id (themes have disjoint voice-name namespaces). */
  speakerByTheme?: Record<string, string>
  /** DashScope realtime TTS model (qwen3-tts-*-realtime series). */
  qwenModel?: string
  /** DashScope realtime WS endpoint. */
  qwenEndpoint?: string
  /** iFlytek TTS WS endpoint. */
  xfyunEndpoint?: string
  /** Voice-print preset shown in the call face ('equalizer' | 'wave'). */
  waveStyle?: string
  /** Which registered ASR engine listens ('qwen' | 'xfyun'). */
  asrTheme?: string
  /** DashScope streaming ASR model id (the 听 modal's 模型 ID). */
  asrQwenModel?: string
  /** DashScope realtime ASR WS endpoint. */
  asrQwenEndpoint?: string
  /** iFlytek iat WS endpoint. */
  asrXfyunEndpoint?: string
}

/** Defaults matching the host schema, applied when a field is absent. */
export const VOICE_DEFAULTS: Required<VoiceSettings> = {
  allowInterrupt: false,
  silenceTimeout: 2,
  rate: 1,
  voiceLang: 'zh-CN',
  voiceName: '',
  ttsTheme: 'system',
  ttsParams: {},
  maxReadoutChars: 0,
  speakerByTheme: {},
  qwenModel: 'qwen3-tts-flash-realtime',
  qwenEndpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
  xfyunEndpoint: 'wss://tts-api.xfyun.cn/v2/tts',
  waveStyle: 'wave',
  asrTheme: 'qwen',
  asrQwenModel: 'qwen3-asr-flash-realtime',
  asrQwenEndpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
  asrXfyunEndpoint: 'wss://iat-api.xfyun.cn/v2/iat',
}

/** Magnet stops of the rate slider (all within every vendor's hard cap). */
export const RATE_STOPS: readonly number[] = [1.0, 1.2, 1.5, 1.8, 2.0]

/** Index of the nearest magnet stop for an arbitrary stored rate. */
export function nearestRateIndex(rate: number): number {
  let best = 0
  for (let i = 1; i < RATE_STOPS.length; i++) {
    if (Math.abs(RATE_STOPS[i]! - rate) < Math.abs(RATE_STOPS[best]! - rate)) best = i
  }
  return best
}

/** Display label of the nearest magnet stop ("1.8x" for a stored 1.7). */
export function nearestRateLabel(rate: number): string {
  return `${RATE_STOPS[nearestRateIndex(rate)]!.toFixed(1)}x`
}

/** Merge a (possibly partial) resolved section over the defaults. */
export function resolveSettings(section: VoiceSettings | undefined): Required<VoiceSettings> {
  const value = section ?? {}
  return {
    allowInterrupt: value.allowInterrupt ?? VOICE_DEFAULTS.allowInterrupt,
    silenceTimeout: value.silenceTimeout ?? VOICE_DEFAULTS.silenceTimeout,
    rate: value.rate ?? VOICE_DEFAULTS.rate,
    voiceLang: value.voiceLang ?? VOICE_DEFAULTS.voiceLang,
    voiceName: value.voiceName ?? VOICE_DEFAULTS.voiceName,
    ttsTheme: value.ttsTheme ?? VOICE_DEFAULTS.ttsTheme,
    ttsParams: value.ttsParams ?? VOICE_DEFAULTS.ttsParams,
    maxReadoutChars: value.maxReadoutChars ?? VOICE_DEFAULTS.maxReadoutChars,
    speakerByTheme: value.speakerByTheme ?? VOICE_DEFAULTS.speakerByTheme,
    qwenModel: value.qwenModel ?? VOICE_DEFAULTS.qwenModel,
    qwenEndpoint: value.qwenEndpoint ?? VOICE_DEFAULTS.qwenEndpoint,
    xfyunEndpoint: value.xfyunEndpoint ?? VOICE_DEFAULTS.xfyunEndpoint,
    waveStyle: value.waveStyle ?? VOICE_DEFAULTS.waveStyle,
    asrTheme: value.asrTheme ?? VOICE_DEFAULTS.asrTheme,
    asrQwenModel: value.asrQwenModel ?? VOICE_DEFAULTS.asrQwenModel,
    asrQwenEndpoint: value.asrQwenEndpoint ?? VOICE_DEFAULTS.asrQwenEndpoint,
    asrXfyunEndpoint: value.asrXfyunEndpoint ?? VOICE_DEFAULTS.asrXfyunEndpoint,
  }
}
