// Qwen-TTS Realtime bridge (DashScope). One file owns the whole vendor
// protocol — the rest of the plugin never sees DashScope specifics.
//
// Two consumers:
//   • the browser WS upgrade `/voice-tts/qwen` — the call loop's streaming
//     session (browser thin protocol → DashScope realtime events);
//   • `synthQwenOnce` — the settings-page try-listen (whole text → WAV).
//
// Credentials never reach the browser: the API key is resolved host-side per
// connection. Model/endpoint may be overridden per request (settings drafts),
// the constants below are the shipped presets.
//
// DashScope protocol (official realtime API reference):
//   connect  wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=<model>
//   auth     Authorization: Bearer <DASHSCOPE_API_KEY>
//   client   session.update / input_text_buffer.append / session.finish
//   server   response.audio.delta (base64 pcm) / response.done /
//            session.finished / error{code,message}

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { BridgeError, bridgeErrorPayload } from './bridge-error.ts'
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'

/** Shipped presets (settings may override both per theme). */
export const QWEN_DEFAULT_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
export const QWEN_DEFAULT_MODEL = 'qwen3-tts-flash-realtime'

/** Upstream guard: a browser session silent this long is torn down. */
const IDLE_TIMEOUT_MS = 120_000

/** Session parameters (voice/rate from settings; model/endpoint overridable). */
export interface QwenSessionParams {
  voice: string
  rate: number
  model?: string
  endpoint?: string
}

interface QwenUpstream {
  append(text: string): void
  finish(): void
  close(): void
  /** TEMP usage meter snapshot (diagnosis only). */
  stats(): QwenUsageStats
}

/** TEMP usage meter: local append volume + the vendor's own usage report. */
interface QwenUsageStats {
  /** Characters appended to the vendor (JS string length). */
  appended: number
  /** Official billing count of the appended text (a hanzi counts as 2). */
  billedChars: number
  /** Audio seconds returned by the vendor (24 kHz 16-bit mono). */
  audioSec: number
}

/** Official TTS billing-count rule: a hanzi counts as 2, everything else
 *  (including CJK punctuation and kana) as 1. Validated against the bill:
 *  the bill's per-minute 字 quantity matches this count exactly. */
function billingChars(text: string): number {
  let count = 0
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0
    const hanzi = (cp >= 0x3400 && cp <= 0x4dbf)
      || (cp >= 0x4e00 && cp <= 0x9fff)
      || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0x20000 && cp <= 0x2fa1f)
    count += hanzi ? 2 : 1
  }
  return count
}

interface QwenUpstreamHandlers {
  onAudio(chunk: Buffer): void
  onFinished(): void
  onError(message: string): void
}

/** Resolve the DashScope API key host-side (shared with the ASR bridge). */
export async function resolveApiKey(ctx: Context): Promise<string> {
  const creds = ctx.get('credentials')
  if (creds === undefined) throw new BridgeError('credentials-unavailable', '凭证服务不可用')
  const view = await creds.resolve(credentialRef('VOICE_QWEN_API_KEY')).catch(() => undefined)
  const key = view?.value
  if (key === undefined || key === '') {
    throw new BridgeError('missing-qwen-credentials', '未配置千问凭证：设置 → 语音对话 → 阿里千问 → 设置，粘贴 DashScope API Key')
  }
  return key
}

/** DashScope realtime URL with the model query appended. */
function upstreamUrl(params: QwenSessionParams): string {
  const endpoint = (params.endpoint?.trim() || QWEN_DEFAULT_ENDPOINT).replace(/\/+$/, '')
  const model = params.model?.trim() || QWEN_DEFAULT_MODEL
  return `${endpoint}?model=${encodeURIComponent(model)}`
}

/** The session.update body: server_commit keeps prosody across sentences. */
function sessionConfig(params: QwenSessionParams): Record<string, unknown> {
  return {
    voice: params.voice === '' ? 'Cherry' : params.voice,
    mode: 'server_commit',
    language_type: 'Auto',
    response_format: 'pcm',
    sample_rate: 24_000,
    // speech_rate 0.5–2.0, 1.0 normal — the rate slider maps 1:1.
    speech_rate: Math.min(2, Math.max(0.5, params.rate || 1)),
  }
}

type WireEvent = { type?: string; error?: { code?: string; message?: string }; delta?: string }

/**
 * Open one upstream realtime session: session.update on open, appended text
 * rides the server_commit buffer (the vendor picks synthesis moments), audio
 * deltas surface through `onAudio` as raw PCM bytes. Resolves once the
 * session accepts appends; rejects on handshake/auth failure.
 */
