// Host-side TTS bridge: HTTP routes the call overlay calls instead of
// talking to cloud vendors directly (no CORS, keys never reach the page).
//
// Routes:
//   GET  /voice-tts/status   — per-provider credential presence (booleans)
//   POST /voice-tts/xfyun    — iFlytek streaming TTS → mp3
//   POST /voice-tts/qwen     — DashScope realtime TTS (one session) → wav
//
// The qwen streaming session rides the `/voice-tts/qwen` WebSocket upgrade
// (src/tts-qwen.ts); this file only owns the one-shot HTTP surface.
//
// Keys live in the dsh credential store (VOICE_* references), resolved per
// request — a rotated key reaches the next synthesis without a restart.

import type { Context } from '@deepseek-ai/cordis'
import { createHmac } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { synthQwenOnce, type QwenSessionParams } from './tts-qwen.ts'

const TTS_BRIDGE_PREFIX = '/voice-tts'

/** Credential references each cloud provider reads, by provider id. */
const PROVIDER_REFS: Record<string, readonly string[]> = {
  xfyun: ['VOICE_XF_APP_ID', 'VOICE_XF_API_KEY', 'VOICE_XF_API_SECRET'],
  qwen: ['VOICE_QWEN_API_KEY'],
}

/** Vendor default endpoints, overridable per request (`endpoint` in the body). */
const PROVIDER_ENDPOINTS: Record<string, string> = {
  xfyun: 'wss://tts-api.xfyun.cn/v2/tts',
}

/** Content type each provider's synthesis returns. */
const PROVIDER_CONTENT_TYPES: Record<string, string> = {
  xfyun: 'audio/mpeg',
  qwen: 'audio/wav',
}

