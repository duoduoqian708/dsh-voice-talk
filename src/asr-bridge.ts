// Host-side ASR bridge: the WS upgrade routes the call loop's recognizer uses
// instead of talking to the cloud vendors from the page (keys never reach the
// browser — the same rule the TTS bridge lives by).
//
//   WS /voice-asr/qwen  — DashScope qwen3-asr-flash-realtime (Bearer auth)
//   WS /voice-asr/xfyun — iFlytek 流式听写 iat (HMAC-signed handshake)
//
// Browser thin protocol (JSON text frames + binary PCM frames):
//   → hello{lang?, model?, endpoint?}      one per connection, opens upstream
//   → binary frames                        raw 16k/16-bit/mono PCM chunks
//   → bye
//   ← ready
//   ← activity                             vendor VAD heard speech onset
//   ← interim{text} / final{text} / error{error}
//
// Upstream protocol (DashScope realtime, same event family as tts-qwen.ts):
//   session.update {modalities:['text'], enable_input_audio_transcription:
//     true, input_audio_transcription:{language,input_audio_format:'pcm',
//     input_sample_rate:16000}}
//   input_audio_buffer.append {audio:<base64>}
//   → conversation.item.input_audio_transcription.text       (partial, text+stash)
//   → conversation.item.input_audio_transcription.completed  (final transcript)
//
// No scheduled rotation for qwen: the realtime session has no vendor session
// length cap (unlike iFlytek's 60s); the stream keeps flowing while the mic
// is open, which doubles as the keep-alive. Unexpected drops reconnect on
// the browser side with backoff.
//
// Upstream protocol (iFlytek iat — one connection per utterance):
//   handshake with authorization/date/host query params (HMAC-SHA256, the
//   exact scheme tts-bridge signs its TTS sessions with);
//   first frame {common{app_id}, business{language,domain,accent,ptt},
//   data{status:0,format,encoding,audio}} then status:1 frames;
//   results accumulate piece by piece (no dynamic correction) — the bridge
//   joins them into the running utterance and reports the whole thing as
//   interim, and on data.status:2 hands the joined text over as final.
//   The engine ends the utterance itself after the back-end-point silence
//   (eos, default 2000ms) and closes — the browser rotates to a fresh
//   connection for the next utterance.

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { createHmac } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { resolveApiKey } from './tts-qwen.ts'
import { BridgeError, bridgeErrorPayload } from './bridge-error.ts'

/** Shipped preset (a settings draft may override per connection). */
export const QWEN_ASR_MODEL = 'qwen3-asr-flash-realtime'
const QWEN_ASR_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'

/** Upstream guard: a browser session silent this long is torn down. */
const IDLE_TIMEOUT_MS = 120_000

/** Map a BCP-47 tag to the vendor's transcription language ('zh'/'en'/…). */
function asrLanguage(lang: string | undefined): string {
  const tag = (lang ?? '').trim().toLowerCase()
  if (tag === '') return 'zh'
  if (tag.startsWith('zh')) return 'zh'
  return tag.split('-')[0] ?? 'zh'
}

/** The session.update body: text-only modality, transcription config on. */
function sessionConfig(lang: string): Record<string, unknown> {
  return {
    modalities: ['text'],
    enable_input_audio_transcription: true,
    input_audio_transcription: {
      language: lang,
      input_audio_format: 'pcm',
      input_sample_rate: 16_000,
    },
    // The vendor VAD only splits the stream into sentences (the loop's own
    // silence timer owns submission), but its defaults are too dull for
    // close-mic speech: threshold 0.2 reads quiet stretches as silence and
    // cuts a sentence there, stalling the next item's partials while the
    // user is still talking. Force the documented recommendation (0.0); the
    // 800ms end-point stays, since the loop's flush window assumes it.
    turn_detection: {
      type: 'server_vad',
      threshold: 0.0,
      silence_duration_ms: 800,
    },
  }
}

interface AsrUpstream {
  appendAudio(chunk: Buffer): void
  close(): void
}

interface AsrUpstreamHandlers {
  onPartial(text: string): void
  onFinal(text: string): void
  /** The vendor's VAD heard speech onset (no text yet): a liveness signal the
   *  loop must not mistake for the user pausing. */
  onActivity(): void
  onError(message: string): void
  /** Upstream ended without a final (network drop, vendor cap) — the bridge
   *  closes the browser link quietly so it reconnects with a fresh session. */
  onClosed(): void
}

