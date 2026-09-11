# dsh-voice-talk

Voice chat mode for DSH Web: tap the mic to enter a full-screen call, speak and listen as you go, and replies are read aloud as they stream. Bilingual UI, light/dark theme aware, with speech-rate and voice controls.

[中文](README.md) | English

[![npm version](https://img.shields.io/npm/v/dsh-voice-talk.svg)](https://www.npmjs.com/package/dsh-voice-talk)
[![license](https://img.shields.io/npm/l/dsh-voice-talk.svg)](./LICENSE)

![Call mode](docs/screenshots/call-mode.png)

## Quick start

### 1. Install

**Recommended: install from npm**

```sh
dsh plugin --profile web add dsh-voice-talk
```

Restart after install:

```sh
dsh web
```

**Install from source**

For following development, or running an unreleased version:

```sh
git clone https://github.com/duoduoqian708/dsh-voice-talk.git
cd dsh-voice-talk
npm install && npm run build
dsh plugin --profile web add /path/to/dsh-voice-talk
```

- `npm run typecheck` type-checks; `npm run build` produces `lib/index.js` (the host half) and `lib/client.js` (the browser half).

### 2. Configure a model

After installing, configure it under **Settings → Plugins → Voice chat**.

Qwen is recommended: usage-based billing with no subscription plan needed, so the cost for personal use stays under control (≈¥0.33 per 1k characters; pricing varies by model), and in our testing its Chinese speech sounds the most natural.

1. Get a DashScope API Key from Alibaba Cloud Model Studio: https://bailian.console.aliyun.com/?apiKey=1
2. Paste the key into Qwen's "Settings" back on the settings page — the model and endpoint are already built in, so one key is all you need; to make "Speak" use Qwen as well, click "Enable" on that row too.
3. Top up your account a little and you are set. "Listen" requires a cloud engine; with the key in place, both directions work.

iFlytek is built in as well and configured the same way on the settings page.

### 3. Start talking

There is a mic icon next to the input box on the conversation page or workspace; tap it to enter the full-screen call and just start speaking. The red hang-up button or `Esc` exits; you can mute or collapse the panel mid-call.

![Microphone entry next to the input box](docs/screenshots/mic-entry.png)

## Voice engines

| Direction | Engine | Cost | Credentials |
|---|---|---|---|
| Speak | System voice | Free · offline | None |
| Speak · Listen | **Qwen (recommended)** | ≈¥0.33 per 1k chars | DashScope API Key |
| Speak · Listen | iFlytek | Daily free quota | APPID + API Key + API Secret |

Key entry: Settings → Plugins → Voice chat → "Settings" on the engine row. Once filled in, click "Preview / Test mic" to verify.

## Settings

Changes on the settings page are persistent defaults; changes made in the call overlay are **per-session** — they survive hang-up and reset on a new session. Voice and rate can also be adjusted temporarily during a call.

| Setting | Description | Default |
|---|---|---|
| Barge-in while speaking | Interrupt the readout by speaking; headphones recommended | Off |
| Auto-send after a pause (s) | How long a pause submits the utterance | 2 |
| Voice wave | Call-overlay waveform style: equalizer / ripple | Ripple |
| Rate | Readout speed, default per engine, adjustable per session | 1.0x |

![Settings page](docs/screenshots/settings.png)

## Highlights

- Follows the system theme: light / dark out of the box.
- Bilingual UI (Chinese / English): follows the platform language setting.
- Keys stay on your machine and are never uploaded: the browser never sees them, and speech requests are proxied by the host.
- Open source under MIT: auditable and self-hostable.

## FAQ

**Q**: The mic does nothing, or it stays stuck on "Listening" — what now?

**A**: Go to Settings → Plugins → Voice chat and make sure the "Listen" engine has credentials configured and enabled.

**Q**: Replies show as text, but I hear nothing?

**A**: Make sure the "Speak" engine is enabled; for cloud engines check the key and account balance, and for the system voice check the system volume and selected voice.

**Q**: Speaking does not interrupt the readout?

**A**: Barge-in is off by default — turn it on manually. Headphones are recommended; otherwise the speaker output is picked up by the mic and interferes with interruption detection.

## Easter egg

Suppose your shoulders and neck ache and you would rather not stare at a screen; suppose you happen to have a proxy port open; suppose you want to exercise and work at the same time — take your phone out for a walk and talk through your development while strolling.

<p align="center"><img src="docs/screenshots/call-mode-mobile.png" alt="The call overlay on a phone" width="240"></p>

## Requirements

- dsh ≥ 0.1.0-rc.7 with the `web` profile
- Chrome / Edge
- Microphone permission; a network connection for cloud recognition

## Feedback

Found a problem or have an idea? Open an [issue](https://github.com/duoduoqian708/dsh-voice-talk/issues).

## License

[MIT](./LICENSE)