async function openUpstream(apiKey: string, params: QwenSessionParams, handlers: QwenUpstreamHandlers): Promise<QwenUpstream> {
  // await import, NOT require('ws'): the node half ships as an ESM bundle
  // and a plain require() there is an esbuild stub that throws at runtime.
  const { WebSocket } = await import('ws')
  return new Promise<QwenUpstream>((resolveUp, rejectUp) => {
    let ready = false
    let ended = false
    let eventSeq = 0
    // TEMP usage meter (diagnosis only).
    let appended = 0
    let billed = 0
    let audioBytes = 0
    const socket = new WebSocket(upstreamUrl(params), {
      headers: { Authorization: `Bearer ${apiKey}` },
      handshakeTimeout: 15_000,
    })
    const settleUp = (error: Error): void => {
      if (ready) return
      ready = true
      try { socket.close() } catch { /* already down */ }
      rejectUp(error)
    }
    const send = (payload: Record<string, unknown>): void => {
      eventSeq += 1
      try { socket.send(JSON.stringify({ event_id: `dsh-${eventSeq}`, ...payload })) } catch { /* raced down */ }
    }
    socket.on('open', () => {
      ready = true
      send({ type: 'session.update', session: sessionConfig(params) })
      resolveUp({
        append: text => {
          appended += text.length
          billed += billingChars(text)
          send({ type: 'input_text_buffer.append', text })
        },
        finish: () => send({ type: 'session.finish' }),
        close: () => {
          ended = true
          try { socket.close() } catch { /* already down */ }
        },
        stats: () => ({ appended, billedChars: billed, audioSec: audioBytes / 48_000 }),
      })
    })
    socket.on('message', (data: Buffer) => {
      let event: WireEvent
      try {
        event = JSON.parse(data.toString('utf8')) as WireEvent
      } catch {
        return
      }
      if (event.type === 'response.audio.delta' && event.delta !== undefined && event.delta !== '') {
        const chunk = Buffer.from(event.delta, 'base64')
        audioBytes += chunk.length
        handlers.onAudio(chunk)
        return
      }
      if (event.type === 'session.finished') {
        ended = true
        handlers.onFinished()
        try { socket.close() } catch { /* already down */ }
        return
      }
      if (event.type === 'error') {
        const detail = event.error?.message ?? event.error?.code ?? '未知错误'
        // TEMP diagnostic trace (lookahead pacing).
        console.log('[voice-tts-trace] upstream-error', detail)
        ended = true
        handlers.onError(`千问合成失败：${detail}`)
        try { socket.close() } catch { /* already down */ }
      }
    })
    socket.on('close', () => {
      if (!ended) {
        ended = true
        handlers.onError('千问连接中断')
      }
      settleUp(new Error('千问连接中断'))
    })
    socket.on('error', (error: Error) => settleUp(new Error(`千问连接失败：${error.message}`)))
  })
}

/** Try-listen: one upstream session for the whole text → WAV (24k mono). */
export async function synthQwenOnce(ctx: Context, text: string, params: QwenSessionParams): Promise<Buffer> {
  const apiKey = await resolveApiKey(ctx)
  const { WebSocket } = await import('ws')
  const chunks: Buffer[] = []
  // TEMP usage meter (diagnosis only).
  const startedAt = Date.now()
  await new Promise<void>((resolve, reject) => {
    let ended = false
    let eventSeq = 0
    const socket = new WebSocket(upstreamUrl(params), {
      headers: { Authorization: `Bearer ${apiKey}` },
      handshakeTimeout: 15_000,
    })
    const timer = setTimeout(() => {
      ended = true
      try { socket.close() } catch { /* already down */ }
      reject(new Error('千问合成超时'))
    }, 90_000)
    const settle = (error?: Error): void => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      try { socket.close() } catch { /* already down */ }
      if (error !== undefined) reject(error)
      else resolve()
    }
    const send = (payload: Record<string, unknown>): void => {
      eventSeq += 1
      socket.send(JSON.stringify({ event_id: `dsh-${eventSeq}`, ...payload }))
    }
    socket.on('open', () => {
      send({ type: 'session.update', session: sessionConfig(params) })
      send({ type: 'input_text_buffer.append', text })
      send({ type: 'session.finish' })
    })
    socket.on('message', (data: Buffer) => {
      let event: WireEvent
      try {
        event = JSON.parse(data.toString('utf8')) as WireEvent
      } catch {
        return
      }
      if (event.type === 'response.audio.delta' && event.delta !== undefined && event.delta !== '') {
        chunks.push(Buffer.from(event.delta, 'base64'))
        return
      }
      if (event.type === 'session.finished') settle()
      if (event.type === 'error') {
        settle(new Error(`千问合成失败：${event.error?.message ?? event.error?.code ?? '未知错误'}`))
      }
    })
    socket.on('close', () => settle(new Error('千问连接中断')))
    socket.on('error', (error: Error) => settle(new Error(`千问连接失败：${error.message}`)))
  })
  const pcm = Buffer.concat(chunks)
  if (pcm.length === 0) throw new Error('千问合成返回了空音频')
  console.log(
    `[voice-usage] tts-trylisten model=${params.model?.trim() || QWEN_DEFAULT_MODEL} chars=${text.length} ` +
    `billedChars=${billingChars(text)} audioSec=${(pcm.length / 48_000).toFixed(2)} ` +
    `sessionMs=${Date.now() - startedAt} est=¥${(billingChars(text) / 10_000).toFixed(4)}`,
  )
  return wavFromPcm24k(pcm)
}

