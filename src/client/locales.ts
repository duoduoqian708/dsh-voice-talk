// Voice-talk locale dictionaries (namespace `voice`): every piece of visible
// copy this plugin owns, in zh (the key-set source of truth) and en. Slot
// components receive the framework `t` seat because their registrations
// declare `locale: NS`; non-React surfaces (the controller, the providers)
// receive `ctx.locale.bind(NS)`, which reads the active locale at call time.

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'voice'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  // ---- settings card chrome ------------------------------------------------
  'card.title': '语音对话',
  'card.loading': '读取设置中…',
  'card.unavailable': '设置不可用（内存模式）',
  'card.basic': '基础设置',
  'card.bargeIn': '说话打断播报',
  'card.bargeInHint': '说话即可打断播报，播报回音自动滤除',
  'card.silence': '停顿多久自动发送（秒）',
  'card.silencePlaceholder': '默认 2',
  'card.wave': '声纹效果',
  'card.speak': '说 · 音色引擎',
  'card.hear': '听 · 语音识别',

  // ---- engine rows ----------------------------------------------------------
  'engine.checking': '检查凭证中…',
  'engine.active': '当前启用',
  'engine.configured': '凭证已配置',
  'engine.missing': '凭证未配置',
  'engine.ready': '就绪',
  'engine.enabled': '已启用',
  'engine.enable': '启用',
  'engine.test': '试音',
  'engine.preview': '试听',
  'engine.setup': '设置',
  'theme.system': '系统语音',
  'theme.qwen': '千问',
  'theme.xfyun': '讯飞',
  'theme.qwenNote': '约 0.33 元 / 千字符',
  'theme.xfyunNote': '约 500 次 / 日免费',
  'theme.asrQwenNote': '复用 DashScope API Key（与说共用同一凭证）',
  'theme.asrXfyunNote': '听写需在讯飞控制台开通「语音听写（流式版）」服务（每日免费 500 次）',

  // ---- provider modal -------------------------------------------------------
  'modal.close': '关闭',
  'modal.serviceConfig': '服务配置',
  'modal.trySection': '试听',
  'modal.speaker': '音色',
  'modal.rate': '语速',
  'modal.prompt': '试听提示词',
  'modal.setDefault': '设为默认',
  'modal.defaultVoiceSaved': '已设为默认音色',
  'modal.defaultRateSaved': '已设为默认语速',
  'modal.saved': '已保存',
  'modal.saveFailed': '保存失败，请重试',
  'modal.placeholderSecret': '粘贴密钥',
  'modal.placeholderAppId': '输入 APPID',
  'modal.done': '完成',
  'modal.register': '注册并获取密钥 ↗',
  'modal.model': '模型 ID',
  'modal.endpoint': '接口地址',
  'modal.try': '试听',
  'modal.testTitle': '{name} · 试音',
  'modal.testHint': '监听中 — 对着麦克风说话，文字出现在下方',
  'modal.testStop': '关闭即停止识别',
  'modal.tryText': '你好，我是你的语音助手。很高兴为你朗读这段试听内容，你可以听听我的音色是否自然、语速是否合适。准备好了吗？',
  'modal.cloudFail': '云端合成失败',
  'err.micPage': '此页面无法使用麦克风（需要 https 或本机 localhost 访问）',

  // ---- call overlay ---------------------------------------------------------
  'phase.idle': '待命',
  'phase.listening': '聆听中',
  'phase.thinking': '思考中',
  'phase.speaking': '播报中',
  'countdown.aria': '说话限时倒计时',
  'hero.muteTitle': '静音麦克风（不收录声音，不挂断）',
  'hero.unmuteTitle': '取消静音（恢复收录）',
  'hero.muteAria': '静音麦克风',
  'reasoning.done': '已深度思考',
  'common.collapse': '收起',
  'common.expand': '展开',
  'question.badge': '需要你的回答',
  'question.waiting': '等待回答…',
  'question.multi': '可多选',
  'question.free': '自由回答',
  'question.selected': '已选择：{list}',
  'question.listSep': '、',
  'question.sep': '；',
  'question.typed': '已输入：{text}',
  'question.skipped': '已跳过',
  'question.cancelled': '已取消',
  'question.unanswered': '未收到答案',
  'hud.skip': '跳过播报',
  'hud.setupMissing': '该引擎尚未配置凭证 — 到设置页完成接入，或切回系统语音',
  'hud.pending': '{count} 项待确认 — 请语音回答',
  'hud.rateTitle': '语速（仅本会话）',
  'hud.hangupTitle': '结束语音对话（Esc）',
  'hud.hangupAria': '结束语音对话',
  'hud.expandStream': '展开信息流',
  'hud.collapseStream': '收起信息流',
  'hud.toggleStreamAria': '收起或展开信息流',
  'hud.streamAria': '会话内容',
  'hud.typingAria': '正在生成',
  'hud.callingTools': '正在调用 {tools}',
  'hud.jumpTitle': '回到最新',
  'hud.jumpAria': '回到最新消息',

  // ---- pickers / controls ---------------------------------------------------
  'picker.systemDefault': '系统默认',
  'picker.defaultMark': '（默认）',
  'picker.speakerAria': '说话人',
  'picker.lockHint': '本轮回复播完后可切换',
  'rate.aria': '语速',
  'group.mandarin': '普通话',
  'group.dialect': '方言',
  'mic.titleActive': '退出语音对话（Esc）',
  'mic.titleIdle': '语音对话：免手多轮（Esc 退出）',
  'mic.badge': '对话',

  // ---- controller / provider failures ---------------------------------------
  'err.unsupported': '此浏览器不支持语音采集（需要麦克风与 WebSocket）',
  'err.replyTimeout': '回复等待超时',
  'err.synth': '语音合成错误：{detail}',
  'err.micDenied': '麦克风不可用或被拒绝',
  'err.asrFailed': '语音识别失败',
  'err.playback': '音频播放失败',
  'err.playbackDetail': '音频播放失败：{detail}',
  'err.bridgeHttp': '语音桥请求失败（HTTP {status}）',
  'err.webAudio': '此浏览器不支持 Web Audio（需要 Chrome/Edge）',
  'err.qwenSynth': '千问合成失败',
  'err.qwenSynthDetail': '千问合成失败：{detail}',
  'err.qwenLost': '千问连接中断',
  'err.qwenConnect': '千问连接失败',
  'err.qwenConnectDetail': '千问连接失败：{detail}',
  'err.code.missingQwen': '未配置千问凭证：设置 → 语音对话 → 阿里千问 → 设置，粘贴 DashScope API Key',
  'err.code.missingXfyun': '未配置讯飞凭证：设置 → 语音对话 → 讯飞 → 设置，填写 App ID / API Key / API Secret',
  'err.code.credentialsUnavailable': '凭证服务不可用',
  'err.code.emptyText': '文本为空',
  'err.code.unknownVendor': '未知供应商',
}

