// Host-side ASR bridge: the WS upgrade route the call loop's recognizer uses
// instead of talking to the cloud vendor from the page (keys never reach the
// browser — the same rule the TTS bridge lives by).
//
//   WS /voice-asr/qwen — DashScope qwen3-asr-flash-realtime (Bearer auth)
//
// Browser thin protocol (JSON text frames + binary PCM frames):
//   → hello{lang?, model?, endpoint?}      one per connection, opens upstream
//   → binary frames                        raw 16k/16-bit/mono PCM chunks
//   → bye
//   ← ready
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

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { resolveApiKey } from './tts-qwen.ts'

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
    // Server VAD stays at its documented default (800ms): the loop's own
    // silence timer owns utterance submission; the vendor's turn detection
    // just splits the stream into sentences.
  }
}

interface AsrUpstream {
  appendAudio(chunk: Buffer): void
  close(): void
}

interface AsrUpstreamHandlers {
  onPartial(text: string): void
  onFinal(text: string): void
  onError(message: string): void
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
async function openUpstream(apiKey: string, params: AsrSessionParams, handlers: AsrUpstreamHandlers): Promise<AsrUpstream> {
  // await import, NOT require('ws'): the node half ships as an ESM bundle and
  // a plain require() there is an esbuild stub that throws at runtime.
  const { WebSocket } = await import('ws')
  return new Promise<AsrUpstream>((resolveUp, rejectUp) => {
    let ready = false
    let ended = false
    let eventSeq = 0
    const model = params.model?.trim() || QWEN_ASR_MODEL
    const endpoint = (params.endpoint?.trim() || QWEN_ASR_ENDPOINT).replace(/\/+$/, '')
    const socket = new WebSocket(`${endpoint}?model=${encodeURIComponent(model)}`, {
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
      try { socket.send(JSON.stringify(payload)) } catch { /* raced down */ }
    }
    socket.on('open', () => {
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
      if (!ended) {
        ended = true
        handlers.onError('千问识别连接中断')
      }
      settleUp(new Error('千问识别连接中断'))
    })
    socket.on('error', (error: Error) => settleUp(new Error(`千问识别连接失败：${error.message}`)))
  })
}

/* ---- browser-facing upgrade route ----------------------------------------- */

/** Browser thin protocol frames (client → host, JSON text frames). */
interface AsrClientFrame {
  type?: string
  lang?: string
  model?: string
  endpoint?: string
}

let asrClientWss: import('ws').WebSocketServer | null = null

/** Register the `/voice-asr/qwen` HTTP upgrade (mirrors /voice-tts/qwen). */
export function registerQwenAsrUpgrade(ctx: Context): WebUpgradeRoute {
  return {
    path: '/voice-asr/qwen',
    handler: async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const { WebSocketServer } = await import('ws')
      asrClientWss ??= new WebSocketServer({ noServer: true })
      asrClientWss.handleUpgrade(req, socket, head, ws => { void serveAsrClient(ctx, ws) })
    },
  }
}

async function serveAsrClient(ctx: Context, ws: import('ws').WebSocket): Promise<void> {
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
            const apiKey = await resolveApiKey(ctx)
            upstream = await openUpstream(apiKey, {
              lang: asrLanguage(frame.lang),
              model: frame.model,
              endpoint: frame.endpoint,
            }, {
              onPartial: text => { if (text !== '') sendJson({ type: 'interim', text }) },
              onFinal: text => sendJson({ type: 'final', text }),
              onError: message => {
                sendJson({ type: 'error', error: message })
                tearDown()
              },
            })
            sendJson({ type: 'ready' })
          } catch (error) {
            sendJson({ type: 'error', error: error instanceof Error ? error.message : String(error) })
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