type AsrWireEvent = {
  type?: string
  text?: string
  stash?: string
  transcript?: string
  error?: { code?: string; message?: string }
}

interface AsrSessionParams {
  lang: string
  model?: string
  endpoint?: string
}

/**
 * Open one upstream realtime recognition session: session.update on open,
 * appended PCM rides input_audio_buffer.append as base64, transcription
 * events surface through the handlers. Resolves once the session accepts
 * audio appends; rejects on handshake/auth failure.
 */
async function openQwenUpstream(apiKey: string, params: AsrSessionParams, handlers: AsrUpstreamHandlers): Promise<AsrUpstream> {
  // await import, NOT require('ws'): the node half ships as an ESM bundle and
  // a plain require() there is an esbuild stub that throws at runtime.
  const { WebSocket } = await import('ws')
  return new Promise<AsrUpstream>((resolveUp, rejectUp) => {
    let live = false
    let settled = false
    let ended = false
    let eventSeq = 0
    const model = params.model?.trim() || QWEN_ASR_MODEL
    const endpoint = (params.endpoint?.trim() || QWEN_ASR_ENDPOINT).replace(/\/+$/, '')
    const socket = new WebSocket(`${endpoint}?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      handshakeTimeout: 15_000,
    })
    // settled ≠ live: a handshake failure settles with the rejection BEFORE
    // the socket close event runs, so the close handler must not swallow the
    // reason by tearing the browser link down first (tearDown drops frames).
    const settleUp = (error: Error): void => {
      if (settled) return
      settled = true
      try { socket.close() } catch { /* already down */ }
      rejectUp(error)
    }
    const send = (payload: Record<string, unknown>): void => {
      try { socket.send(JSON.stringify(payload)) } catch { /* raced down */ }
    }
    socket.on('open', () => {
      if (settled) return
      settled = true
      live = true
      send({ type: 'session.update', session: sessionConfig(params.lang) })
      resolveUp({
        appendAudio: chunk => send({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') }),
        close: () => {
          ended = true
          try { socket.close() } catch { /* already down */ }
        },
      })
    })
    socket.on('message', (data: Buffer) => {
      let event: AsrWireEvent
      try {
        event = JSON.parse(data.toString('utf8')) as AsrWireEvent
      } catch {
        return
      }
      if (event.type === 'input_audio_buffer.speech_started') {
        handlers.onActivity()
        return
      }
      if (event.type === 'conversation.item.input_audio_transcription.text') {
        // Partial: `text` is the settled prefix, `stash` the live tail.
        handlers.onPartial(`${event.text ?? ''}${event.stash ?? ''}`)
        return
      }
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        handlers.onFinal(event.transcript ?? '')
        return
      }
      if (event.type === 'error') {
        const detail = event.error?.message ?? event.error?.code ?? '未知错误'
        ended = true
        handlers.onError(`千问识别失败：${detail}`)
        try { socket.close() } catch { /* already down */ }
      }
    })
    socket.on('close', () => {
      // A quiet upstream drop is NOT fatal: the browser reconnects and the
      // hello opens a fresh session (only vendor `error` frames are fatal).
      if (live && !ended) {
        ended = true
        handlers.onClosed()
      }
      settleUp(new Error('千问识别连接中断'))
    })
    socket.on('error', (error: Error) => settleUp(new Error(`千问识别连接失败：${error.message}`)))
  })
}

/* ---- iFlytek iat upstream -------------------------------------------------- */

/** iFlytek iat language codes (the settings' voiceLang maps in). */
function iatLanguage(lang: string): string {
  return lang.startsWith('en') ? 'en_us' : 'zh_cn'
}

interface IatResultFrame {
  code?: number
  message?: string
  data?: {
    status?: number
    result?: { ws?: Array<{ cw?: Array<{ w?: string }> }> }
  }
}

/**
 * Open one iFlytek iat upstream session: HMAC-signed handshake, PCM chunks
 * ride base64 data frames, result pieces accumulate into the running
 * utterance (the engine ends the turn on its own after the eos silence).
 */
async function openXfyunUpstream(ctx: Context, lang: string, endpointOverride: string | undefined, handlers: AsrUpstreamHandlers): Promise<AsrUpstream> {
  const creds = ctx.get('credentials')
  if (creds === undefined) throw new BridgeError('credentials-unavailable', '凭证服务不可用')
  const [appId, apiKey, apiSecret] = await Promise.all([
    creds.resolve(credentialRef('VOICE_XF_APP_ID')).catch(() => undefined),
    creds.resolve(credentialRef('VOICE_XF_API_KEY')).catch(() => undefined),
    creds.resolve(credentialRef('VOICE_XF_API_SECRET')).catch(() => undefined),
  ])
  if (appId?.value === undefined || appId.value === '' || apiKey?.value === undefined || apiKey.value === '' || apiSecret?.value === undefined || apiSecret.value === '') {
    throw new BridgeError('missing-xfyun-credentials', '未配置讯飞凭证：设置 → 语音对话 → 讯飞 → 设置，填写 App ID / API Key / API Secret')
  }
  const { WebSocket } = await import('ws')
  // Same HMAC-SHA256 handshake scheme the TTS bridge signs (authorization /
  // date / host query params from host:date/request-line).
  const base = new URL(endpointOverride?.trim() || 'wss://iat-api.xfyun.cn/v2/iat')
  const host = base.hostname
  const date = new Date().toUTCString()
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${base.pathname} HTTP/1.1`
  const signature = createHmac('sha256', apiSecret!.value).update(signatureOrigin).digest('base64')
  const authorizationOrigin = `api_key="${apiKey!.value}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  base.searchParams.set('authorization', Buffer.from(authorizationOrigin, 'utf8').toString('base64'))
  base.searchParams.set('date', date)
  base.searchParams.set('host', host)
  return await new Promise<AsrUpstream>((resolveUp, rejectUp) => {
    let live = false
    let settled = false
    let ended = false
    let sentFirst = false
    let acc = ''
    const socket = new WebSocket(base.toString(), { handshakeTimeout: 15_000 })
    const settleUp = (error: Error): void => {
      if (settled) return
      settled = true
      try { socket.close() } catch { /* already down */ }
      rejectUp(error)
    }
    socket.on('open', () => {
      if (settled) return
      settled = true
      live = true
      resolveUp({
        appendAudio: chunk => {
          const status = sentFirst ? 1 : 0
          sentFirst = true
          try {
            socket.send(JSON.stringify({
              ...(status === 0 ? {
                common: { app_id: appId!.value },
                business: {
                  language: iatLanguage(lang),
                  domain: 'iat',
                  accent: 'mandarin',
                  // ptt: 1 — punctuation on (the loop submits with it).
                  ptt: 1,
                },
              } : {}),
              data: {
                status,
                format: 'audio/L16;rate=16000',
                encoding: 'raw',
                audio: chunk.toString('base64'),
              },
            }))
          } catch { /* raced down */ }
        },
        close: () => {
          ended = true
          try { socket.close() } catch { /* already down */ }
        },
      })
    })
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return
      let message: { code?: number; message?: string; data?: { status?: number; result?: { ws?: Array<{ cw?: Array<{ w?: string }> }> } } }
      try {
        message = JSON.parse(data.toString('utf8'))
      } catch {
        return
      }
      if (message.code !== 0 && message.code !== undefined) {
        ended = true
        handlers.onError(`讯飞识别失败（${message.code}）：${message.message ?? '未知错误'}`)
        try { socket.close() } catch { /* already down */ }
        return
      }
      const words = message.data?.result?.ws
        ?.map(w => (w.cw ?? []).map(c => c.w ?? '').join(''))
        .join('') ?? ''
      if (words !== '') acc += words
      handlers.onPartial(acc)
      if (message.data?.status === 2) {
        ended = true
        handlers.onFinal(acc)
        try { socket.close() } catch { /* already down */ }
      }
    })
    socket.on('close', () => {
      if (live && !ended) {
        ended = true
        handlers.onClosed()
      }
      settleUp(new Error('讯飞识别连接中断'))
    })
    socket.on('error', (error: Error) => settleUp(new Error(`讯飞识别连接失败：${error.message}`)))
    // Handshake rejection surfaces as an HTTP-level response, not a socket error.
    socket.on('unexpected-response', (_req, res) => {
      const body = (res as unknown as { on?: (ev: string, cb: (d: Buffer) => void) => void })
      let text = ''
      body?.on?.('data', d => { text += d.toString('utf8') })
      body?.on?.('end', () => settleUp(new Error(`讯飞识别握手被拒：${res.statusCode} ${text.slice(0, 200)}`)))
      setTimeout(() => settleUp(new Error(`讯飞识别握手被拒：${res.statusCode}`)), 200)
    })
  })
}

/* ---- browser-facing upgrade routes ---------------------------------------- */

/** Browser thin protocol frames (client → host, JSON text frames). */
interface AsrClientFrame {
  type?: string
  lang?: string
  model?: string
  endpoint?: string
}

let asrClientWss: import('ws').WebSocketServer | null = null

/** Register the `/voice-asr/<vendor>` HTTP upgrade (mirrors /voice-tts/qwen). */
export function registerAsrUpgrade(ctx: Context, vendor: 'qwen' | 'xfyun'): WebUpgradeRoute {
  return {
    path: `/voice-asr/${vendor}`,
    handler: async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const { WebSocketServer } = await import('ws')
      asrClientWss ??= new WebSocketServer({ noServer: true })
      asrClientWss.handleUpgrade(req, socket, head, ws => { void serveAsrClient(ctx, ws, vendor) })
    },
  }
}

/** Kept for the tts-qwen-era import sites; same as registerAsrUpgrade(ctx,'qwen'). */
export function registerQwenAsrUpgrade(ctx: Context): WebUpgradeRoute {
  return registerAsrUpgrade(ctx, 'qwen')
}

async function serveAsrClient(ctx: Context, ws: import('ws').WebSocket, vendor: 'qwen' | 'xfyun'): Promise<void> {
  let upstream: AsrUpstream | null = null
  let closed = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const bumpIdle = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => tearDown(), IDLE_TIMEOUT_MS)
  }
  const sendJson = (payload: Record<string, unknown>): void => {
    if (closed) return
    try { ws.send(JSON.stringify(payload)) } catch { /* socket raced down */ }
  }
  const tearDown = (): void => {
    if (closed) return
    closed = true
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = null
    upstream?.close()
    upstream = null
    try { ws.close() } catch { /* already down */ }
  }
  /** Vendor-agnostic events → the browser's thin protocol. iat is one
   *  connection per utterance: after its final, the bridge drops the browser
   *  link so the browser's reconnect lands on a fresh upstream session. */
  const upstreamOut = {
    onPartial: (text: string): void => { if (text !== '') sendJson({ type: 'interim', text }) },
    onFinal: (text: string): void => {
      sendJson({ type: 'final', text })
      if (vendor === 'xfyun') tearDown()
    },
    onActivity: (): void => { sendJson({ type: 'activity' }) },
    onError: (message: string): void => {
      sendJson({ type: 'error', error: message })
      tearDown()
    },
    onClosed: () => tearDown(),
  }
  ws.on('close', () => tearDown())
  ws.on('error', () => tearDown())
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (closed) return
    if (!isBinary) {
      bumpIdle()
      let frame: AsrClientFrame
      try {
        frame = JSON.parse(data.toString('utf8')) as AsrClientFrame
      } catch {
        return
      }
      if (frame.type === 'hello') {
        upstream?.close()
        upstream = null
        void (async () => {
          try {
            const lang = asrLanguage(frame.lang)
            upstream = vendor === 'qwen'
              ? await openQwenUpstream(await resolveApiKey(ctx), {
                lang,
                model: frame.model,
                endpoint: frame.endpoint,
              }, upstreamOut)
              : await openXfyunUpstream(ctx, lang, frame.endpoint, upstreamOut)
            sendJson({ type: 'ready' })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error('[voice-asr] hello 失败:', vendor, message)
            // Send past the closed-guard: the upstream close event can race the
            // rejection here, and the browser must still learn WHY it failed.
            try { ws.send(JSON.stringify({ type: 'error', ...bridgeErrorPayload(error) })) } catch { /* down */ }
            tearDown()
          }
        })()
        return
      }
      if (frame.type === 'bye') tearDown()
      return
    }
    // Binary = one raw PCM chunk from the browser mic.
    bumpIdle()
    upstream?.appendAudio(data)
  })
}