/** The voice namespace key union. */
export type VoiceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<VoiceKey, string> = {
  'card.title': 'Voice chat',
  'card.loading': 'Loading settings…',
  'card.unavailable': 'Settings unavailable (in-memory mode)',
  'card.basic': 'Basics',
  'card.bargeIn': 'Barge-in while speaking',
  'card.bargeInHint': 'Speak to interrupt the readout; speaker echo is filtered out',
  'card.silence': 'Auto-send after a pause (seconds)',
  'card.silencePlaceholder': 'Default 2',
  'card.wave': 'Voice wave',
  'card.speak': 'Speak · Voice engine',
  'card.hear': 'Listen · Speech recognition',

  'engine.checking': 'Checking credentials…',
  'engine.active': 'Active',
  'engine.configured': 'Credentials set',
  'engine.missing': 'Credentials missing',
  'engine.ready': 'Ready',
  'engine.enabled': 'Enabled',
  'engine.enable': 'Enable',
  'engine.test': 'Test mic',
  'engine.preview': 'Preview',
  'engine.setup': 'Settings',
  'theme.system': 'System voice',
  'theme.qwen': 'Qwen',
  'theme.xfyun': 'iFlytek',
  'theme.qwenNote': '≈¥0.33 per 1k characters',
  'theme.xfyunNote': '~500 free calls/day',
  'theme.asrQwenNote': 'Shares the DashScope API Key with Speak',
  'theme.asrXfyunNote': 'Enable the streaming iat service in the iFlytek console (500 free calls/day)',

  'modal.close': 'Close',
  'modal.serviceConfig': 'Service configuration',
  'modal.trySection': 'Preview',
  'modal.speaker': 'Voice',
  'modal.rate': 'Rate',
  'modal.prompt': 'Preview text',
  'modal.setDefault': 'Set as default',
  'modal.defaultVoiceSaved': 'Default voice saved',
  'modal.defaultRateSaved': 'Default rate saved',
  'modal.saved': 'Saved',
  'modal.saveFailed': 'Save failed, please retry',
  'modal.placeholderSecret': 'Paste key',
  'modal.placeholderAppId': 'Enter APPID',
  'modal.done': 'Done',
  'modal.register': 'Get credentials ↗',
  'modal.model': 'Model ID',
  'modal.endpoint': 'Endpoint',
  'modal.try': 'Preview',
  'modal.testTitle': '{name} · Test',
  'modal.testHint': 'Listening — speak into the mic; text shows below',
  'modal.testStop': 'Closing stops recognition',
  'modal.tryText': 'Hello, this is your voice assistant. I am happy to read this preview for you — listen for whether my voice sounds natural and the pace suits you. Ready?',
  'modal.cloudFail': 'Cloud synthesis failed',
  'err.micPage': 'Microphone unavailable on this page (needs https or localhost)',

  'phase.idle': 'Standing by',
  'phase.listening': 'Listening',
  'phase.thinking': 'Thinking',
  'phase.speaking': 'Speaking',
  'countdown.aria': 'Utterance time-limit countdown',
  'hero.muteTitle': 'Mute microphone (stop capturing, stay on the call)',
  'hero.unmuteTitle': 'Unmute microphone',
  'hero.muteAria': 'Mute microphone',
  'reasoning.done': 'Deep thinking',
  'common.collapse': 'Collapse',
  'common.expand': 'Expand',
  'question.badge': 'Your answer is needed',
  'question.waiting': 'Waiting for an answer…',
  'question.multi': 'Multiple choices',
  'question.free': 'Free-form answer',
  'question.selected': 'Selected: {list}',
  'question.listSep': ', ',
  'question.sep': '; ',
  'question.typed': 'Entered: {text}',
  'question.skipped': 'Skipped',
  'question.cancelled': 'Cancelled',
  'question.unanswered': 'No answer received',
  'hud.skip': 'Skip readout',
  'hud.setupMissing': 'This engine has no credentials yet — finish setup in Settings, or switch back to System voice',
  'hud.pending': '{count} awaiting your answer — reply by voice',
  'hud.rateTitle': 'Rate (this session only)',
  'hud.hangupTitle': 'End the voice call (Esc)',
  'hud.hangupAria': 'End the voice call',
  'hud.expandStream': 'Expand the stream',
  'hud.collapseStream': 'Collapse the stream',
  'hud.toggleStreamAria': 'Collapse or expand the stream',
  'hud.streamAria': 'Conversation',
  'hud.typingAria': 'Generating',
  'hud.callingTools': 'Running {tools}',
  'hud.jumpTitle': 'Jump to latest',
  'hud.jumpAria': 'Jump to the latest message',

  'picker.systemDefault': 'System default',
  'picker.defaultMark': ' (default)',
  'picker.speakerAria': 'Speaker',
  'picker.lockHint': 'Switchable after this reply finishes',
  'rate.aria': 'Rate',
  'group.mandarin': 'Mandarin',
  'group.dialect': 'Dialect',
  'mic.titleActive': 'Exit voice chat (Esc)',
  'mic.titleIdle': 'Voice chat: hands-free multi-turn (Esc to exit)',
  'mic.badge': 'Call',

  'err.unsupported': 'Voice capture is unavailable in this browser (microphone and WebSocket required)',
  'err.replyTimeout': 'Timed out waiting for the reply',
  'err.synth': 'Speech synthesis error: {detail}',
  'err.micDenied': 'Microphone unavailable or permission denied',
  'err.asrFailed': 'Speech recognition failed',
  'err.playback': 'Audio playback failed',
  'err.playbackDetail': 'Audio playback failed: {detail}',
  'err.bridgeHttp': 'Voice bridge request failed (HTTP {status})',
  'err.webAudio': 'This browser does not support Web Audio (Chrome/Edge required)',
  'err.qwenSynth': 'Qwen synthesis failed',
  'err.qwenSynthDetail': 'Qwen synthesis failed: {detail}',
  'err.qwenLost': 'Qwen connection lost',
  'err.qwenConnect': 'Qwen connection failed',
  'err.qwenConnectDetail': 'Qwen connection failed: {detail}',
  'err.code.missingQwen': 'Qwen credentials not configured: Settings → Voice chat → Alibaba Qwen → Settings, paste the DashScope API Key',
  'err.code.missingXfyun': 'iFlytek credentials not configured: Settings → Voice chat → iFlytek → Settings, fill in App ID / API Key / API Secret',
  'err.code.credentialsUnavailable': 'Credential service unavailable',
  'err.code.emptyText': 'Empty text',
  'err.code.unknownVendor': 'Unknown provider',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    voice: VoiceKey
  }
}

/** The typed translate function this plugin's surfaces receive. */
export type VoiceTranslate = Translate<VoiceKey>

/** Question-result markers stored in the transcript projection; the card maps
 *  them to copy at render time so a locale switch re-labels history. */
export const QUESTION_CANCELLED = '@voice/cancelled'
export const QUESTION_UNANSWERED = '@voice/unanswered'

/** Bridge error code → dictionary key (host-originated, stable failures). */
export function bridgeErrorKey(code: string | undefined): VoiceKey | null {
  switch (code) {
    case 'missing-qwen-credentials': return 'err.code.missingQwen'
    case 'missing-xfyun-credentials': return 'err.code.missingXfyun'
    case 'credentials-unavailable': return 'err.code.credentialsUnavailable'
    case 'empty-text': return 'err.code.emptyText'
    case 'unknown-vendor': return 'err.code.unknownVendor'
    default: return null
  }
}

/**
 * Localize an error surfaced from a provider: a known bridge code wins;
 * otherwise the raw message (vendor text) passes through untouched.
 */
export function errorText(t: VoiceTranslate, error: unknown): string {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code
    if (typeof code === 'string') {
      const key = bridgeErrorKey(code)
      if (key !== null) return t(key)
    }
    return error.message
  }
  return String(error)
}
