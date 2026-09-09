// Host loader entry for the voice-talk plugin.
//
// The Node half owns two facts the browser half cannot hold:
// 1. the `voice` settings namespace — the durable user configuration both
//    halves read (the browser mirrors it through its settings-scope service);
// 2. the TTS bridge routes — HTTP endpoints the call overlay calls for cloud
//    speech synthesis (vendor protocols and credentials stay host-side).
//
// Spoken content is derived from the reply's own text blocks on the client;
// no prompt-side protocol is involved.

import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { makeVoiceTtsRoutes } from './tts-bridge.ts'
import { registerQwenUpgrade, QWEN_DEFAULT_ENDPOINT, QWEN_DEFAULT_MODEL } from './tts-qwen.ts'

/** Settings namespace both halves read. */
export const VOICE_SETTINGS_NAMESPACE = settingsNamespace('voice')

/** User configuration of the voice surfaces (read by the browser half). */
export interface Config {
  /** Allow interrupting a readout by speaking (barge-in). */
  allowInterrupt?: boolean
  /** Silence length (seconds) that ends one utterance and submits the draft. */
  silenceTimeout?: number
  /** Speech rate for the readout (0.5–2, utterance.rate). */
  rate?: number
  /** BCP-47 language tag the recognizer and speaker use (default zh-CN). */
  voiceLang?: string
  /** Voice name for the active theme; empty picks the theme default. */
  voiceName?: string
  /** Which registered voice theme speaks the readout (extensible enum). */
  ttsTheme?: string
  /** Theme-private parameters (cloud voices: model/tone/style etc.). */
  ttsParams?: Record<string, unknown>
  /** Readout safety valve in chars; 0 = unlimited (default). */
  maxReadoutChars?: number
  /** Speaker voice per theme id (themes have disjoint voice namespaces). */
  speakerByTheme?: Record<string, string>
  /** DashScope realtime TTS model (must be a qwen3-tts-*-realtime series). */
  qwenModel?: string
  /** DashScope realtime WS endpoint (preset ships the official address). */
  qwenEndpoint?: string
  /** iFlytek TTS WS endpoint (preset ships the official address). */
  xfyunEndpoint?: string
}

export const Config: z<Config> = z.object({
  // Half-duplex by default: speaker playback feeds the microphone (echo) and
  // the ASR re-voices the readout back into the loop. Headphone users opt in.
  allowInterrupt: z.boolean().default(false),
  silenceTimeout: z.number().min(0.4).max(6).step(0.1).default(2),
  rate: z.number().min(0.5).max(2).step(0.1).default(1),
  voiceLang: z.string().default('zh-CN'),
  voiceName: z.string().default(''),
  ttsTheme: z.string().default('system'),
  ttsParams: z.any().default({}),
  maxReadoutChars: z.number().min(0).max(5000).step(50).default(0),
  speakerByTheme: z.any().default({}),
  qwenModel: z.string().default(QWEN_DEFAULT_MODEL),
  qwenEndpoint: z.string().default(QWEN_DEFAULT_ENDPOINT),
  xfyunEndpoint: z.string().default('wss://tts-api.xfyun.cn/v2/tts'),
})

/**
 * Register the `voice` settings namespace (composition entry as the base
 * layer; settings edits reach the browser live through its scope
 * subscription) and the TTS bridge routes for the cloud speech vendors.
 */
export function apply(ctx: Context, config?: Config): void {
  installSettingsSection(ctx, VOICE_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: () => { /* the browser half reads the live scope itself */ },
    onChange: () => { /* nothing host-side reacts to voice settings */ },
  })
  // Declared inject (not ctx.get): the loader waits for the web server, so
  // the bridge routes are guaranteed a live registration site.
  for (const route of makeVoiceTtsRoutes(ctx)) ctx.webServer.register(route)
  ctx.webServer.registerUpgrade(registerQwenUpgrade(ctx))
}

/** The bridge routes mount with the web server; credentials resolve per request. */
export const inject = ['webServer', 'credentials']
