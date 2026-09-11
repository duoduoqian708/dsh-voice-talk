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
.dsh-voice-row-left { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dsh-voice-row-hint { font-size: 11px; color: #86868B; }
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

/* ---- settings card: engine setup guide ---- */
.dsh-voice-setup { display: grid; gap: 8px; padding: 10px 12px; border-radius: 10px; background: rgba(0, 0, 0, .03); }
.dsh-voice-setup-note { margin: 0; font-size: 12px; color: #6E6E73; }
.dsh-voice-setup-link { color: #007AFF; text-decoration: none; }
.dsh-voice-setup-link:hover { text-decoration: underline; }
.dsh-voice-setup-ok { font-size: 11px; color: #34C759; margin-left: 6px; }
.dsh-voice-setup-actions { display: flex; align-items: center; gap: 10px; }

/* ---- settings card: one unified panel (基础设置 + 音色引擎, not separate boxes) ---- */
.dsh-voice-panel {
  display: flex; flex-direction: column;
  border: 1px solid rgba(0, 0, 0, .08);
  border-radius: 16px;
  background: #fff;
  overflow: hidden;
}
.dsh-voice-panel-sec { display: grid; gap: 8px; padding: 14px 16px; }
.dsh-voice-panel-title { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: #6E6E73; }
.dsh-voice-panel-sep { height: 1px; background: rgba(0, 0, 0, .06); }
/* engines laid out as compact rows inside the panel (no per-engine boxes) */
.dsh-voice-engine-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 2px;
}
.dsh-voice-engine-row + .dsh-voice-engine-row { border-top: 1px solid rgba(0, 0, 0, .06); }
.dsh-voice-engine-info { display: grid; gap: 3px; min-width: 0; }
.dsh-voice-engine-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.dsh-voice-engine-name { font-size: 13px; font-weight: 600; }
.dsh-voice-engine-name.is-active { color: #007AFF; }
.dsh-voice-engine-status { font-size: 11px; color: #86868B; white-space: nowrap; }
.dsh-voice-engine-status.is-missing { color: #B25000; }
.dsh-voice-engine-note { margin: 0; font-size: 11px; color: #86868B; line-height: 1.5; }
.dsh-voice-provider-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.dsh-voice-provider-btn {
  border: none; border-radius: 10px; padding: 0 14px; height: 34px; font-size: 13px; cursor: pointer;
  flex: none;
  background: rgba(0, 0, 0, .06); color: #1D1D1F;
  transition: background .15s;
}
.dsh-voice-provider-btn:hover { background: rgba(0, 0, 0, .1); }
.dsh-voice-provider-btn:disabled { opacity: .4; cursor: default; }
.dsh-voice-provider-btn.is-primary { background: #007AFF; color: #fff; }
.dsh-voice-provider-btn.is-primary:hover { background: #0071EB; }

/* ---- voice-print picker: two static thumbnails, the selected one framed ---- */
.dsh-voice-print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dsh-voice-print-card {
  padding: 10px 12px; border-radius: 12px; cursor: pointer;
  border: 1.5px solid rgba(0, 0, 0, .1); background: rgba(0, 0, 0, .03);
  display: grid; place-items: center;
  transition: border-color .15s, box-shadow .15s;
}
.dsh-voice-print-card:hover { border-color: rgba(0, 0, 0, .22); }
.dsh-voice-print-card.is-selected {
  border-color: #007AFF;
  box-shadow: 0 0 0 2.5px rgba(0, 122, 255, .18);
}
.dsh-voice-print-card:disabled { opacity: .45; cursor: default; }
.dsh-voice-print-thumb { display: block; width: 100%; }
.dsh-voice-print-thumb svg { display: block; width: 100%; height: 44px; }

/* 听 module's 试音 dialog: pulsing listen dot + rolling transcript box. */
.dsh-voice-test-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: #34C759; margin-right: 6px; vertical-align: 1px;
  animation: dsh-voice-pulse 1.4s ease-in-out infinite;
}
.dsh-voice-asr-test-text {
  max-height: 240px; overflow-y: auto; min-height: 88px;
  border: 1px solid rgba(0, 0, 0, .08); border-radius: 10px;
  background: rgba(0, 0, 0, .02);
  padding: 10px 12px; display: grid; gap: 6px; align-content: start;
}
.dsh-voice-asr-test-text p { margin: 0; font-size: 13px; line-height: 1.5; }
.dsh-voice-asr-test-interim { opacity: .55; }
.dsh-voice-asr-test-waiting { opacity: .4; }

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
.dsh-voice-modal-footer .dsh-voice-provider-btn { margin-left: auto; }
.dsh-voice-input-wide { flex: 1; max-width: none; min-width: 0; }
/* multi-line try-listen prompt: same skin, room for the full sentence */
.dsh-voice-input-area {
  height: auto; min-height: 56px; padding: 8px 10px;
  line-height: 1.5; font: inherit; resize: vertical;
}
/* the label rides the first text line instead of the box's middle */
.dsh-voice-row-top { align-items: flex-start; }
.dsh-voice-row-top .dsh-voice-row-label { padding-top: 9px; }
.dsh-voice-modal .dsh-voice-row-label { flex: none; min-width: 0; width: 84px; text-align: left; opacity: .75; }
.dsh-voice-cred-cell { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
/* the audition button sits right under the try-listen prompt row */
.dsh-voice-try-row { display: flex; justify-content: flex-end; margin-top: -4px; }

/* host dark theme: adapt card surfaces (the presenter sets the attribute) */
body[data-ds-dark-theme] .dsh-voice-card,
body[data-ds-dark-theme] .dsh-voice-modal { color: var(--dsw-alias-label-primary, #f5f6f7); }
body[data-ds-dark-theme] .dsh-voice-panel,
body[data-ds-dark-theme] .dsh-voice-setup {
  background: var(--dsw-alias-bg-layer-2, #2c2c2e);
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .12));
}
body[data-ds-dark-theme] .dsh-voice-panel-sep,
body[data-ds-dark-theme] .dsh-voice-engine-row + .dsh-voice-engine-row { border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .12)); }
body[data-ds-dark-theme] .dsh-voice-panel-title,
body[data-ds-dark-theme] .dsh-voice-engine-note,
body[data-ds-dark-theme] .dsh-voice-engine-status,
body[data-ds-dark-theme] .dsh-voice-modal-hint,
body[data-ds-dark-theme] .dsh-voice-card-hint,
body[data-ds-dark-theme] .dsh-voice-row-hint { color: var(--dsw-alias-label-tertiary, #adb2b8); }
body[data-ds-dark-theme] .dsh-voice-engine-name.is-active { color: var(--dsw-alias-state-business-primary, #679efe); }
body[data-ds-dark-theme] .dsh-voice-provider-btn {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, .08));
  color: var(--dsw-alias-label-primary, #f5f6f7);
}
body[data-ds-dark-theme] .dsh-voice-provider-btn:hover { background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, .14)); }
body[data-ds-dark-theme] .dsh-voice-provider-btn.is-primary {
  background: var(--dsw-alias-label-primary, #f5f6f7);
  color: var(--dsw-alias-bg-layer-3, #353638);
}
body[data-ds-dark-theme] .dsh-voice-provider-btn.is-primary:hover { background: var(--dsw-alias-button-primary-hover, #ebeef2); }
body[data-ds-dark-theme] .dsh-voice-input {
  background: var(--dsw-alias-bg-layer-3, #353638);
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .12));
  color: var(--dsw-alias-label-primary, #f5f6f7);
}
body[data-ds-dark-theme] .dsh-voice-input:focus { border-color: var(--dsw-alias-brand-primary, #f5f6f7); }
body[data-ds-dark-theme] .dsh-voice-print-card {
  background: var(--dsw-alias-bg-layer-3, #353638);
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .12));
}
body[data-ds-dark-theme] .dsh-voice-print-card:hover { border-color: var(--dsw-alias-border-l3, rgba(255, 255, 255, .16)); }
body[data-ds-dark-theme] .dsh-voice-print-card.is-selected { border-color: var(--dsw-alias-state-business-primary, #679efe); }
body[data-ds-dark-theme] .dsh-voice-asr-test-text {
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .12));
  background: var(--dsw-alias-bg-layer-3, #353638);
}
body[data-ds-dark-theme] .dsh-voice-switch { background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, .14)); }
body[data-ds-dark-theme] .dsh-voice-switch.is-on { background: var(--dsw-alias-state-success-primary, #22c55e); }
body[data-ds-dark-theme] .dsh-voice-modal {
  background: var(--dsw-alias-bg-layer-2, #2c2c2e);
  box-shadow: var(--dsw-shadow-lv3, rgba(0, 0, 0, .5) 0 0 1px 0, rgba(0, 0, 0, .4) 0 8px 24px 0);
}
/* call-overlay dark adaptations: hero key, markers, reasoning + tool cards */
body[data-ds-dark-theme] .dsh-voice-mickey { background: #232A3B; border-color: rgba(255, 255, 255, .12); color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-mickey[data-muted='true'] { color: #FF6961; border-color: rgba(255, 105, 97, .45); }
body[data-ds-dark-theme] .dsh-voice-mic-ring circle { stroke: rgba(255, 105, 97, .6); }
body[data-ds-dark-theme] .dsh-voice-countdown { color: #FF6961; }
body[data-ds-dark-theme] .dsh-voice-speaker-btn,
body[data-ds-dark-theme] .dsh-voice-rate-control { background: #232A3B; border-color: rgba(255, 255, 255, .12); color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-speaker-pop { background: rgba(35, 42, 59, .97); border-color: rgba(255, 255, 255, .12); }
body[data-ds-dark-theme] .dsh-voice-speaker-group { background: #232A3B; color: rgba(230, 237, 247, .55); }
body[data-ds-dark-theme] .dsh-voice-speaker-item { color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-speaker-item:hover { background: rgba(255, 255, 255, .08); }
body[data-ds-dark-theme] .dsh-voice-speaker-item[data-current='true'],
body[data-ds-dark-theme] .dsh-voice-speaker-check { color: #6AB8FF; }
body[data-ds-dark-theme] .dsh-voice-rate-track { background: rgba(255, 255, 255, .2); }
body[data-ds-dark-theme] .dsh-voice-rate-fill { background: #6AB8FF; }
body[data-ds-dark-theme] .dsh-voice-rate-thumb { background: #E6EDF7; border-color: rgba(0, 0, 0, .35); }
body[data-ds-dark-theme] .dsh-voice-rate-ticks i { background: rgba(255, 255, 255, .25); }
body[data-ds-dark-theme] .dsh-voice-rate-ticks i.is-active { background: #6AB8FF; }
body[data-ds-dark-theme] .dsh-voice-jump { background: #232A3B; border-color: rgba(255, 255, 255, .12); }
body[data-ds-dark-theme] .dsh-voice-jump i { border-color: rgba(230, 237, 247, .7); }
body[data-ds-dark-theme] .dsh-voice-marked { background: rgba(106, 184, 255, .24); }
body[data-ds-dark-theme] .dsh-voice-reasoning-head { color: rgba(230, 237, 247, .55); }
body[data-ds-dark-theme] .dsh-voice-reasoning-head:hover { color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-reasoning-body { background: rgba(255, 255, 255, .05); color: rgba(230, 237, 247, .7); }
body[data-ds-dark-theme] .dsh-voice-tool-head { border-color: rgba(255, 255, 255, .1); background: rgba(255, 255, 255, .04); color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-tool-head:hover { background: rgba(255, 255, 255, .08); }
body[data-ds-dark-theme] .dsh-voice-tool-status,
body[data-ds-dark-theme] .dsh-voice-tool-toggle,
body[data-ds-dark-theme] .dsh-voice-tool-args { color: rgba(230, 237, 247, .5); }
body[data-ds-dark-theme] .dsh-voice-question { border-color: rgba(255, 255, 255, .1); background: rgba(255, 255, 255, .04); }
body[data-ds-dark-theme] .dsh-voice-question-text,
body[data-ds-dark-theme] .dsh-voice-question-option { color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-question-badge { color: #6AB8FF; background: rgba(106, 184, 255, .14); }
body[data-ds-dark-theme] .dsh-voice-question-wait,
body[data-ds-dark-theme] .dsh-voice-question-header,
body[data-ds-dark-theme] .dsh-voice-question-desc,
body[data-ds-dark-theme] .dsh-voice-question-free,
body[data-ds-dark-theme] .dsh-voice-question-mark { color: rgba(230, 237, 247, .5); }
body[data-ds-dark-theme] .dsh-voice-question-wait::before { background: #6AB8FF; }
body[data-ds-dark-theme] .dsh-voice-question-item + .dsh-voice-question-item { border-top-color: rgba(255, 255, 255, .12); }
body[data-ds-dark-theme] .dsh-voice-question-detail { background: rgba(255, 255, 255, .05); color: rgba(230, 237, 247, .7); scrollbar-color: rgba(255, 255, 255, .25) transparent; }
body[data-ds-dark-theme] .dsh-voice-question-option[data-picked='true'] .dsh-voice-question-mark { color: #22c55e; }
body[data-ds-dark-theme] .dsh-voice-question-picked { color: #6AB8FF; }
body[data-ds-dark-theme] .dsh-voice-question-error { color: #FF6961; }
body[data-ds-dark-theme] .dsh-voice-quote { color: rgba(230, 237, 247, .72); border-left-color: rgba(255, 255, 255, .18); }
body[data-ds-dark-theme] .dsh-voice-hr { border-top-color: rgba(255, 255, 255, .14); }
body[data-ds-dark-theme] .dsh-voice-inline-code { background: rgba(255, 255, 255, .12); color: #FF9FB2; }
body[data-ds-dark-theme] .dsh-voice-link { color: #6AB8FF; }
body[data-ds-dark-theme] .dsh-voice-table th, body[data-ds-dark-theme] .dsh-voice-table td { border-color: rgba(255, 255, 255, .14); }
body[data-ds-dark-theme] .dsh-voice-table th { background: rgba(255, 255, 255, .06); }

/* host dark theme: call overlay + session stream. Colors only — no layout,
   sizing, motion or interaction rule is touched, and every selector here is
   inert under the light theme. */
body[data-ds-dark-theme] .dsh-voice-call { background: #151517; color: #E6EDF7; color-scheme: dark; }
body[data-ds-dark-theme] .dsh-voice-card,
body[data-ds-dark-theme] .dsh-voice-modal { color-scheme: dark; }
body[data-ds-dark-theme] .dsh-voice-left,
body[data-ds-dark-theme] .dsh-voice-right {
  background: #1C2230;
  border-color: rgba(255, 255, 255, .1);
  box-shadow: 0 20px 60px rgba(0, 0, 0, .45), 0 1px 2px rgba(0, 0, 0, .3);
}
body[data-ds-dark-theme] .dsh-voice-duration,
body[data-ds-dark-theme] .dsh-voice-state-word { color: rgba(230, 237, 247, .55); }
body[data-ds-dark-theme] .dsh-voice-avatar-circle {
  background: #232A3B; border-color: rgba(255, 255, 255, .12); color: #E6EDF7;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .35);
}
body[data-ds-dark-theme] .dsh-voice-wave-bar { background: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-transcript { background: rgba(255, 255, 255, .05); border-color: rgba(255, 255, 255, .1); }
body[data-ds-dark-theme] .dsh-voice-transcript-scroll { color: #E6EDF7; scrollbar-color: rgba(255, 255, 255, .25) transparent; }
body[data-ds-dark-theme] .dsh-voice-live-error { color: #FF6961; }
body[data-ds-dark-theme] .dsh-voice-skip { color: #6AB8FF; }
body[data-ds-dark-theme] .dsh-voice-live-warn { color: #FFB020; }
body[data-ds-dark-theme] .dsh-voice-card-warn,
body[data-ds-dark-theme] .dsh-voice-engine-status.is-missing { color: var(--dsw-alias-state-warn-primary, #f59e0b); }
body[data-ds-dark-theme] .dsh-voice-live > div,
body[data-ds-dark-theme] .dsh-voice-stream,
body[data-ds-dark-theme] .dsh-voice-reasoning-body { scrollbar-color: rgba(255, 255, 255, .25) transparent; }
body[data-ds-dark-theme] .dsh-voice-msg-ai .dsh-voice-msg-body { background: #232A3B; color: #E6EDF7; }
body[data-ds-dark-theme] .dsh-voice-typing { background: #232A3B; }
body[data-ds-dark-theme] .dsh-voice-typing i { background: rgba(230, 237, 247, .55); }
body[data-ds-dark-theme] .dsh-voice-typing-label { color: rgba(230, 237, 247, .55); }
body[data-ds-dark-theme] .dsh-voice-caret { background: rgba(230, 237, 247, .6); }
body[data-ds-dark-theme] .dsh-voice-collapse {
  background: #232A3B; border-color: rgba(255, 255, 255, .12);
  box-shadow: 0 2px 10px rgba(0, 0, 0, .4);
}
body[data-ds-dark-theme] .dsh-voice-collapse:hover { background: #2A3145; }
body[data-ds-dark-theme] .dsh-voice-collapse i { border-color: rgba(230, 237, 247, .7); }
body[data-ds-dark-theme] .dsh-voice-setup-note { color: var(--dsw-alias-label-tertiary, #adb2b8); }
body[data-ds-dark-theme] .dsh-voice-setup-link { color: var(--dsw-alias-state-business-primary, #679efe); }
body[data-ds-dark-theme] .dsh-voice-modal-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, .08)); }
body[data-ds-dark-theme] .dsh-voice-modal-divider { color: var(--dsw-alias-label-tertiary, #adb2b8); }
body[data-ds-dark-theme] .dsh-voice-modal-divider::after { background: var(--dsw-alias-border-l2, rgba(255, 255, 255, .12)); }

/* ---- call overlay: light canvas, two glass tiles ----
   Performance contract: the canvas is a STATIC opaque light gradient (no
   filter, no animation), and the two big tiles carry NO backdrop-filter —
   their backdrop is that flat canvas, so a blur is invisible while its
   recomposite would land on every fold/scroll frame. Only the speaker popup
   (whose backdrop has content) keeps one. Per-frame motion (bars, breath,
   fold) is transform/opacity/layout only. Breath = who speaks. */
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

/* ---- left: the call face (half the stage; full stage when collapsed) ---- */
.dsh-voice-left {
  position: relative; z-index: 1;
  /* Query container for the controls row: its stacking decision keys off the
     TILE's own width, so a squeezed pane (phone split, a future custom split
     ratio) stacks while a wide one keeps the row — no device/viewport logic. */
  container-type: inline-size;
  flex: 1 1 0; min-width: 0;
  display: flex; flex-direction: column; align-items: center;
  padding: 20px 20px 24px;
  /* Junction side squared: the tiles read as ONE surface split by the 1px
     border-right hairline (the right tile drops its left border). */
  border-radius: 28px 0 0 28px;
  /* No backdrop-filter here: the backdrop is the opaque static canvas, so a
     blur is invisible while its recomposite cost lands on every frame of the
     fold animation and stream scrolling. Only the speaker popup keeps one —
     its backdrop carries real content. */
  background: rgba(255, 255, 255, .72);
  border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 20px 60px rgba(0, 0, 0, .08), 0 1px 2px rgba(0, 0, 0, .04);
  animation: dsh-tile-in .35s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)) backwards;
  transition: border-radius .32s var(--dsh-ease, cubic-bezier(.25,.1,.25,1));
}
.dsh-voice-call.is-collapsed .dsh-voice-left { border-radius: 28px; }
@keyframes dsh-tile-in {
  from { opacity: 0; transform: scale(.98); } to { opacity: 1; transform: none; }
}

/* current-call duration (resets on every armed loop), centered above the hero */
.dsh-voice-duration {
  margin-top: auto; text-align: center;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 18px; font-weight: 500;
  color: #6E6E73;
  font-variant-numeric: tabular-nums;
}

/* hero row: whale | waveform | hang-up, floating at the panel's vertical
   center — the auto top margin splits the free space with the controls'
   own auto margin, so the cluster centers while duration stays on top */
.dsh-voice-hero {
  display: flex; align-items: center; justify-content: center;
  gap: 22px; width: 100%; margin-top: 22px; flex: none;
}
.dsh-voice-avatar-wrap {
  position: relative; width: 102px; height: 102px;
  display: grid; place-items: center; flex: none;
}
.dsh-voice-avatar-circle {
  width: 90px; height: 90px; border-radius: 50%;
  display: grid; place-items: center;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .06);
  color: #1D1D1F;
}
.dsh-voice-whale { width: 46px; height: auto; display: block; will-change: transform; }

/* signature element: voice-memos waveform (ink, round-capped bars) */
.dsh-voice-wave {
  position: relative;
  flex: 1 1 auto; min-width: 140px; max-width: 400px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 5px; height: 70px; margin: 0;
}
/* voice-print lottie fills the slot (slice crops the comp's empty bands) */
.dsh-voice-wave > svg { width: 100%; height: 100%; transition: opacity .15s ease; }
/* Idle: the paused comp is hidden and a crisp flat rule takes its place. The
   compressed comp was a faint, uneven "line" (its thickness varies along the
   path); the rule keeps the wave's own color and an exact 3px height. */
.dsh-voice-wave[data-idle='true'] > svg { opacity: 0; }
.dsh-voice-wave::after {
  content: ''; position: absolute; left: 0; right: 0; top: 50%;
  height: 1.5px; margin-top: -0.75px; border-radius: 0.75px;
  background: #7DD5D9; opacity: 0; transition: opacity .15s ease;
}
.dsh-voice-wave[data-idle='true']::after { opacity: 1; }
.dsh-voice-wave-bar {
  width: 5px; height: 6px; border-radius: 2.5px;
  background: #1D1D1F; opacity: .85;
  will-change: transform;
}
.dsh-voice-call[data-phase="thinking"] .dsh-voice-wave-bar,
.dsh-voice-call[data-phase="idle"] .dsh-voice-wave-bar { opacity: .25; }

/* hero mute key: the mic circle where the hang-up used to live */
.dsh-voice-mic-wrap { position: relative; flex: none; display: grid; place-items: center; }
.dsh-voice-mickey {
  position: relative; z-index: 1;
  width: 90px; height: 90px; border-radius: 50%; cursor: pointer;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, .08);
  color: #1D1D1F;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .06);
  transition: filter .15s, color .15s, border-color .15s;
  will-change: transform;
}
.dsh-voice-mickey:hover { filter: brightness(.97); }
.dsh-voice-mickey:active { filter: brightness(.94); }
.dsh-voice-mickey[data-muted='true'] { color: #FF3B30; border-color: rgba(255, 59, 48, .35); }

/* 60s utterance cap: depleting ring around the mic key (erodes clockwise
   from 12 o'clock while the user speaks) + the last-ten-seconds flicker. */
.dsh-voice-mic-ring {
  position: absolute; inset: -4px;
  z-index: 2; pointer-events: none;
}
.dsh-voice-mic-ring circle {
  fill: none;
  stroke: rgba(255, 59, 48, .6);
  stroke-width: 3;
  stroke-linecap: round;
}
.dsh-voice-countdown {
  margin: 0 0 4px;
  text-align: center;
  font-size: 20px; font-weight: 600; line-height: 1.2;
  color: #FF3B30;
  font-variant-numeric: tabular-nums;
}
.dsh-voice-countdown-num { display: inline-block; animation: dsh-voice-pop .8s ease both; }
@keyframes dsh-voice-pop {
  0% { transform: scale(1.7); opacity: 0; }
  35% { transform: scale(1); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

.dsh-voice-state-word {
  position: relative; margin-top: 40px;
  display: inline-flex; align-items: center;
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
.dsh-voice-live-warn { color: #B25000; font-size: 13px; }
.dsh-voice-live-error { color: #FF3B30; font-size: 13px; }

/* live transcript card: a fixed, pre-reserved display area that only lights
   up while the user is dictating. Its space stays even when empty, so the
   hero cluster and the controls never shift; text streams in, overflows
   scroll, and the newest line is followed until the user scrolls up. */
.dsh-voice-transcript {
  box-sizing: border-box;
  margin-top: 14px;
  width: min(100%, 620px); height: 90px;
  border-radius: 16px; padding: 10px 14px;
  background: rgba(0, 0, 0, .04);
  border: 1px solid rgba(0, 0, 0, .07);
  opacity: 0; visibility: hidden;
  transition: opacity .18s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)), visibility .18s;
}
.dsh-voice-transcript[data-visible='true'] { opacity: 1; visibility: visible; }
.dsh-voice-transcript-scroll {
  height: 100%; overflow-y: auto;
  font-size: 15px; line-height: 1.5; color: #1D1D1F;
  text-align: left; white-space: pre-wrap; word-break: break-word;
  scrollbar-width: thin; scrollbar-color: rgba(0,0,0,.18) transparent;
}

/* ---- controls row: three independent controls (speaker / rate / hang-up) ---- */
.dsh-voice-controls {
  margin-top: auto;
  width: 100%; max-width: 620px;
  display: flex; align-items: center; justify-content: space-between;
  /* Fallback wrapping: even without container-query support the three can
     never overlap or squeeze — they drop onto a new line instead. */
  flex-wrap: wrap;
  gap: 28px;
}
/* every control is reachable (the old sheet only re-enabled buttons) */
.dsh-voice-controls button,
.dsh-voice-controls input { pointer-events: auto; }

/* speaker: custom dropdown — a fixed-height popup scrolls inside, opens up */
.dsh-voice-speaker { position: relative; min-width: 0; flex: none; }
.dsh-voice-speaker-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 52px; padding: 0 18px; max-width: 220px;
  border-radius: 16px; cursor: pointer;
  background: rgba(255, 255, 255, .92);
  border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .05);
  color: #1D1D1F; font-size: 14px;
  transition: filter .15s;
}
.dsh-voice-speaker-btn:hover { filter: brightness(.98); }
.dsh-voice-speaker-btn[data-locked='true'] { cursor: default; opacity: .55; filter: none; }
.dsh-voice-speaker-caret {
  width: 7px; height: 7px; flex: none;
  border-right: 1.5px solid #86868B; border-bottom: 1.5px solid #86868B;
  transform: rotate(45deg) translateY(-2px);
}
.dsh-voice-speaker-pop {
  position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translateX(-50%);
  width: 280px; height: 300px; overflow-y: auto;
  padding: 6px; border-radius: 16px; z-index: 5;
  background: rgba(255, 255, 255, .96);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 18px 50px rgba(0, 0, 0, .16), 0 2px 6px rgba(0, 0, 0, .06);
  scrollbar-width: thin; scrollbar-color: rgba(0, 0, 0, .18) transparent;
}
.dsh-voice-speaker-group {
  position: sticky; top: 0; z-index: 1;
  padding: 8px 10px 4px;
  font-size: 12px; font-weight: 600; color: #86868B;
  background: rgba(255, 255, 255, .97);
}
.dsh-voice-speaker-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 10px;
  border: none; background: none; border-radius: 10px;
  cursor: pointer; text-align: left;
  color: #1D1D1F; font-size: 14px;
}
.dsh-voice-speaker-item:hover { background: rgba(0, 0, 0, .05); }
.dsh-voice-speaker-item[data-current='true'] { color: #007AFF; font-weight: 600; }
.dsh-voice-speaker-check { width: 14px; flex: none; color: #007AFF; }
.dsh-voice-speaker-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* voice picker (shared): the portal popup serves the settings modal — fixed
   and re-anchored to the trigger by the component; the modal's scroll
   container would clip an absolute popup and the veil (z-index 10000) would
   cover it. */
.dsh-voice-speaker-pop.is-portal { position: fixed; transform: none; z-index: 10050; }
.dsh-voice-speaker-btn:focus-visible { outline: 2px solid rgba(0, 122, 255, .55); outline-offset: 2px; }
/* settings modal: the picker takes the field slot the native select had */
.dsh-voice-modal .dsh-voice-speaker { flex: 1; min-width: 0; }
.dsh-voice-modal .dsh-voice-speaker-btn {
  width: 100%; max-width: none; justify-content: space-between;
  height: 34px; padding: 0 10px; border-radius: 10px; font-size: 13px;
  background: #fff; border-color: rgba(15, 17, 21, .16); box-shadow: none; color: #0F1115;
}
body[data-ds-dark-theme] .dsh-voice-modal .dsh-voice-speaker-btn {
  background: var(--dsw-alias-bg-layer-3, #353638);
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .12));
  color: var(--dsw-alias-label-primary, #f5f6f7);
}
/* the portaled popup follows the host-neutral settings palette in dark; the
   overlay's own popup keeps the stage navy. */
body[data-ds-dark-theme] .dsh-voice-speaker-pop.is-portal {
  background: var(--dsw-alias-bg-layer-3, #353638);
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .12));
}
body[data-ds-dark-theme] .dsh-voice-speaker-pop.is-portal .dsh-voice-speaker-group {
  background: var(--dsw-alias-bg-layer-3, #353638);
  color: var(--dsw-alias-label-tertiary, #adb2b8);
}
body[data-ds-dark-theme] .dsh-voice-speaker-pop.is-portal .dsh-voice-speaker-item { color: var(--dsw-alias-label-primary, #f5f6f7); }
body[data-ds-dark-theme] .dsh-voice-speaker-pop.is-portal .dsh-voice-speaker-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, .08)); }
body[data-ds-dark-theme] .dsh-voice-speaker-pop.is-portal .dsh-voice-speaker-item[data-current='true'],
body[data-ds-dark-theme] .dsh-voice-speaker-pop.is-portal .dsh-voice-speaker-check { color: var(--dsw-alias-state-business-primary, #679efe); }

/* rate: pill with the current stop + the five-notch magnet slider */
.dsh-voice-ctl-value {
  display: inline-flex; align-items: center; gap: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-voice-rate-control {
  display: inline-flex; align-items: center; gap: 12px;
  flex: none;
  height: 52px; padding: 0 18px;
  border-radius: 16px;
  background: rgba(255, 255, 255, .92);
  border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .05);
  color: #1D1D1F; font-size: 14px;
  font-variant-numeric: tabular-nums;
}
/* rate: custom magnet slider — a transparent native range on top, the track/
   fill/thumb below it follow --dsh-rate-ratio (set imperatively per input
   event, so a drag never waits on React; the snap class animates the glide). */
.dsh-voice-rate-magnet { position: relative; display: inline-flex; flex-direction: column; gap: 3px; width: 200px; }
.dsh-voice-rate-track,
.dsh-voice-rate-fill {
  position: absolute; top: 7px; height: 4px; border-radius: 2px; pointer-events: none;
}
.dsh-voice-rate-track { left: 0; right: 0; background: rgba(0, 0, 0, .12); }
.dsh-voice-rate-fill {
  left: 0;
  width: calc(9px + var(--dsh-rate-ratio, 0) * (100% - 18px));
  background: #007AFF;
}
.dsh-voice-rate-thumb {
  position: absolute; top: 0; left: calc(var(--dsh-rate-ratio, 0) * (100% - 18px));
  width: 18px; height: 18px; border-radius: 50%; pointer-events: none;
  background: #fff; border: 1px solid rgba(0, 0, 0, .15);
  box-shadow: 0 1px 4px rgba(0, 0, 0, .2);
  transition: transform .12s ease;
}
.dsh-voice-rate-magnet:hover .dsh-voice-rate-thumb { transform: scale(1.08); }
.dsh-voice-rate-magnet.is-dragging .dsh-voice-rate-thumb { transform: scale(1.15); }
.dsh-voice-rate-magnet.is-snapping .dsh-voice-rate-thumb {
  transition: left .16s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)), transform .12s ease;
}
.dsh-voice-rate-magnet.is-snapping .dsh-voice-rate-fill {
  transition: width .16s var(--dsh-ease, cubic-bezier(.25,.1,.25,1));
}
.dsh-voice-rate-magnet input[type='range'] {
  appearance: none; -webkit-appearance: none;
  position: relative; z-index: 2;
  width: 100%; height: 18px; margin: 0; background: none; cursor: pointer;
  touch-action: none;
}
.dsh-voice-rate-magnet input[type='range']:focus-visible {
  outline: 2px solid rgba(0, 122, 255, .55); outline-offset: 3px; border-radius: 10px;
}
.dsh-voice-rate-magnet input[type='range']::-webkit-slider-runnable-track {
  height: 4px; background: transparent;
}
.dsh-voice-rate-magnet input[type='range']::-webkit-slider-thumb {
  appearance: none; -webkit-appearance: none;
  width: 18px; height: 18px; margin-top: -7px; border-radius: 50%;
  background: transparent; border: none; box-shadow: none;
}
.dsh-voice-rate-magnet input[type='range']::-moz-range-track {
  height: 4px; background: transparent;
}
.dsh-voice-rate-magnet input[type='range']::-moz-range-thumb {
  width: 18px; height: 18px; border-radius: 50%;
  background: transparent; border: none; box-shadow: none;
}
.dsh-voice-rate-ticks { display: flex; align-items: center; justify-content: space-between; padding: 0 8px; pointer-events: none; }
.dsh-voice-rate-ticks i { width: 4px; height: 4px; border-radius: 50%; background: rgba(0, 0, 0, .18); }
.dsh-voice-rate-ticks i.is-active { background: #007AFF; }

/* hang-up: red round key, sized to the controls row's 52px height */
.dsh-voice-hangup-ctl {
  width: 52px; height: 52px; border-radius: 50%; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; cursor: pointer;
  background: #FF3B30; color: #fff;
  box-shadow: 0 4px 12px rgba(255, 59, 48, .3), 0 1px 3px rgba(0, 0, 0, .12);
  transition: filter .15s, transform .1s;
}
.dsh-voice-hangup-ctl svg { width: 18px; height: 18px; }
.dsh-voice-hangup-ctl:hover { filter: brightness(1.06); }
.dsh-voice-hangup-ctl:active { transform: scale(.96); filter: brightness(.96); }

/* skip readout: rides the state word's right edge (absolute, so the word
   stays perfectly centered either way; hidden while not speaking) */
.dsh-voice-skip {
  position: absolute; left: calc(100% + 12px); top: 50%;
  transform: translateY(-50%); white-space: nowrap;
  border: none; background: none; cursor: pointer;
  color: #007AFF; font-size: 14px;
  padding: 0;
}
.dsh-voice-skip[data-visible="false"] { visibility: hidden; }

/* ---- right: the collapsible session stream ---- */
.dsh-voice-right {
  position: relative;
  flex: 1 1 0; min-width: 0; margin-left: 0;
  display: flex;
  /* The left border is dropped: the junction hairline is the LEFT tile's
     border-right — two adjacent borders would read as a 2px seam. */
  border-radius: 0 28px 28px 0;
  /* See the left tile: no backdrop-filter on the big surfaces. */
  background: rgba(255, 255, 255, .72);
  border: 1px solid rgba(0, 0, 0, .08);
  border-left: none;
  box-shadow: 0 20px 60px rgba(0, 0, 0, .08), 0 1px 2px rgba(0, 0, 0, .04);
  overflow: hidden;
  contain: layout paint;
  animation: dsh-tile-in .35s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)) .05s backwards;
  transition: flex-grow .32s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)), margin-left .32s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)), opacity .25s, transform .32s var(--dsh-ease, cubic-bezier(.25,.1,.25,1)), border-radius .32s var(--dsh-ease, cubic-bezier(.25,.1,.25,1));
}
.dsh-voice-call.is-collapsed .dsh-voice-right {
  flex-grow: 0; margin-left: 0;
  opacity: 0; transform: translateX(24px);
  pointer-events: none;
}
.dsh-voice-stream {
  flex: 1; overflow-y: auto; padding: 32px 28px 36px;
  display: flex; flex-direction: column; gap: 14px;
  scrollbar-width: thin; scrollbar-color: rgba(0,0,0,.18) transparent;
}
/* Fold: the tile fades fast, then its content stops painting for the rest of
   the flex transition — the shrinking width never repaints streaming text. */
.dsh-voice-call.is-collapsed .dsh-voice-stream { visibility: hidden; transition: visibility 0s linear .15s; }
/* jump-to-latest: floats bottom-right while the user is reading history */
.dsh-voice-jump {
  position: absolute; right: 20px; bottom: 20px; z-index: 6;
  width: 36px; height: 36px; border-radius: 50%;
  display: grid; place-items: center;
  border: 1px solid rgba(0, 0, 0, .1);
  background: #fff; cursor: pointer; padding: 0;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .16);
  transition: transform .15s;
}
.dsh-voice-jump:hover { transform: scale(1.08); }
.dsh-voice-jump i {
  width: 8px; height: 8px; margin-top: -2px;
  border-right: 2px solid #6E6E73; border-bottom: 2px solid #6E6E73;
  transform: rotate(45deg);
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
/* karaoke marker: the run the readout has already played. The padding +
   negative margin widens the tinted band without shifting the text. */
.dsh-voice-marked {
  background: rgba(0, 122, 255, .14);
  padding: .12em .3em;
  margin: -.12em -.3em;
  border-radius: .35em;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

/* ---- markdown shapes (headings / lists / quotes / tables / inline) ---- */
.dsh-voice-heading { margin: 10px 0 4px; line-height: 1.4; word-break: break-word; }
.dsh-voice-heading:first-child { margin-top: 0; }
.dsh-voice-heading + .dsh-voice-prose, .dsh-voice-prose + .dsh-voice-heading { margin-top: 8px; }
.dsh-voice-list { margin: 6px 0 0; padding-left: 20px; }
.dsh-voice-list li { margin: 3px 0; font-size: 14.5px; line-height: 1.5; word-break: break-word; }
.dsh-voice-list:first-child { margin-top: 0; }
.dsh-voice-quote {
  margin: 8px 0 0; padding: 2px 0 2px 10px;
  border-left: 3px solid rgba(0, 0, 0, .14);
  font-size: 14px; line-height: 1.5; color: #55565B;
  word-break: break-word; white-space: pre-wrap;
}
.dsh-voice-quote:first-child { margin-top: 0; }
.dsh-voice-hr { margin: 10px 0; border: none; border-top: 1px solid rgba(0, 0, 0, .12); }
.dsh-voice-inline-code {
  padding: 1px 5px; border-radius: 5px;
  background: rgba(0, 0, 0, .07); color: #D6336C;
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px;
}
.dsh-voice-link { color: #007AFF; text-decoration: none; word-break: break-word; }
.dsh-voice-link:hover { text-decoration: underline; }
.dsh-voice-table-wrap { margin: 8px 0 0; overflow-x: auto; border-radius: 8px; }
.dsh-voice-table {
  width: 100%; border-collapse: collapse;
  font-size: 13.5px; line-height: 1.5;
}
.dsh-voice-table th, .dsh-voice-table td {
  padding: 6px 9px; text-align: left; vertical-align: top;
  border: 1px solid rgba(0, 0, 0, .1); word-break: break-word;
}
.dsh-voice-table th { background: rgba(0, 0, 0, .045); font-weight: 600; }

/* collapsible reasoning (the native stream's thinking section) */
.dsh-voice-reasoning { margin-top: 6px; }
.dsh-voice-reasoning-head {
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: none; cursor: pointer; padding: 2px 0;
  font-size: 12px; color: #86868B;
}
.dsh-voice-reasoning-head:hover { color: #1D1D1F; }
.dsh-voice-reasoning-dot { width: 6px; height: 6px; border-radius: 50%; background: #86868B; }
.dsh-voice-reasoning-toggle { font-size: 11px; opacity: .7; }
.dsh-voice-reasoning-body {
  margin: 6px 0 0; padding: 8px 10px;
  font-size: 12.5px; line-height: 1.55; color: #6E6E73;
  background: rgba(0, 0, 0, .035); border-radius: 10px;
  white-space: pre-wrap; word-break: break-word;
  max-height: 240px; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: rgba(0,0,0,.18) transparent;
}

/* tool cards: call heads, running calls, settled results */
.dsh-voice-tool { margin-top: 6px; min-width: 0; }
.dsh-voice-tool-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: 1px solid rgba(0, 0, 0, .08); border-radius: 10px;
  background: rgba(0, 0, 0, .025); cursor: pointer; padding: 6px 10px;
  font-size: 12.5px; color: #1D1D1F; text-align: left;
  transition: background .15s;
}
.dsh-voice-tool-head:hover { background: rgba(0, 0, 0, .05); }
.dsh-voice-tool-status { flex: none; font-size: 11px; color: #86868B; }
.dsh-voice-tool[data-ok='false'] .dsh-voice-tool-status { color: #FF3B30; }
.dsh-voice-tool[data-ok='true'] .dsh-voice-tool-status { color: #34C759; }
.dsh-voice-tool[data-running='true'] .dsh-voice-tool-status { color: #007AFF; animation: dsh-voice-pulse 1.4s ease-in-out infinite; }
.dsh-voice-tool-name { flex: none; font-weight: 600; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.dsh-voice-tool-args {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; color: #86868B;
}
.dsh-voice-tool-toggle { flex: none; font-size: 11px; color: #86868B; }
.dsh-voice-tool-body {
  margin: 6px 0 0; padding: 8px 10px; border-radius: 10px;
  max-height: 220px; overflow: auto;
  background: #292A30; color: #F5F5F7;
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent;
}
/* question interactions: the questions-protocol card (display-only mirror;
   the voice loop answers, the card shows the ask and the chosen labels) */
.dsh-voice-question {
  margin-top: 6px; min-width: 0;
  border: 1px solid rgba(0, 0, 0, .08); border-radius: 12px;
  background: rgba(0, 0, 0, .025); padding: 10px 12px;
}
.dsh-voice-question-head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.dsh-voice-question-badge {
  flex: none; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600; letter-spacing: .02em;
  color: #007AFF; background: rgba(0, 122, 255, .1);
}
.dsh-voice-question-wait { flex: 1; text-align: right; font-size: 11px; color: #86868B; }
.dsh-voice-question-wait::before {
  content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 5px;
  border-radius: 50%; background: #007AFF; vertical-align: 1px;
  animation: dsh-voice-pulse 1.4s ease-in-out infinite;
}
.dsh-voice-question-error { flex: 1; text-align: right; font-size: 11px; color: #FF3B30; }
.dsh-voice-question-item + .dsh-voice-question-item {
  margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(0, 0, 0, .1);
}
.dsh-voice-question-header { margin-bottom: 2px; font-size: 11px; font-weight: 600; color: #86868B; }
.dsh-voice-question-text { font-size: 13px; line-height: 1.5; color: #1D1D1F; }
.dsh-voice-question-detail {
  margin-top: 6px; padding: 6px 8px; border-radius: 8px;
  background: rgba(0, 0, 0, .035); color: #6E6E73;
  font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
  max-height: 180px; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: rgba(0,0,0,.18) transparent;
}
.dsh-voice-question-options { list-style: none; margin: 7px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.dsh-voice-question-option { display: flex; align-items: baseline; gap: 7px; font-size: 12.5px; line-height: 1.45; color: #1D1D1F; opacity: .72; }
.dsh-voice-question-option[data-picked='true'] { opacity: 1; font-weight: 600; }
.dsh-voice-question-mark { flex: none; width: 14px; text-align: center; font-size: 11px; color: #86868B; }
.dsh-voice-question-option[data-picked='true'] .dsh-voice-question-mark { color: #34C759; }
.dsh-voice-question-label { flex: none; }
.dsh-voice-question-desc { flex: 1; min-width: 0; font-size: 11.5px; color: #86868B; }
.dsh-voice-question-free { margin-top: 5px; font-size: 11.5px; color: #86868B; }
.dsh-voice-question-picked { margin-top: 7px; font-size: 12px; font-weight: 600; color: #007AFF; }
.dsh-voice-question[data-settled='false'] .dsh-voice-question-picked { display: none; }

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
.dsh-voice-typing-label {
  margin-left: 6px; font-size: 13px; line-height: 1; color: #86868B;
}
@keyframes dsh-typing {
  0%, 60%, 100% { opacity: .3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

/* collapse handle: rides the divider line (the left tile's right edge) at
   mid-height; the flex transition carries it to the screen edge on fold */
.dsh-voice-collapse {
  position: absolute; top: 50%; right: 0;
  transform: translate(50%, -50%);
  width: 28px; height: 28px;
  border: 1px solid rgba(0, 0, 0, .1);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .16);
  display: grid; place-items: center;
  cursor: pointer; padding: 0;
  transition: background .15s, transform .15s;
  z-index: 10;
}
.dsh-voice-collapse:hover { background: #fff; transform: translate(50%, -50%) scale(1.08); }
.dsh-voice-collapse i {
  width: 7px; height: 7px;
  border-right: 2px solid #6E6E73; border-bottom: 2px solid #6E6E73;
  transition: transform .3s var(--dsh-ease, cubic-bezier(.25,.1,.25,1));
  transform: rotate(-45deg) scale(.9); /* ">" — fold the stream away */
  margin-right: 2px;
}
.dsh-voice-call.is-collapsed .dsh-voice-collapse i {
  transform: rotate(135deg) scale(.9); /* "<" — bring it back */
  margin-right: 0;
  margin-left: 2px;
}

@media (max-width: 860px) {
  .dsh-voice-call { flex-direction: column; padding: 10px; }
  .dsh-voice-left { flex: 0 0 auto; border-radius: 28px; }
  .dsh-voice-right { flex: 1 1 0; margin-left: 0; margin-top: 10px; border-left: 1px solid rgba(0, 0, 0, .08); border-radius: 28px; }
  .dsh-voice-hero { gap: 12px; margin-top: 20px; }
  .dsh-voice-avatar-wrap { width: 76px; height: 76px; }
  .dsh-voice-avatar-circle { width: 68px; height: 68px; }
  .dsh-voice-whale { width: 36px; }
  .dsh-voice-mickey { width: 68px; height: 68px; }
  .dsh-voice-controls { gap: 14px; }
  .dsh-voice-speaker-btn { max-width: 170px; padding: 0 14px; }
  .dsh-voice-speaker-pop { width: 240px; height: 260px; }
  .dsh-voice-rate-control { padding: 0 14px; gap: 10px; }
  .dsh-voice-rate-magnet { width: 140px; }
  .dsh-voice-hangup-ctl { width: 52px; height: 52px; }
  .dsh-voice-wave { flex: 0 0 120px; height: 40px; }
  .dsh-voice-duration { margin-top: 12px; }
  .dsh-voice-live { min-height: 48px; margin-top: 10px; }
  .dsh-voice-transcript { height: 78px; margin-top: 10px; }
  .dsh-voice-stream { padding: 20px 14px 24px; }
}

/* Cramped tile (half a narrow phone, or any pane squeezed below the three
   controls' comfortable envelope — ~620px): stack them into one centered
   column, each pill at its natural width, with breathing room between rows.
   Keys off the TILE width (container query), never the device. */
@container (max-width: 620px) {
  .dsh-voice-controls {
    flex-direction: column;
    row-gap: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-voice-call, .dsh-voice-left, .dsh-voice-right, .dsh-voice-msg { animation: none !important; }
  .dsh-voice-mic.is-listening svg, .dsh-voice-caret, .dsh-voice-typing i {
    animation: none !important;
  }
  .dsh-voice-wave-bar { transform: none !important; }
  .dsh-voice-whale, .dsh-voice-mickey { transform: none !important; }
  .dsh-voice-rate-magnet.is-snapping .dsh-voice-rate-thumb,
  .dsh-voice-rate-magnet.is-snapping .dsh-voice-rate-fill { transition: none !important; }
}
`

/** Inject the sheet once per page, refreshing its content when the plugin
 *  reloads without a full page refresh (upsert: a stale tag would otherwise
 *  keep old CSS while the new JS runs). */
export function injectVoiceStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.querySelector<HTMLStyleElement>('style[data-plugin-css="dsh-voice-talk/styles.css"]')
  if (existing !== null) {
    if (existing.textContent !== CSS) existing.textContent = CSS
    return
  }
  const tag = document.createElement('style')
  tag.dataset.pluginCss = 'dsh-voice-talk/styles.css'
  tag.textContent = CSS
  document.head.appendChild(tag)
}
