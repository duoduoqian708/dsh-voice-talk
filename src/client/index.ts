// Voice-chat browser half: per-session voice controllers wired to the
// conversation standard kit, plus the voice surfaces — the mic button in the
// composer tool row, the status strip in the composer dock, the auto-readout
// toggle in the session header, the settings card in the plugin configuration
// tab, and the Doubao-style call overlay rendered as a page-level portal.
//
// The controller submits drafts through the conversation service's
// SessionInput facade (`ctx.conversation.input.for(sessionCtx)`), the same
// write path the composer UI uses, so voice prompts ride the normal
// adjudication + logging pipeline.
//
// Failure policy: DOM/slot problems are logged, never thrown — the web shell
// fails the whole boot when a plugin apply throws, and an external plugin
// must not take the GUI down.

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settingsScope Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ctx.remote Context merge (credentials domain types).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: IApiClient carries the credentials read/write face.
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the SlotMap merges of the conversation slots and the
// conversation Context merge (ctx.conversation).
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `shell.overlay` slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `settings.plugin.item` keyed-slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { VoiceController } from './voice-controller.ts'
import { resolveSettings, VOICE_DEFAULTS, type VoiceSettings } from './voice-settings.ts'
import { MicButton, type VoiceInjected } from './components.tsx'
import { CallOverlay } from './call-overlay.tsx'
import { VoiceSettingsCard, type VoiceCardInjected, type VoiceCardState } from './settings-card.tsx'
import { injectVoiceStyles } from './styles.ts'
import { SnapshotStore } from './store.ts'

/** Services the browser half requires (fiber inject waiting). */
export const inject = ['slots', 'sessions', 'conversation', 'settingsScope', 'connection']

/** Slots this package registers into (declared by ui-conversation/ui-settings-plugins). */
const INPUT_LEFT = 'conversation.input.left'