/** Body fields shared by every synthesis route. */
interface SynthBody {
  text?: string
  voice?: string
  rate?: number
  model?: string
  endpoint?: string
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readJson<T>(req: import('node:http').IncomingMessage): Promise<T | undefined> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

/** Voice bridge over the host context: credentials + the routes themselves. */
export function makeVoiceTtsRoutes(ctx: Context): WebRoute[] {
  const credentials = (): Context['credentials'] | undefined => ctx.get('credentials')

  const status: WebRoute = {
    kind: 'exact',
    path: `${TTS_BRIDGE_PREFIX}/status`,
    handler: async (req, res) => {
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
      const creds = credentials()
      if (creds === undefined) return json(res, 200, { providers: {} })
      const providers: Record<string, boolean> = {}
      for (const [provider, refs] of Object.entries(PROVIDER_REFS)) {
        const views = await Promise.all(refs.map(async ref => creds.describe(credentialRef(ref)).catch(() => undefined)))
        providers[provider] = views.every(view => view?.configured === true)
      }
      return json(res, 200, { providers })
    },
  }

  /** Shared synthesis dispatch: POST { text, voice, rate, … } → audio bytes. */
  const synthRoute = (provider: string): WebRoute => ({
    kind: 'exact',
    path: `${TTS_BRIDGE_PREFIX}/${provider}`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
      const body = (await readJson<SynthBody>(req)) ?? {}
      const text = body?.text?.trim() ?? ''
      const voice = body?.voice?.trim() || ''
      const rate = typeof body?.rate === 'number' ? body.rate : 1
      if (text === '') return json(res, 400, { error: '文本为空' })
      const synth = SYNTHS[provider]
      if (synth === undefined) return json(res, 404, { error: '未知供应商' })
      try {
        const audio = await synth(ctx, text, voice, rate, body)
        res.writeHead(200, {
          'content-type': PROVIDER_CONTENT_TYPES[provider] ?? 'audio/mpeg',
          'cache-control': 'no-store',
        })
        res.end(audio)
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  return [status, synthRoute('xfyun'), synthRoute('qwen')]
}

/** Per-provider synthesis entry points (text+voice+rate → audio bytes). */
const SYNTHS: Record<string, (ctx: Context, text: string, voice: string, rate: number, body: SynthBody) => Promise<Buffer>> = {
  xfyun: (ctx, text, voice, rate, body) => synthXfyun(ctx, text, voice, rate, body.endpoint),
  qwen: (ctx, text, voice, rate, body) => {
    const params: QwenSessionParams = { voice, rate, model: body.model, endpoint: body.endpoint }
    return synthQwenOnce(ctx, text, params)
  },
}

/* ---- per-provider synthesis implementations ---- */

/** iFlytek streaming TTS over WebSocket (Bearer auth, mp3 frames). */
async function synthXfyun(
  ctx: Context, text: string, voice: string, rate: number, endpointOverride?: string,
): Promise<Buffer> {
  const creds = ctx.get('credentials')
  if (creds === undefined) throw new Error('凭证服务不可用')
  const [appId, apiKey, apiSecret] = await Promise.all([
    creds.resolve(credentialRef('VOICE_XF_APP_ID')).catch(() => undefined),
    creds.resolve(credentialRef('VOICE_XF_API_KEY')).catch(() => undefined),
    creds.resolve(credentialRef('VOICE_XF_API_SECRET')).catch(() => undefined),
  ])
  if (apiKey?.value === undefined || apiKey.value === '' || apiSecret?.value === undefined || apiSecret.value === '' || appId?.value === undefined || appId.value === '') {
    throw new Error('未配置讯飞凭证：设置 → 语音对话 → 讯飞 → 设置，填写 App ID / API Key / API Secret')
  }
  const { WebSocket } = await import('ws')
  // iFlytek WebSocket auth ≠ Bearer. It wants three query params derived from
  // an HMAC-SHA256 signature (authorization / date / host); a Bearer header
  // always 401s. Signature origin is host/date/request-line.
  const base = new URL(endpointOverride?.trim() || PROVIDER_ENDPOINTS.xfyun!)
  base.searchParams.set('output_proto', 'binary')
  const host = base.hostname
  const date = new Date().toUTCString()
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${base.pathname} HTTP/1.1`
  const signature = createHmac('sha256', apiSecret!.value).update(signatureOrigin).digest('base64')
  const authorizationOrigin = `api_key="${apiKey!.value}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  base.searchParams.set('authorization', Buffer.from(authorizationOrigin, 'utf8').toString('base64'))
  base.searchParams.set('date', date)
  base.searchParams.set('host', host)
  return await new Promise<Buffer>((resolve, reject) => {
    const socket = new WebSocket(base.toString(), {
      handshakeTimeout: 15_000,
    })
    const audio: Buffer[] = []
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('讯飞合成超时'))
    }, 60_000)
    socket.on('error', (error: Error) => {
      clearTimeout(timer)
      reject(new Error(`讯飞连接失败：${error.message}`))
    })
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // Binary proto: first 3 bytes are a header of length byte[0]; the rest
        // is mp3 payload for this frame.
        const headerSize = data[0]!
        audio.push(data.subarray(headerSize))
        return
      }
      let message: { code?: number; message?: string; data?: { status?: number; audio?: string } }
      try {
        message = JSON.parse(data.toString('utf8'))
      } catch {
        return
      }
      if (message.code !== 0 && message.code !== undefined) {
        clearTimeout(timer)
        socket.close()
        reject(new Error(`讯飞合成失败（${message.code}）：${message.message ?? '未知错误'}`))
        return
      }
      if (message.data?.audio !== undefined && message.data.audio !== '') {
        audio.push(Buffer.from(message.data.audio, 'base64'))
      }
      if (message.data?.status === 2) {
        clearTimeout(timer)
        socket.close()
        const out = Buffer.concat(audio)
        if (out.length === 0) reject(new Error('讯飞合成返回了空音频'))
        else resolve(out)
      }
    })
    socket.on('open', () => {
      socket.send(JSON.stringify({
        common: { app_id: appId!.value },
        business: {
          aue: 'lame',
          sfl: 1,
          vcn: voice,
          // speed: 0..100 where 50 is normal; map rate 1x → 50, 2x → 100.
          speed: Math.round(Math.min(100, Math.max(0, rate * 50))),
          tte: 'utf8',
        },
        data: { status: 2, text: Buffer.from(text, 'utf8').toString('base64'), encoding: '' },
      }))
    })
  })
}
