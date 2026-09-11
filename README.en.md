# dsh-voice-talk

Voice chat mode for DSH Web: tap the mic to enter a full-screen call, speak and listen as you go, and replies are read aloud as they stream. Bilingual UI, light/dark theme aware, with speech-rate and voice controls.

English | [中文](README.md)

[![npm version](https://img.shields.io/npm/v/dsh-voice-talk.svg)](https://www.npmjs.com/package/dsh-voice-talk)
[![license](https://img.shields.io/npm/l/dsh-voice-talk.svg)](./LICENSE)

![Call mode](docs/screenshots/call-mode.png)

## Quick start

### 1. Install

```sh
dsh plugin --profile web add dsh-voice-talk
dsh web   # restart after install
```

Install from source:

```sh
git clone https://github.com/duoduoqian708/dsh-voice-talk.git
cd dsh-voice-talk && npm install && npm run build
dsh plugin --profile web add /path/to/dsh-voice-talk
```

Requires dsh ≥ 0.1.0-rc.7 (`web` profile), Chrome / Edge, microphone permission and a network connection.

### 2. Configure a model

Settings → Plugins → Voice chat. Qwen is recommended: get a DashScope API Key (https://bailian.console.aliyun.com/cn-beijing/model/market?capabilities=ASR%2CTTS) and paste it into Qwen's "Settings" — the model and endpoint are already built in, so top up and you are set; to make "Speak" use Qwen as well, click "Enable" on that row. iFlytek is built in as well and configured the same way.

### 3. Start talking

There is a mic icon next to the input box on the conversation page or workspace; tap it to enter the full-screen call and just start speaking. The red hang-up button or `Esc` exits; you can mute or collapse the panel mid-call.

![Microphone entry next to the input box](docs/screenshots/mic-entry.png)

## Settings

Changes on the settings page are persistent defaults; changes made in the call overlay apply to the current call only.

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

Suppose you would rather not stare at a screen and feel like getting outdoors; suppose you happen to have a proxy port open — then take your phone out for a walk and talk through your development while strolling.

<img src="docs/screenshots/call-mode-mobile.png" alt="The call overlay on a phone" width="240">

## Feedback

Found a problem or have an idea? Open an [issue](https://github.com/duoduoqian708/dsh-voice-talk/issues).

## License

[MIT](./LICENSE)