/** Per-session controller registry (one instance per session, grown lazily). */
const controllers = new Map<SessionId, VoiceController>()

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions
  const conversation = ctx.conversation
  const api = (ctx.get('connection') as ConnectionHandle).api
  injectVoiceStyles()

  const settingsScope: SettingsScope<VoiceSettings> = ctx.settingsScope.bind({ namespace: 'voice' })
  const settingsNow = (): VoiceSettings => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready' ? resolveSettings(snapshot.value) : {}
  }

  const controllerFor = (sessionId: SessionId): VoiceController => {
    let controller = controllers.get(sessionId)
    if (controller !== undefined) return controller
    const binding = sessions.binding(sessionId)
    if (binding === undefined) {
      throw new Error(`voice-talk: no session binding for ${sessionId}`)
    }
    controller = new VoiceController({
      input: {
        setDraft: (text) => {
          inputFor(conversation, binding.ctx)?.setDraft(text)
        },
        submit: () => {
          inputFor(conversation, binding.ctx)?.submit()
        },
      },
      notify: (level, text) => {
        try {
          inputFor(conversation, binding.ctx)?.notify(level, text)
        } catch (error) {
          console.error('[dsh-voice-talk] notify failed:', error)
        }
      },
      readSnapshot: () => binding.session.getSnapshot(),
      subscribeSnapshot: listener => binding.session.subscribe(listener),
      settings: settingsNow,
    })
    controllers.set(sessionId, controller)
    // The call overlay rides the shell overlay layer (root scope, additive
    // list, click-through): mount one per controller at creation time — it
    // renders null unless the loop is armed, so idle sessions cost nothing.
    ctx.slots.register({
      name: 'shell.overlay',
      id: `voice-call-${sessionId}`,
      inject: (): VoiceInjected => ({
        hooks: { voice: controller.status },
        transcript: controller.transcript,
        toggleVoice: () => controller.stopVoice(),
        hangUp: () => controller.stopVoice(),
        toggleMute: () => controller.toggleMute(),
        stopSpeaking: () => controller.stopSpeaking(),
        setRateOverride: rate => controller.setSessionRate(rate),
        setVoiceOverride: voice => controller.setSessionSpeaker(voice),
        setField: (field, value) => {
          void settingsScope.set(field, value).catch(error => console.error('[dsh-voice-talk] settings write failed:', error))
        },
        settings: () => {
          const resolved = controller.effectiveSettings()
          return { rate: resolved.rate, voiceName: resolved.voiceName, voiceLang: resolved.voiceLang, ttsTheme: resolved.ttsTheme, speakerByTheme: resolved.speakerByTheme, waveStyle: resolved.waveStyle, asrTheme: resolved.asrTheme }
        },
      }),
    }, CallOverlay)
    return controller
  }
  ctx.effect(() => () => {
    for (const controller of controllers.values()) controller.dispose()
    controllers.clear()
  }, 'voice-talk: controller registry')

  // Auto-readout is inherent to the loop (no toggle); the settings document
  // no longer carries an autoSpeak field.

  // Esc hangs up any active voice session (keyboard-first exit).
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      for (const controller of controllers.values()) controller.stopVoice()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, 'voice-talk: Esc hangs up')

  // The mic button is the text mode's ONLY voice affordance: one control on
  // the composer tool row. Pure on/off — click arms the loop (the call
  // overlay mounts with it), click again hangs up. No speaker, no status
  // strip: everything voice lives inside the overlay.
  ctx.slots.register({
    name: INPUT_LEFT,
    id: 'voice-mic',
    order: 20,
    inject: (sessionId): VoiceInjected => {
      const controller = controllerFor(sessionId)
      return {
        hooks: { voice: controller.status },
        toggleVoice: () => {
          if (controller.status.getSnapshot().mode === 'loop') controller.stopVoice()
          else controller.startLoop()
        },
        hangUp: () => controller.stopVoice(),
        toggleMute: () => controller.toggleMute(),
        stopSpeaking: () => controller.stopSpeaking(),
        setRateOverride: rate => controller.setSessionRate(rate),
        setVoiceOverride: voice => controller.setSessionSpeaker(voice),
        setField: (field, value) => {
          void settingsScope.set(field, value).catch(error => console.error('[dsh-voice-talk] settings write failed:', error))
        },
        settings: () => {
          const resolved = controller.effectiveSettings()
          return { rate: resolved.rate, voiceName: resolved.voiceName, voiceLang: resolved.voiceLang, ttsTheme: resolved.ttsTheme, speakerByTheme: resolved.speakerByTheme, waveStyle: resolved.waveStyle, asrTheme: resolved.asrTheme }
        },
      }
    },
  }, MicButton)

  // The settings card claims the `voice` namespace in the plugin
  // configuration tab (keyed by namespace; the Host serves the schema).
  const cardStore = new SnapshotStore<VoiceCardState>({
    status: 'loading',
    value: { ...VOICE_DEFAULTS },
    user: {},
    writable: false,
  })
  const syncCard = (): void => {
    const snapshot = settingsScope.getSnapshot()
    cardStore.set({
      status: snapshot.status,
      value: snapshot.status === 'ready' ? resolveSettings(snapshot.value) : { ...VOICE_DEFAULTS },
      user: (snapshot.user ?? {}) as Record<string, unknown>,
      writable: snapshot.writable,
    })
  }
  const disposeCardSync = settingsScope.subscribe(syncCard)
  ctx.effect(() => disposeCardSync, 'voice-talk: settings-card sync')
  syncCard()
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'voice',
    inject: (): VoiceCardInjected => ({
      hooks: { voiceCard: cardStore },
      set: (field, value) => { void settingsScope.set(field, value).catch(error => console.error('[dsh-voice-talk] settings write failed:', error)) },
      credentials: api.credentials,
    }),
  }, VoiceSettingsCard))
}

/**
 * Resolve the per-session input facade for the controller's draft writes.
 * The session-scope context addresses the same resident shell the composer
 * uses; an absent facade degrades to undefined (the round cannot submit).
 */
function inputFor(conversation: IConversation, sessionCtx: unknown): { setDraft(text: string): void; submit(): void; notify(level: 'info' | 'error', text: string): void } | undefined {
  try {
    return conversation.input.for(sessionCtx as never)
  } catch (error) {
    console.error('[dsh-voice-talk] input facade unavailable:', error)
    return undefined
  }
}