/** Wrap raw 24 kHz 16-bit mono PCM in a minimal 44-byte WAV container. */
export function wavFromPcm24k(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(24_000, 24)
  header.writeUInt32LE(24_000 * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/* ---- browser-facing upgrade route ----------------------------------------- */

/** Browser thin protocol frames (client → host, JSON text frames). */
interface ClientFrame {
  type?: string
  voice?: string
  rate?: number
  model?: string
  endpoint?: string
  text?: string
  /** TEMP diagnostic: playback-hole counters sent right before the close. */
  count?: number
  maxMs?: number
  totalMs?: number
}

let clientWss: import('ws').WebSocketServer | null = null

/**
 * Register the `/voice-tts/qwen` HTTP upgrade. The browser speaks the thin
 * protocol — `hello{voice,rate,model,endpoint}`, `append{text}`, `finish` as
 * JSON text frames; PCM returns as binary frames; `finished`/`error` as JSON.
 */
export function registerQwenUpgrade(ctx: Context): WebUpgradeRoute {
  return {
    path: '/voice-tts/qwen',
    handler: async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const { WebSocketServer } = await import('ws')
      clientWss ??= new WebSocketServer({ noServer: true })
      clientWss.handleUpgrade(req, socket, head, ws => { void serveQwenClient(ctx, ws) })
    },
  }
}

async function serveQwenClient(ctx: Context, ws: import('ws').WebSocket): Promise<void> {
  let upstream: QwenUpstream | null = null
  let closed = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  // TEMP usage meter (diagnosis only).
  let sessionStart = 0
  let model = QWEN_DEFAULT_MODEL
  let voice = ''
  let endReason = 'ws-close'
  let usageLogged = false
  /** TEMP diagnostic: the client's playback holes for this session. */
  let gapStats: { count: number; maxMs: number; totalMs: number } | null = null
  const bumpIdle = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => tearDown('idle-teardown'), IDLE_TIMEOUT_MS)
  }
  const sendJson = (payload: Record<string, unknown>): void => {
    if (closed) return
    try { ws.send(JSON.stringify(payload)) } catch { /* socket raced down */ }
  }
  const tearDown = (reason?: string): void => {
    if (closed) return
    closed = true
    if (reason !== undefined) endReason = reason
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = null
    const stats = upstream?.stats() ?? null
    if (stats !== null && !usageLogged) {
      usageLogged = true
      // Char-billed (hanzi count as 2): the local count is the billing basis.
      console.log(
        `[voice-usage] tts model=${model} voice=${voice === '' ? 'default' : voice} chars=${stats.appended} ` +
        `billedChars=${stats.billedChars} audioSec=${stats.audioSec.toFixed(2)} ` +
        `gaps=${gapStats?.count ?? '-'} maxGapMs=${gapStats?.maxMs ?? '-'} totalGapMs=${gapStats?.totalMs ?? '-'} ` +
        `sessionMs=${sessionStart === 0 ? 0 : Date.now() - sessionStart} ended=${endReason} ` +
        `est=¥${(stats.billedChars / 10_000).toFixed(4)}`,
      )
    }
    upstream?.close()
    upstream = null
    try { ws.close() } catch { /* already down */ }
  }
  ws.on('close', () => tearDown('ws-close'))
  ws.on('error', () => tearDown('ws-error'))
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary || closed) return
    bumpIdle()
    let frame: ClientFrame
    try {
      frame = JSON.parse(data.toString('utf8')) as ClientFrame
    } catch {
      return
    }
    if (frame.type === 'hello') {
      upstream?.close()
      upstream = null
      sessionStart = Date.now()
      model = frame.model?.trim() || QWEN_DEFAULT_MODEL
      voice = frame.voice ?? ''
      void (async () => {
        try {
          const apiKey = await resolveApiKey(ctx)
          const params: QwenSessionParams = {
            voice: frame.voice ?? '',
            rate: typeof frame.rate === 'number' ? frame.rate : 1,
            model: frame.model,
            endpoint: frame.endpoint,
          }
          upstream = await openUpstream(apiKey, params, {
            onAudio: chunk => {
              if (!closed) {
                // The client sends nothing while it plays the stream: incoming
                // audio is the liveness signal that must keep the session off
                // the 120 s client-idle teardown.
                bumpIdle()
                try { ws.send(chunk, { binary: true }) } catch { /* raced down */ }
              }
            },
            onFinished: () => sendJson({ type: 'finished' }),
            onError: message => {
              sendJson({ type: 'error', error: message })
              tearDown('upstream-error')
            },
          })
          sendJson({ type: 'ready' })
        } catch (error) {
          sendJson({ type: 'error', ...bridgeErrorPayload(error) })
          tearDown('hello-fail')
        }
      })()
      return
    }
    if (frame.type === 'append') {
      const text = frame.text ?? ''
      if (text !== '') upstream?.append(text)
      return
    }
    if (frame.type === 'finish') {
      upstream?.finish()
      return
    }
    if (frame.type === 'gapstats') {
      gapStats = { count: frame.count ?? 0, maxMs: frame.maxMs ?? 0, totalMs: frame.totalMs ?? 0 }
      return
    }
    if (frame.type === 'bye') tearDown('bye')
  })
}
