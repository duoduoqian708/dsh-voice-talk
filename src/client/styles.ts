// Voice-chat styles, injected once per page (no CSS pipeline in this
// package). Two families:
//   composer-side  — the mic button + settings card (text mode stays pure)
//   call overlay   — the "微光" voice layer: aurora ambience, live wave
//                    bars, frameless captions, glass controls. The dim is
//                    deliberately light so the underlying workspace execution
//                    stays visible.

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

/* ---- call overlay: aurora ambience ---- */
.dsh-voice-call {
  position: fixed; inset: 0; z-index: 9999;
  pointer-events: none;
  animation: dsh-veil-in .5s ease both;
}
@keyframes dsh-veil-in { from { opacity: 0; } to { opacity: 1; } }

.dsh-voice-call::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 92% 74% at 50% 46%, rgba(5, 9, 18, .82) 0%, rgba(5, 9, 18, .68) 52%, rgba(6, 11, 20, .58) 100%);
}

.dsh-voice-aurora { position: absolute; inset: 0; filter: blur(72px); opacity: .55; transition: opacity 1.2s ease; }
.dsh-voice-aurora i { position: absolute; border-radius: 50%; display: block; }
.dsh-voice-aur1 {
  width: 62vw; height: 62vw; left: -14vw; top: -20vh;
  background: radial-gradient(circle, rgba(30,58,138,.5), transparent 65%);
  animation: dsh-drift1 26s ease-in-out infinite alternate;
}
.dsh-voice-aur2 {
  width: 56vw; height: 56vw; right: -14vw; bottom: -22vh;
  background: radial-gradient(circle, rgba(19,110,110,.38), transparent 65%);
  animation: dsh-drift2 32s ease-in-out infinite alternate;
}
.dsh-voice-aur3 {
  width: 44vw; height: 44vw; left: 32vw; top: 28vh;
  background: radial-gradient(circle, rgba(88,45,144,.3), transparent 65%);
  animation: dsh-drift3 38s ease-in-out infinite alternate;
}
@keyframes dsh-drift1 { from { transform: translate(0,0) scale(1); } to { transform: translate(9vw,7vh) scale(1.18); } }
@keyframes dsh-drift2 { from { transform: translate(0,0) scale(1.1); } to { transform: translate(-8vw,-9vh) scale(.9); } }
@keyframes dsh-drift3 { from { transform: translate(0,0) scale(.95); } to { transform: translate(-6vw,9vh) scale(1.15); } }
.dsh-voice-call[data-phase="thinking"] .dsh-voice-aurora { opacity: .32; }
.dsh-voice-call[data-phase="speaking"] .dsh-voice-aurora { opacity: .72; }

.dsh-voice-grain {
  position: absolute; inset: 0; opacity: .7;
  background-image:
    repeating-linear-gradient(0deg, rgba(255,255,255,.008) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.006) 0 1px, transparent 1px 4px);
}

/* ---- stage ---- */
.dsh-voice-stage {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center;
  padding: 34px 24px 44px;
  animation: dsh-stage-in .7s cubic-bezier(.22,1,.36,1) both;
}
@keyframes dsh-stage-in {
  from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; }
}

.dsh-voice-topline {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px; letter-spacing: .2em; color: rgba(230,237,247,.38);
  font-variant-numeric: tabular-nums;
}

.dsh-voice-center {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 36px;
}

