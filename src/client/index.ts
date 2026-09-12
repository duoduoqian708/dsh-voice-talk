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
// Type-only: pulls the SlotMap merges of the conversation slots and the
// conversation Context merge (ctx.conversation).
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `shell.overlay` slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `settings.plugin.item` keyed-slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: pulls the ctx.locale Context merge (the dictionary service).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { VoiceController } from './voice-controller.ts'
import { resolveSettings, VOICE_DEFAULTS, type VoiceSettings } from './voice-settings.ts'
import { MicButton, type VoiceInjected } from './components.tsx'
import { CallOverlay } from './call-overlay.tsx'
import { VoiceSettingsCard, type VoiceCardInjected, type VoiceCardState } from './settings-card.tsx'
import { credentialsFace, sessionSnapshotFace } from './host-compat.ts'
import { injectVoiceStyles } from './styles.ts'
import { SnapshotStore } from './store.ts'
import { NS, zh, en } from './locales.ts'

/** Services the browser half requires (fiber inject waiting). */
export const inject = ['slots', 'sessions', 'conversation', 'settingsScope', 'connection', 'locale']

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
  const credentials = credentialsFace(ctx)
  injectVoiceStyles()
  // Bilingual copy: the platform locale service owns the active language and
  // re-renders every slot entry whose registration declares `locale: NS`,
  // handing them a fresh `t`. The bound function below reads the active
  // locale at call time, so controller notices follow switches too.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'voice-talk: dictionaries')
  const t = ctx.locale.bind(NS)

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
    const snapshotFace = sessionSnapshotFace(ctx, binding, sessionId)
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
      readSnapshot: snapshotFace.readSnapshot,
      subscribeSnapshot: snapshotFace.subscribeSnapshot,
      settings: settingsNow,
      t,
    })
    controllers.set(sessionId, controller)
    // The call overlay rides the shell overlay layer (root scope, additive
    // list, click-through): mount one per controller at creation time — it
    // renders null unless the loop is armed, so idle sessions cost nothing.
    ctx.slots.register({
      name: 'shell.overlay',
      id: `voice-call-${sessionId}`,
      locale: NS,
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
          return { rate: resolved.rate, voiceName: resolved.voiceName, voiceLang: resolved.voiceLang, ttsTheme: resolved.ttsTheme, speakerByTheme: resolved.speakerByTheme, storedSpeakerByTheme: settingsNow().speakerByTheme ?? {}, waveStyle: resolved.waveStyle, asrTheme: resolved.asrTheme }
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
    locale: NS,
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
          return { rate: resolved.rate, voiceName: resolved.voiceName, voiceLang: resolved.voiceLang, ttsTheme: resolved.ttsTheme, speakerByTheme: resolved.speakerByTheme, storedSpeakerByTheme: settingsNow().speakerByTheme ?? {}, waveStyle: resolved.waveStyle, asrTheme: resolved.asrTheme }
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
    const next: VoiceCardState = {
      status: snapshot.status,
      value: snapshot.status === 'ready' ? resolveSettings(snapshot.value) : { ...VOICE_DEFAULTS },
      user: (snapshot.user ?? {}) as Record<string, unknown>,
      writable: snapshot.writable,
    }
    // Settings scopes emit on refreshes that change nothing for this card;
    // publishing an identical state re-renders the whole card (and any open
    // modal) for no reason — skip when the resolved fields are unchanged.
    const current = cardStore.getSnapshot()
    if (current.status === next.status
      && current.writable === next.writable
      && JSON.stringify(current.value) === JSON.stringify(next.value)
      && JSON.stringify(current.user) === JSON.stringify(next.user)) return
    cardStore.set(next)
  }
  const disposeCardSync = settingsScope.subscribe(syncCard)
  ctx.effect(() => disposeCardSync, 'voice-talk: settings-card sync')
  syncCard()
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'voice',
    locale: NS,
    inject: (): VoiceCardInjected => ({
      hooks: { voiceCard: cardStore },
      set: (field, value) => { void settingsScope.set(field, value).catch(error => console.error('[dsh-voice-talk] settings write failed:', error)) },
      credentials,
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
