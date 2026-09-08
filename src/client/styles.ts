// Voice-chat styles, injected once per page (no CSS pipeline in this
// package). Two families:
//   composer-side  — the mic button + settings card (text mode stays pure)
//   call overlay   — an opaque two-column call stage: glass call panel with
//                    avatar + ripple rings on the left, the session's message
//                    stream on the right. Static background, transform-only
//                    motion; backdrop-filter confined to small static panels.

const CSS = `
/* ---- mic button (composer tool row) ---- */
.dsh-voice-mic {
  display: inline-flex; align-items: center; gap: 4px;
  height: 26px; padding: 0 7px; border-radius: 6px;
  border: none; background: transparent; color: inherit;
  cursor: pointer; opacity: .78;
}
.dsh-voice-mic:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
.dsh-voice-mic.is-loop { opacity: 1; color: #5EEAD4; }
.dsh-voice-mic.is-listening svg { animation: dsh-voice-pulse 1.4s ease-in-out infinite; }
.dsh-voice-mic-badge {
  font-size: 10px; line-height: 1; padding: 2px 4px; border-radius: 4px;
  background: color-mix(in srgb, currentColor 14%, transparent);
}
@keyframes dsh-voice-pulse {
  0%, 100% { opacity: 1; } 50% { opacity: .35; }
}

/* ---- settings card ---- */
.dsh-voice-card { padding: 12px 0; display: grid; gap: 8px; }
.dsh-voice-card-title { margin: 0; font-size: 14px; }
.dsh-voice-card-empty { margin: 0; opacity: .6; font-size: 12px; }
.dsh-voice-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.dsh-voice-row-label { opacity: .85; }
.dsh-voice-row-value { font-size: 13px; opacity: .7; }
.dsh-voice-switch {
  width: 40px; height: 22px; padding: 0; border-radius: 999px; border: none;
  background: rgba(15, 17, 21, .18); cursor: pointer; position: relative;
  transition: background .2s ease; flex: none;
}
.dsh-voice-switch.is-on { background: #0F1115; }
.dsh-voice-switch:disabled { opacity: .4; cursor: default; }
.dsh-voice-switch-knob {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .25);
  transition: transform .2s cubic-bezier(.22, 1, .36, 1);
}
.dsh-voice-switch.is-on .dsh-voice-switch-knob { transform: translateX(18px); }
.dsh-voice-input {
  max-width: 180px; padding: 0 10px; height: 34px; border-radius: 10px; font-size: 13px;
  border: 1px solid rgba(15, 17, 21, .16); background: #fff; color: #0F1115;
  transition: border-color .15s ease;
}
.dsh-voice-input:focus { outline: none; border-color: rgba(15, 17, 21, .7); }
.dsh-voice-card-warn { margin: 0; font-size: 11px; color: #e0a24a; }
.dsh-voice-card-hint { margin: 0; opacity: .5; font-size: 11px; }
.dsh-voice-card-overrides { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-voice-reset {
  border: none; border-radius: 5px; padding: 2px 8px; font-size: 11px; cursor: pointer;
  background: color-mix(in srgb, currentColor 10%, transparent); color: inherit;
}

/* ---- call overlay: opaque deep-sea stage, two columns ----
   Performance contract: the page background is a STATIC opaque gradient
   (no filter, no animation). backdrop-filter appears only on small panels
   whose backdrop never changes; per-frame motion (ripples, typing caret)
   is transform/opacity only. */
.dsh-voice-call {
  position: fixed; inset: 0; z-index: 9999;
  display: grid; grid-template-columns: 400px 1fr;
  background:
    radial-gradient(ellipse 120% 90% at 18% 0%, #14243F 0%, transparent 55%),
    radial-gradient(ellipse 110% 85% at 88% 100%, #0D2B33 0%, transparent 58%),
    linear-gradient(160deg, #0B1220 0%, #0A0F1B 100%);
  color: #E6EDF7;
  animation: dsh-veil-in .4s ease both;
  overflow: hidden;
}
@keyframes dsh-veil-in { from { opacity: 0; } to { opacity: 1; } }

/* ---- left: the call face ---- */
.dsh-voice-left {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px 28px 30px;
  margin: 14px; border-radius: 24px;
  background: rgba(255, 255, 255, .05);
  border: 1px solid rgba(255, 255, 255, .09);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 18px 48px rgba(0, 0, 0, .35);
}

.dsh-voice-topline {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px; letter-spacing: .2em; color: rgba(230,237,247,.4);
  font-variant-numeric: tabular-nums;
}

.dsh-voice-avatar-wrap {
  position: relative; width: 168px; height: 168px; margin: 34px 0 26px;
  display: grid; place-items: center; flex: none;
}
.dsh-voice-avatar {
  width: 92px; height: 92px; border-radius: 50%;
  box-shadow: 0 6px 30px rgba(77, 163, 255, .35), 0 0 0 1px rgba(255,255,255,.12) inset;
}
/* the whale avatar: gradient circle backing, phase-driven swim (transform-only) */
.dsh-voice-avatar-circle {
  width: 92px; height: 92px; border-radius: 50%;
  display: grid; place-items: center;
  background: radial-gradient(circle at 32% 28%, rgba(106, 184, 255, .30), rgba(43, 92, 168, .22) 58%, rgba(16, 38, 76, .30) 100%);
  box-shadow: 0 6px 30px rgba(77, 163, 255, .35), 0 0 0 1px rgba(255,255,255,.12) inset;
  color: #E6EDF7;
  overflow: hidden;
}
.dsh-voice-whale { width: 58px; height: auto; }
.dsh-voice-avatar-wrap[data-phase="thinking"] .dsh-voice-whale {
  animation: dsh-whale-swim-slow 3s ease-in-out infinite;
}
.dsh-voice-avatar-wrap[data-phase="speaking"] .dsh-voice-whale {
  animation: dsh-whale-swim-fast 1.2s ease-in-out infinite;
}
@keyframes dsh-whale-swim-slow {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-3px) rotate(-3.5deg); }
  50% { transform: translateY(-4px) rotate(0deg); }
  75% { transform: translateY(-2px) rotate(3.5deg); }
}
@keyframes dsh-whale-swim-fast {
  0%, 100% { transform: translateY(1px) rotate(-6deg); }
  30% { transform: translateY(-6px) rotate(2deg); }
  60% { transform: translateY(-2px) rotate(7deg); }
}
.dsh-voice-ripples { position: absolute; inset: 0; pointer-events: none; }
.dsh-voice-ring {
  position: absolute; inset: 0; border-radius: 50%;
  border: 1.5px solid rgba(106, 184, 255, .8);
  will-change: transform, opacity;
}
.dsh-voice-call[data-phase="thinking"] .dsh-voice-ring { border-color: rgba(148, 163, 184, .55); }
.dsh-voice-call[data-phase="speaking"] .dsh-voice-ring { border-color: rgba(94, 234, 212, .8); }

.dsh-voice-state-word {
  font-size: 19px; font-weight: 300; letter-spacing: .4em; text-indent: .4em;
  color: rgba(230,237,247,.92);
}

.dsh-voice-live {
  min-height: 84px; margin-top: 22px; width: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  text-align: center; padding: 0 6px;
}
.dsh-voice-live > div { max-height: 52px; overflow-y: auto; width: 100%; scrollbar-width: thin; scrollbar-color: rgba(142,164,190,.25) transparent; }
.dsh-voice-live-interim { color: #8FB6FF; font-size: 14px; line-height: 1.7; }
.dsh-voice-live-hint { color: rgba(230,237,247,.4); font-size: 13px; letter-spacing: .05em; }
.dsh-voice-live-warn { color: #F5C56B; font-size: 12.5px; line-height: 1.6; }
.dsh-voice-live-error { color: #FFA9A2; font-size: 12.5px; line-height: 1.6; }

/* ---- left: controls (glass pill) ---- */
.dsh-voice-controls {
  margin-top: auto;
  display: flex; align-items: center; justify-content: center; flex-wrap: wrap;
  gap: 14px; padding: 14px 18px; border-radius: 18px;
  background: rgba(255, 255, 255, .05);
  border: 1px solid rgba(255, 255, 255, .08);
}
/* THE fix: the old sheet only re-enabled buttons — the speaker <select> and
   the rate <input type=range> were born unreachable. Enable every control. */
.dsh-voice-controls button,
.dsh-voice-controls select,
.dsh-voice-controls input,
.dsh-voice-controls .dsh-voice-ctl { pointer-events: auto; }

.dsh-voice-hangup {
  width: 54px; height: 54px; border-radius: 50%; cursor: pointer;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.14);
  color: #FF6B61;
  display: inline-flex; align-items: center; justify-content: center;
  transition: border-color .2s, background .2s, transform .1s;
}
.dsh-voice-hangup:hover {
  border-color: rgba(255,107,97,.55); background: rgba(255,107,97,.1);
  box-shadow: 0 0 24px rgba(255,107,97,.2);
}
.dsh-voice-hangup:active { transform: scale(.94); }
.dsh-voice-skip, .dsh-voice-speak-toggle {
  border: none; background: none; cursor: pointer; color: rgba(230,237,247,.5);
  font-size: 13px; letter-spacing: .05em; transition: color .2s;
}
.dsh-voice-skip:hover, .dsh-voice-speak-toggle:hover { color: rgba(230,237,247,.9); }
.dsh-voice-skip.hidden { display: none; }

/* speaker picker + rate control */
.dsh-voice-ctl {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; color: rgba(230,237,247,.55);
  cursor: pointer; transition: color .2s;
  position: relative; max-width: 130px;
}
.dsh-voice-ctl:hover, .dsh-voice-ctl:focus-within { color: rgba(230,237,247,.9); }
.dsh-voice-ctl-select {
  appearance: none; -webkit-appearance: none;
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; cursor: pointer; border: none; background: none; color: inherit;
  font-size: 13px;
}
.dsh-voice-ctl-value { pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-voice-rate { display: inline-flex; align-items: center; gap: 8px; }
.dsh-voice-rate-value {
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px;
  font-variant-numeric: tabular-nums; min-width: 34px;
}
.dsh-voice-rate-magnet { display: inline-flex; flex-direction: column; gap: 2px; }
.dsh-voice-rate-magnet input[type='range'] {
  width: 130px; margin: 0; accent-color: #6AB8FF; cursor: pointer; height: 18px;
}
.dsh-voice-rate-ticks {
  display: flex; justify-content: space-between; padding: 0 8px; margin: 0 auto; width: 130px;
}
.dsh-voice-rate-ticks i {
  width: 3px; height: 3px; border-radius: 50%; background: rgba(230, 237, 247, .3);
}
.dsh-voice-rate-ticks i.is-active { background: #8FD8FF; }
.dsh-voice-st-dot {
  display: inline-block; width: 5px; height: 5px; border-radius: 50%; margin-right: 7px;
  position: relative; top: -2px; background: #5EEAD4; box-shadow: 0 0 8px rgba(94,234,212,.8);
}
.dsh-voice-speak-toggle.off .dsh-voice-st-dot {
  background: rgba(148,163,184,.5); box-shadow: none;
}

/* ---- right: the session stream ---- */
.dsh-voice-right { min-width: 0; display: flex; }
.dsh-voice-stream {
  flex: 1; overflow-y: auto; padding: 26px 30px 34px;
  display: flex; flex-direction: column; gap: 18px;
  scrollbar-width: thin; scrollbar-color: rgba(142,164,190,.25) transparent;
}
.dsh-voice-msg { display: flex; gap: 10px; align-items: flex-start; }
.dsh-voice-msg-user { justify-content: flex-end; }
.dsh-voice-msg-user .dsh-voice-bubble {
  max-width: 72%;
  background: rgba(106, 184, 255, .14);
  border: 1px solid rgba(106, 184, 255, .2);
  color: #DCEBFF;
  border-radius: 16px 16px 4px 16px;
  padding: 10px 14px; font-size: 14px; line-height: 1.75;
  white-space: pre-wrap; word-break: break-word;
}
.dsh-voice-msg-ai { max-width: 86%; }
.dsh-voice-msg-avatar {
  width: 30px; height: 30px; border-radius: 50%; flex: none; margin-top: 2px;
  opacity: .92;
}
.dsh-voice-msg-body {
  min-width: 0;
  background: rgba(255, 255, 255, .045);
  border: 1px solid rgba(255, 255, 255, .07);
  border-radius: 4px 16px 16px 16px;
  padding: 10px 14px;
}
.dsh-voice-prose {
  margin: 0; font-size: 14px; line-height: 1.85;
  white-space: pre-wrap; word-break: break-word; color: rgba(230,237,247,.92);
}
.dsh-voice-prose + .dsh-voice-prose, .dsh-voice-prose + .dsh-voice-code, .dsh-voice-code + .dsh-voice-prose { margin-top: 8px; }
.dsh-voice-code {
  margin: 0; padding: 10px 12px; border-radius: 10px; overflow-x: auto;
  background: rgba(3, 8, 18, .65); border: 1px solid rgba(255,255,255,.06);
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; line-height: 1.7;
  color: #B9D4FF; white-space: pre;
}
.dsh-voice-msg-empty { opacity: .4; }
.dsh-voice-caret {
  display: inline-block; width: 2px; height: 1em; margin-left: 2px;
  background: #6AB8FF; vertical-align: text-bottom;
  animation: dsh-caret-blink 1s steps(1) infinite;
}
@keyframes dsh-caret-blink { 50% { opacity: 0; } }

@media (max-width: 860px) {
  .dsh-voice-call { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .dsh-voice-left { margin: 10px; padding: 22px 18px 20px; }
  .dsh-voice-avatar-wrap { width: 128px; height: 128px; margin: 18px 0 14px; }
  .dsh-voice-avatar { width: 68px; height: 68px; }
  .dsh-voice-live { min-height: 64px; margin-top: 12px; }
  .dsh-voice-stream { padding: 16px 14px 24px; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-voice-call { animation: none !important; }
  .dsh-voice-mic.is-listening svg, .dsh-voice-caret {
    animation: none !important;
  }
  .dsh-voice-ring { opacity: .18 !important; transform: none !important; }
  .dsh-voice-whale { animation: none !important; }
}
`

/** Inject the sheet once per page (idempotent across apply cycles). */
export function injectVoiceStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="dsh-voice-talk/styles.css"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.pluginCss = 'dsh-voice-talk/styles.css'
  tag.textContent = CSS
  document.head.appendChild(tag)
}
