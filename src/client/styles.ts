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
  background: rgba(0, 0, 0, .15); cursor: pointer; position: relative;
  transition: background .2s ease; flex: none;
}
.dsh-voice-switch.is-on { background: #34C759; }
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
.dsh-voice-input:focus { outline: none; border-color: #007AFF; }
.dsh-voice-card-warn { margin: 0; font-size: 11px; color: #B25000; }
.dsh-voice-card-hint { margin: 0; color: #86868B; font-size: 11px; }
.dsh-voice-card-overrides { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-voice-reset {
  border: none; border-radius: 5px; padding: 2px 8px; font-size: 11px; cursor: pointer;
  background: color-mix(in srgb, currentColor 10%, transparent); color: inherit;
}

/* ---- settings card: engine setup guide ---- */
.dsh-voice-setup { display: grid; gap: 8px; padding: 10px 12px; border-radius: 10px; background: rgba(0, 0, 0, .03); }
.dsh-voice-setup-note { margin: 0; font-size: 12px; color: #6E6E73; }
.dsh-voice-setup-link { color: #007AFF; text-decoration: none; }
.dsh-voice-setup-link:hover { text-decoration: underline; }
.dsh-voice-setup-ok { font-size: 11px; color: #34C759; margin-left: 6px; }
.dsh-voice-setup-actions { display: flex; align-items: center; gap: 10px; }

/* ---- settings card: provider cards ---- */
.dsh-voice-providers { display: grid; gap: 10px; }
.dsh-voice-group {
  display: grid; gap: 8px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, .08);
  background: #fff;
}
.dsh-voice-group-title { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: #6E6E73; }
.dsh-voice-provider {
  display: grid; gap: 8px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, .08);
  background: #fff;
  transition: border-color .15s, box-shadow .15s;
}
.dsh-voice-provider.is-active {
  border-color: rgba(0, 122, 255, .55);
  box-shadow: 0 0 0 1px rgba(0, 122, 255, .25) inset;
}
.dsh-voice-provider-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dsh-voice-provider-name { font-size: 13px; font-weight: 600; }
.dsh-voice-provider-status { font-size: 11px; color: #86868B; }
.dsh-voice-provider-status.is-missing { color: #B25000; }
.dsh-voice-provider-note { margin: 0; font-size: 11px; color: #86868B; line-height: 1.6; }
.dsh-voice-provider-actions { display: flex; align-items: center; gap: 8px; }
.dsh-voice-provider-btn {
  border: none; border-radius: 10px; padding: 0 14px; height: 34px; font-size: 13px; cursor: pointer;
  background: rgba(0, 0, 0, .06); color: #1D1D1F;
  transition: background .15s;
}
.dsh-voice-provider-btn:hover { background: rgba(0, 0, 0, .1); }
.dsh-voice-provider-btn:disabled { opacity: .4; cursor: default; }
.dsh-voice-provider-btn.is-primary { background: #007AFF; color: #fff; }
.dsh-voice-provider-btn.is-primary:hover { background: #0071EB; }

/* ---- settings card: provider settings modal ----
   Light panel, 24px radius, hairline shadow; dark adapts via the host's
   body[data-ds-dark-theme] attribute (the theme presenter sets it). */
.dsh-voice-modal-veil {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0, 0, 0, .35);
  display: flex; align-items: center; justify-content: center;
  animation: dsh-veil-in .2s ease both;
}
.dsh-voice-modal {
  width: min(520px, calc(100vw - 48px)); max-height: 82vh; overflow-y: auto;
  display: grid; gap: 12px; padding: 24px; border-radius: 24px;
  background: #fff; color: #1D1D1F;
  box-shadow:
    rgba(0, 0, 0, .2) 0 0 1px 0,
    rgba(0, 0, 0, .08) 0 8px 24px 0,
    rgba(0, 0, 0, .05) 0 2px 8px 0;
  animation: dsh-modal-in .22s cubic-bezier(.22, 1, .36, 1) backwards;
}
@keyframes dsh-modal-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
.dsh-voice-modal-head { display: flex; align-items: center; justify-content: space-between; }
.dsh-voice-modal-title { margin: 0; font-size: 16px; font-weight: 600; }
.dsh-voice-modal-close {
  width: 28px; height: 28px; border: none; border-radius: 8px; cursor: pointer;
  background: transparent; color: inherit; font-size: 15px; line-height: 1; opacity: .55;
}
.dsh-voice-modal-close:hover { background: rgba(0, 0, 0, .06); opacity: 1; }
.dsh-voice-modal-hint { font-size: 11px; color: #86868B; }
.dsh-voice-modal-divider {
  display: flex; align-items: center; gap: 10px; margin-top: 2px;
  font-size: 12px; font-weight: 600; letter-spacing: .08em; color: #6E6E73;
}
.dsh-voice-modal-divider::after {
  content: ''; flex: 1; height: 1px; background: rgba(0, 0, 0, .1);
}
.dsh-voice-modal-footer { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.dsh-voice-input-wide { flex: 1; max-width: none; min-width: 0; }
.dsh-voice-modal .dsh-voice-row-label { flex: none; min-width: 0; width: 84px; text-align: left; opacity: .75; }
.dsh-voice-modal select.dsh-voice-input { max-width: none; flex: 1; }
.dsh-voice-cred-cell { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-voice-cred-badge {
  flex: none; font-size: 11px; color: #34C759;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(52, 199, 89, .12);
}

/* host dark theme: adapt card surfaces (the presenter sets the attribute) */
body[data-ds-dark-theme] .dsh-voice-card,
body[data-ds-dark-theme] .dsh-voice-modal { color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-group,
body[data-ds-dark-theme] .dsh-voice-provider,
body[data-ds-dark-theme] .dsh-voice-setup { background: rgba(255, 255, 255, .05); border-color: rgba(255, 255, 255, .1); }
body[data-ds-dark-theme] .dsh-voice-group-title,
body[data-ds-dark-theme] .dsh-voice-provider-note,
body[data-ds-dark-theme] .dsh-voice-provider-status,
body[data-ds-dark-theme] .dsh-voice-modal-hint,
body[data-ds-dark-theme] .dsh-voice-card-hint { color: rgba(230, 237, 247, .55); }
body[data-ds-dark-theme] .dsh-voice-provider-btn { background: rgba(255, 255, 255, .08); color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-provider-btn:hover { background: rgba(255, 255, 255, .14); }
body[data-ds-dark-theme] .dsh-voice-provider-btn.is-primary { background: #007AFF; color: #fff; }
body[data-ds-dark-theme] .dsh-voice-input { background: rgba(255, 255, 255, .06); border-color: rgba(255, 255, 255, .14); color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-input:focus { border-color: rgba(255, 255, 255, .45); }
body[data-ds-dark-theme] .dsh-voice-switch { background: rgba(255, 255, 255, .2); }
body[data-ds-dark-theme] .dsh-voice-modal { background: #1C2230; box-shadow: rgba(0, 0, 0, .5) 0 0 1px 0, rgba(0, 0, 0, .4) 0 8px 24px 0; }

/* ---- call overlay: light canvas, two glass tiles ----
   Performance contract: the canvas is a STATIC opaque light gradient (no
   filter, no animation). backdrop-filter sits on the two tiles + controls
   whose backdrop never changes; per-frame motion (bars, breath, halos) is
   transform/opacity only. Breath = who speaks; the other side rests. */
.dsh-voice-call {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; justify-content: center;
  padding: 16px;
  background: var(--canvas, #F5F5F7);
  color: #1D1D1F;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  animation: dsh-veil-in .35s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)) backwards;
}
@keyframes dsh-veil-in { from { opacity: 0; } to { opacity: 1; } }

/* ---- left: the call face ---- */
.dsh-voice-left {
  flex: 0 0 380px;
  display: flex; flex-direction: column; align-items: center;
  padding: 20px 20px 24px;
  border-radius: 28px;
  background: rgba(255, 255, 255, .72);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 20px 60px rgba(0, 0, 0, .08), 0 1px 2px rgba(0, 0, 0, .04);
  animation: dsh-tile-in .35s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)) backwards;
}
@keyframes dsh-tile-in {
  from { opacity: 0; transform: scale(.98); } to { opacity: 1; transform: none; }
}

/* current-call duration (resets on every armed loop), centered above the hero */
.dsh-voice-duration {
  margin-top: 8px; text-align: center;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 15px; font-weight: 500;
  color: #6E6E73;
  font-variant-numeric: tabular-nums;
}

/* hero row: whale | waveform | hang-up, centered as one cluster */
.dsh-voice-hero {
  display: flex; align-items: center; justify-content: center;
  gap: 18px; width: 100%; margin-top: 40px; flex: none;
}
.dsh-voice-avatar-wrap {
  position: relative; width: 84px; height: 84px;
  display: grid; place-items: center; flex: none;
}
.dsh-voice-avatar-circle {
  width: 72px; height: 72px; border-radius: 50%;
  display: grid; place-items: center;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .06);
  color: #1D1D1F;
}
.dsh-voice-whale { width: 38px; height: auto; display: block; will-change: transform; }

/* breath halos: pre-blurred rings behind each target (rasterized once) */
.dsh-voice-halo {
  position: absolute; inset: -20%;
  border-radius: 50%;
  filter: blur(12px);
  pointer-events: none;
  opacity: 0;
  will-change: transform, opacity;
}
.dsh-voice-halo-blue { background: radial-gradient(circle, rgba(0, 122, 255, .38), rgba(0, 122, 255, .10) 58%, transparent 75%); }
.dsh-voice-halo-red { background: radial-gradient(circle, rgba(255, 59, 48, .42), rgba(255, 59, 48, .10) 58%, transparent 75%); }

/* signature element: voice-memos waveform (ink, round-capped bars) */
.dsh-voice-wave {
  flex: 0 0 170px; min-width: 0;
  display: flex; align-items: center; justify-content: space-between;
  gap: 4px; height: 56px; margin: 0;
}
.dsh-voice-wave-bar {
  width: 4px; height: 6px; border-radius: 2px;
  background: #1D1D1F; opacity: .85;
  will-change: transform;
}
.dsh-voice-call[data-phase="thinking"] .dsh-voice-wave-bar,
.dsh-voice-call[data-phase="idle"] .dsh-voice-wave-bar { opacity: .25; }

.dsh-voice-hangup-wrap { position: relative; flex: none; display: grid; place-items: center; }
.dsh-voice-hangup {
  position: relative; z-index: 1;
  width: 72px; height: 72px; border-radius: 50%; cursor: pointer;
  background: #FF3B30;
  border: none;
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(255, 59, 48, .3);
  transition: filter .15s;
  will-change: transform;
}
.dsh-voice-hangup:hover { filter: brightness(1.08); }
.dsh-voice-hangup:active { filter: brightness(.94); }

.dsh-voice-state-word {
  margin-top: 14px;
  font-size: 15px; font-weight: 500;
  color: #6E6E73;
}

/* live transcript / notices */
.dsh-voice-live {
  min-height: 64px; margin-top: 18px; width: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  text-align: center; padding: 0 4px;
}
.dsh-voice-live > div {
  max-height: 44px; overflow-y: auto; width: 100%;
  font-size: 15px; line-height: 1.5;
  scrollbar-width: thin; scrollbar-color: rgba(0,0,0,.18) transparent;
}
.dsh-voice-live-interim { color: #1D1D1F; }
.dsh-voice-live-hint { color: #86868B; font-size: 13px; }
.dsh-voice-live-warn { color: #B25000; font-size: 13px; }
.dsh-voice-live-error { color: #FF3B30; font-size: 13px; }

/* ---- controls pill: speaker + rate (session-scope) ---- */
.dsh-voice-controls {
  margin-top: auto;
  width: 100%;
  display: flex; align-items: center; justify-content: center;
  border-radius: 18px;
  background: rgba(255, 255, 255, .92);
  border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .05);
  overflow: hidden;
}
/* every control is reachable (the old sheet only re-enabled buttons) */
.dsh-voice-controls button,
.dsh-voice-controls select,
.dsh-voice-controls input,
.dsh-voice-controls .dsh-voice-ctl { pointer-events: auto; }

.dsh-voice-ctl {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  height: 52px; padding: 0 18px;
  font-size: 14px; color: #1D1D1F;
  cursor: pointer; user-select: none;
  border: none; background: none;
  transition: background .15s;
  max-width: 150px;
}
.dsh-voice-ctl:hover, .dsh-voice-ctl:focus-within { background: rgba(0, 0, 0, .04); }
.dsh-voice-ctl + .dsh-voice-ctl { border-left: 1px solid rgba(0, 0, 0, .08); }
.dsh-voice-ctl-value {
  display: inline-flex; align-items: center; gap: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-voice-ctl:not(.dsh-voice-rate) .dsh-voice-ctl-value::after {
  content: ''; width: 7px; height: 7px; flex: none;
  border-right: 1.5px solid #86868B; border-bottom: 1.5px solid #86868B;
  transform: rotate(45deg) translateY(-2px);
}
.dsh-voice-ctl-select {
  appearance: none; -webkit-appearance: none;
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; cursor: pointer; border: none; background: none; color: inherit;
  font-size: 14px;
}
.dsh-voice-rate { font-variant-numeric: tabular-nums; }

/* skip row (visible while speaking; reserved space, no layout jump) */
.dsh-voice-hangup-row {
  margin-top: 12px; min-height: 22px;
  display: flex; align-items: center; justify-content: center;
}
.dsh-voice-skip {
  border: none; background: none; cursor: pointer;
  color: #007AFF; font-size: 14px;
  padding: 0 4px;
}
.dsh-voice-skip[data-visible="false"] { visibility: hidden; }

/* ---- right: the collapsible session stream ---- */
.dsh-voice-right {
  position: relative;
  flex: 1 1 0; min-width: 0; margin-left: 16px;
  display: flex;
  border-radius: 28px;
  background: rgba(255, 255, 255, .72);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 20px 60px rgba(0, 0, 0, .08), 0 1px 2px rgba(0, 0, 0, .04);
  overflow: hidden;
  animation: dsh-tile-in .35s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)) .05s backwards;
  transition: flex-grow .32s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)), margin-left .32s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)), opacity .25s, transform .32s var(--dsh-ease, cubic-bezier(.25,.1,.25,1));
}
.dsh-voice-call.is-collapsed .dsh-voice-right {
  flex-grow: 0; margin-left: 0;
  opacity: 0; transform: translateX(24px);
  pointer-events: none;
}
.dsh-voice-stream {
  flex: 1; overflow-y: auto; padding: 24px 28px 28px;
  display: flex; flex-direction: column; gap: 14px;
  scrollbar-width: thin; scrollbar-color: rgba(0,0,0,.18) transparent;
}
.dsh-voice-msg { display: flex; gap: 8px; align-items: flex-end; animation: dsh-msg-in .25s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)) backwards; }
@keyframes dsh-msg-in {
  from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; }
}
.dsh-voice-msg-avatar {
  width: 28px; height: 28px; border-radius: 50%; flex: none;
  margin-bottom: 2px;
  opacity: .95;
}
.dsh-voice-msg-user { justify-content: flex-end; }
.dsh-voice-msg-user .dsh-voice-bubble {
  max-width: 70%;
  background: #007AFF; color: #fff;
  border-radius: 18px 18px 4px 18px;
  padding: 9px 14px; font-size: 15px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
}
.dsh-voice-msg-ai { max-width: 84%; }
.dsh-voice-msg-ai .dsh-voice-msg-body {
  min-width: 0;
  background: #E9E9EB; color: #1D1D1F;
  border-radius: 4px 18px 18px 18px;
  padding: 9px 14px;
}
.dsh-voice-prose {
  margin: 0; font-size: 15px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
}
.dsh-voice-prose + .dsh-voice-prose, .dsh-voice-prose + .dsh-voice-code, .dsh-voice-code + .dsh-voice-prose { margin-top: 8px; }
.dsh-voice-code {
  margin: 0; padding: 10px 12px; border-radius: 10px; overflow-x: auto;
  background: #292A30; border: none;
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; line-height: 1.6;
  color: #F5F5F7; white-space: pre;
}
.dsh-voice-msg-empty { opacity: .4; }
.dsh-voice-caret {
  display: inline-block; width: 2px; height: 1em; margin-left: 1px;
  background: rgba(0, 0, 0, .4); vertical-align: text-bottom;
  animation: dsh-caret-blink 1s steps(1) infinite;
}
@keyframes dsh-caret-blink { 50% { opacity: 0; } }

/* iMessage typing dots: the loop's ONLY ambient animation (semantic: generating) */
.dsh-voice-typing {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 12px 14px;
  background: #E9E9EB; border-radius: 4px 18px 18px 18px;
}
.dsh-voice-typing i {
  width: 8px; height: 8px; border-radius: 50%;
  background: #86868B;
  animation: dsh-typing 1.2s ease-in-out infinite;
}
.dsh-voice-typing i:nth-child(2) { animation-delay: .15s; }
.dsh-voice-typing i:nth-child(3) { animation-delay: .3s; }
@keyframes dsh-typing {
  0%, 60%, 100% { opacity: .3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

/* collapse handle: floats at the right edge, outside the stream */
.dsh-voice-collapse {
  position: absolute; top: 50%; right: 14px;
  transform: translateY(-50%);
  width: 32px; height: 64px;
  border: 1px solid rgba(0, 0, 0, .12);
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .14);
  display: grid; place-items: center;
  cursor: pointer; padding: 0;
  transition: background .15s, transform .15s;
  z-index: 10;
}
.dsh-voice-collapse:hover { background: #fff; transform: translateY(-50%) scale(1.06); }
.dsh-voice-collapse i {
  width: 9px; height: 9px;
  border-left: 2px solid #6E6E73; border-bottom: 2px solid #6E6E73;
  transition: transform .3s var(--dsh-ease, cubic-bezier(.25,.1,.25,1));
  transform: rotate(-45deg) scale(.9);
  margin-right: -2px;
}
.dsh-voice-call.is-collapsed .dsh-voice-collapse i {
  transform: rotate(135deg) scale(.9);
  margin-right: 2px;
}

@media (max-width: 860px) {
  .dsh-voice-call { flex-direction: column; padding: 10px; }
  .dsh-voice-left { flex: 0 0 auto; }
  .dsh-voice-right { flex: 1 1 0; margin-left: 0; margin-top: 10px; }
  .dsh-voice-collapse { top: auto; bottom: 14px; }
  .dsh-voice-hero { gap: 12px; margin-top: 20px; }
  .dsh-voice-avatar-wrap { width: 76px; height: 76px; }
  .dsh-voice-avatar-circle { width: 68px; height: 68px; }
  .dsh-voice-whale { width: 36px; }
  .dsh-voice-hangup { width: 68px; height: 68px; }
  .dsh-voice-wave { flex: 0 0 120px; height: 40px; }
  .dsh-voice-duration { margin-top: 2px; }
  .dsh-voice-live { min-height: 48px; margin-top: 10px; }
  .dsh-voice-stream { padding: 16px 14px 20px; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-voice-call, .dsh-voice-left, .dsh-voice-right, .dsh-voice-msg { animation: none !important; }
  .dsh-voice-mic.is-listening svg, .dsh-voice-caret, .dsh-voice-typing i {
    animation: none !important;
  }
  .dsh-voice-wave-bar { transform: none !important; }
  .dsh-voice-whale, .dsh-voice-hangup { transform: none !important; }
  .dsh-voice-halo { display: none !important; }
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