.dsh-voice-wave { display: flex; align-items: center; justify-content: center; gap: 7px; height: 120px; }
.dsh-voice-wave-bar {
  width: 5px; border-radius: 3px; height: 12px;
  background: linear-gradient(180deg, #8FD8FF, #4A7BD4);
  box-shadow: 0 0 12px rgba(106, 184, 255, .25);
}

.dsh-voice-state-word {
  font-size: 21px; font-weight: 250; letter-spacing: .42em; text-indent: .42em;
  color: rgba(230,237,247,.92); text-shadow: 0 2px 24px rgba(0,0,0,.6);
}

/* ---- captions: frameless floating text ---- */
.dsh-voice-captions {
  min-height: 100px; max-height: 30vh; overflow-y: auto; pointer-events: auto;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  max-width: 580px; text-align: center; padding: 0 16px;
  scrollbar-width: thin; scrollbar-color: rgba(142,164,190,.25) transparent;
}
.dsh-voice-cap {
  font-size: 15px; line-height: 1.85;
  display: flex; align-items: baseline; gap: 10px;
  animation: dsh-cap-in .5s ease both;
  text-shadow: 0 1px 14px rgba(0,0,0,.55);
}
@keyframes dsh-cap-in {
  from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; }
}
.dsh-voice-cap-dot {
  width: 5px; height: 5px; border-radius: 50%; flex: none; position: relative; top: -3px;
}
.dsh-voice-cap-user { color: rgba(230,237,247,.88); }
.dsh-voice-cap-user .dsh-voice-cap-dot { background: #8FB6FF; box-shadow: 0 0 8px rgba(143,182,255,.8); }
.dsh-voice-cap-ai { color: rgba(196,240,226,.92); }
.dsh-voice-cap-ai .dsh-voice-cap-dot { background: #5EEAD4; box-shadow: 0 0 8px rgba(94,234,212,.8); }
.dsh-voice-cap-live { color: rgba(143,182,255,.9); font-style: normal; }
.dsh-voice-cap-live .dsh-voice-cap-dot { background: #8FB6FF; animation: dsh-voice-pulse 1.2s ease-in-out infinite; }
.dsh-voice-cap-pending { color: #F5C56B; font-size: 13px; }
.dsh-voice-cap-pending .dsh-voice-cap-dot { background: #F5B84B; box-shadow: 0 0 8px rgba(245,184,75,.8); }
.dsh-voice-cap-error { color: #FFA9A2; font-size: 13px; }
.dsh-voice-cap-error .dsh-voice-cap-dot { background: #FF6B61; }

/* ---- controls: glass hang-up, quiet text buttons ---- */
.dsh-voice-controls {
  display: flex; align-items: center; gap: 16px; height: 60px; margin-top: 24px;
}
.dsh-voice-controls button { pointer-events: auto; }
.dsh-voice-hangup {
  width: 56px; height: 56px; border-radius: 50%; cursor: pointer;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.14);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: #FF6B61;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .2s;
}
.dsh-voice-hangup:hover {
  border-color: rgba(255,107,97,.55); background: rgba(255,107,97,.08);
  box-shadow: 0 0 28px rgba(255,107,97,.18);
}
.dsh-voice-hangup:active { transform: scale(.94); }
.dsh-voice-skip, .dsh-voice-speak-toggle {
  border: none; background: none; cursor: pointer; color: rgba(230,237,247,.42);
  font-size: 13px; letter-spacing: .06em; transition: color .3s, opacity .3s;
}
.dsh-voice-skip:hover, .dsh-voice-speak-toggle:hover { color: rgba(230,237,247,.85); }
.dsh-voice-skip.hidden { opacity: 0; pointer-events: none; }

/* theme setup guide (settings card) */
.dsh-voice-setup { display: grid; gap: 8px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, currentColor 5%, transparent); }
.dsh-voice-setup-note { margin: 0; font-size: 12px; opacity: .75; }
.dsh-voice-setup-link { color: #4A7BD4; }
.dsh-voice-setup-ok { font-size: 11px; color: #2fae8f; margin-left: 6px; }
.dsh-voice-setup-actions { display: flex; align-items: center; gap: 10px; }

/* provider cards (settings card) */
.dsh-voice-providers { display: grid; gap: 10px; }
.dsh-voice-group {
  display: grid; gap: 8px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid rgba(15, 17, 21, .1);
  background: rgba(15, 17, 21, .02);
}
.dsh-voice-group-title { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: rgba(15, 17, 21, .55); }
.dsh-voice-provider {
  display: grid; gap: 8px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid rgba(15, 17, 21, .1);
  background: rgba(15, 17, 21, .02);
}
.dsh-voice-provider.is-active {
  border-color: rgba(15, 17, 21, .5);
  background: rgba(15, 17, 21, .03);
}
.dsh-voice-provider-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dsh-voice-provider-name { font-size: 13px; font-weight: 600; }
.dsh-voice-provider-status { font-size: 11px; opacity: .6; }
.dsh-voice-provider-status.is-missing { color: #B4720F; opacity: 1; }
.dsh-voice-provider-note { margin: 0; font-size: 11px; opacity: .55; line-height: 1.6; }
.dsh-voice-provider-actions { display: flex; align-items: center; gap: 8px; }
.dsh-voice-provider-btn {
  border: none; border-radius: 10px; padding: 0 14px; height: 34px; font-size: 13px; cursor: pointer;
  background: rgba(15, 17, 21, .06); color: #0F1115;
}
.dsh-voice-provider-btn:hover { background: rgba(15, 17, 21, .1); }
.dsh-voice-provider-btn:disabled { opacity: .4; cursor: default; }
.dsh-voice-provider-btn.is-primary { background: #0F1115; color: #fff; }
.dsh-voice-provider-btn.is-primary:hover { background: #2A2E35; }

/* provider settings modal — mirrors the platform settings dialog (light panel,
   24px radius, hairline shadow); colors are hard-coded because the host page
   ships no theme variables. */
.dsh-voice-modal-veil {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(15, 17, 21, .4);
  display: flex; align-items: center; justify-content: center;
  animation: dsh-veil-in .2s ease both;
}
.dsh-voice-modal {
  width: min(520px, calc(100vw - 48px)); max-height: 82vh; overflow-y: auto;
  display: grid; gap: 12px; padding: 24px; border-radius: 24px;
  background: #fff; color: #0F1115;
  box-shadow:
    rgba(0, 0, 0, .2) 0 0 1px 0,
    rgba(0, 0, 0, .06) 0 8px 24px 0,
    rgba(0, 0, 0, .04) 0 2px 8px 0;
  animation: dsh-modal-in .22s cubic-bezier(.22, 1, .36, 1) both;
}
@keyframes dsh-modal-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
.dsh-voice-modal-head { display: flex; align-items: center; justify-content: space-between; }
.dsh-voice-modal-title { margin: 0; font-size: 16px; font-weight: 600; }
.dsh-voice-modal-close {
  width: 28px; height: 28px; border: none; border-radius: 8px; cursor: pointer;
  background: transparent; color: inherit; font-size: 15px; line-height: 1; opacity: .55;
}
.dsh-voice-modal-close:hover { background: rgba(15, 17, 21, .06); opacity: 1; }
.dsh-voice-modal-hint { font-size: 11px; opacity: .55; }
.dsh-voice-modal-divider {
  display: flex; align-items: center; gap: 10px; margin-top: 2px;
  font-size: 12px; font-weight: 600; letter-spacing: .08em; color: rgba(15, 17, 21, .55);
}
.dsh-voice-modal-divider::after {
  content: ''; flex: 1; height: 1px; background: rgba(15, 17, 21, .1);
}
.dsh-voice-modal-footer { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.dsh-voice-input-wide { flex: 1; max-width: none; min-width: 0; }
.dsh-voice-modal .dsh-voice-row-label { flex: none; min-width: 0; width: 84px; text-align: left; opacity: .75; }
.dsh-voice-modal select.dsh-voice-input { max-width: none; flex: 1; }
.dsh-voice-cred-cell { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-voice-cred-badge {
  flex: none; font-size: 11px; color: #2fae8f;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(47, 174, 143, .12);
}

/* speaker picker + rate control (call overlay control row) */
.dsh-voice-ctl {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; letter-spacing: .04em; color: rgba(230,237,247,.42);
  cursor: pointer; transition: color .3s;
  position: relative;
}
.dsh-voice-ctl:hover, .dsh-voice-ctl:focus-within { color: rgba(230,237,247,.85); }
.dsh-voice-ctl-select {
  appearance: none; -webkit-appearance: none;
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; cursor: pointer; border: none; background: none; color: inherit;
  font-size: 13px;
}
.dsh-voice-ctl-value { pointer-events: none; }
.dsh-voice-ctl-button {
  border: none; background: none; padding: 0;
}
.dsh-voice-rate { display: inline-flex; align-items: center; gap: 8px; }
.dsh-voice-rate-slider {
  width: 110px; accent-color: #6AB8FF; cursor: pointer; height: auto; opacity: .9;
}
.dsh-voice-rate-value {
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px;
  font-variant-numeric: tabular-nums; min-width: 34px;
}
/* magnet rate slider (call HUD only): five discrete stops with tick dots */
.dsh-voice-rate-magnet { display: inline-flex; flex-direction: column; gap: 2px; }
.dsh-voice-rate-magnet input[type='range'] {
  width: 180px; margin: 0; accent-color: #0F1115; cursor: pointer; height: 18px;
}
.dsh-voice-rate-ticks {
  display: flex; justify-content: space-between; padding: 0 8px; margin: 0 auto; width: 180px;
}
.dsh-voice-rate-ticks i {
  width: 4px; height: 4px; border-radius: 50%; background: rgba(15, 17, 21, .22);
}
.dsh-voice-rate-ticks i.is-active { background: #0F1115; }
.dsh-voice-call .dsh-voice-rate-magnet input[type='range'] { accent-color: #6AB8FF; }
.dsh-voice-call .dsh-voice-rate-ticks i { background: rgba(230, 237, 247, .35); }
.dsh-voice-call .dsh-voice-rate-ticks i.is-active { background: #8FD8FF; }
.dsh-voice-st-dot {
  display: inline-block; width: 5px; height: 5px; border-radius: 50%; margin-right: 7px;
  position: relative; top: -2px; background: #5EEAD4; box-shadow: 0 0 8px rgba(94,234,212,.8);
}
.dsh-voice-speak-toggle.off .dsh-voice-st-dot {
  background: rgba(148,163,184,.5); box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-voice-call, .dsh-voice-stage, .dsh-voice-cap { animation: none !important; }
  .dsh-voice-aurora i, .dsh-voice-mic.is-listening svg, .dsh-voice-cap-live .dsh-voice-cap-dot {
    animation: none !important;
  }
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
