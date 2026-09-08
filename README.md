# dsh-voice-talk

DeepSeek Harness Web 的免手语音对话插件。麦克风一按，全屏通话层起——边说边听，AI 回复边生成边念，第一句写完就开口。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Browser](https://img.shields.io/badge/Browser-Chrome%20%2F%20Edge%2090%2B-4285F4)](#安装与启用)

<!-- 📸 截图占位：通话 HUD 全屏（docs/screenshots/call-hud.png，建议宽 ≥1200px），截好后放开下面两行 -->
<!-- ![通话模式](docs/screenshots/call-hud.png) -->

## 亮点

- **打电话式全屏 HUD**：极光氛围层 + 麦克风 RMS 驱动波形条 + 用户/AI 双色浮动字幕 + 玻璃挂断键。底层页面穿透可点，待确认审批/提问卡片不必切走处理。
- **边生成边念**：流式 TTS 会话——千问 PCM delta 经 AudioContext sample-accurate 调度，无拼接缝；partial 文本按句子边界切片，第一句写完就开口，不等全文。
- **只念正文**：思考、工具调用、代码块全部不进朗读链；markdown 清洗剥掉 fence / inline code / 链接 / 图片 / 表格分隔行；流式下未闭合 fence 整段吞掉，防代码泄漏。优先念含「结论 / 总结 / 结果 / 效果 / 摘要 / 要点 / 答案」的段，否则念全文。
- **半双工回声消除**：默认说话不打断播报；开启打断时用三重 echo 判定（包含关系 + 尾部 ≥6 字 run + 字符 bigram Dice ≥ 0.3）防扬声器回喂自激，命中后短静音再 re-arm。
- **两层设置**：HUD 上的语速 / 说话人是会话级 override（挂断保留、关会话销毁），不污染持久默认；持久默认在设置页改，热生效。
- **三引擎可选**：系统离线零成本即时首包；千问实时流式 ~500ms 首包 + 38 种音色；讯飞免费 500 次 / 日。新增引擎只需一次 `registerVoiceTheme` 调用，无需改 controller。
- **凭证不触达浏览器**：云引擎协议与 API Key 全在 host 侧 bridge 路由解析，浏览器只发本地请求 / 开本地 WS，无 CORS、无 key 泄漏；key 轮换无需重启。
- **降级安全**：不支持 Web Speech / Web Audio 时显式提示；云主题未配凭证时 overlay 显提示而非放任合成中途报错；回复 120s 超时降级；TTS 失败字幕红字并回聆听。

## 交互流程

点 composer 工具栏的麦克风 → 全屏通话层挂载 → 进入循环：

1. **聆听**：连续识别，interim 实时上字幕；停顿超过静音阈值（默认 1.2s）自动提交。
2. **思考**：麦克风暂停；提前开好 TTS 流式会话；partial 文本按句切片喂入，边生成边排队。
3. **播报**：finalized 回复到达后 flush 尾句 → 开口朗读；读完最后一帧经短暂 cooldown 回到聆听。
4. **挂断**：点挂断键 / 再点麦克风 / 按 `Esc` → 停识别、停合成、清定时器，overlay 卸载回纯文本模式。

说话打断（barge-in）默认关，外放有回声建议戴耳机再开。审批、提问卡片通话层会提示数量，仍需鼠标点。

## 语音引擎

| 引擎 | 成本 | 首包 | 音色 | 流式 | 凭证 |
|---|---|---|---|---|---|
| 系统语音 | 免费 · 离线 | 即时 | 平台自带 | utterance 队列伪流式 | 无需 |
| 阿里千问 | ¥1 / 万字符 | ~500ms | 28 普通话 + 10 方言 | 原生 PCM delta 流 | DashScope API Key |
| 讯飞 | 免费 500 次 / 日（按次计） | 整段返回 | 3 | 预取缓冲流 | APPID + API Key + API Secret |

千问走 DashScope realtime WS，模型须为 `qwen3-tts-*-realtime` 系列（默认 `qwen3-tts-flash-realtime`）。系统语音走浏览器 `speechSynthesis`，零配置。

一轮 300 字回复按千问约 0.03 元；讯飞按次数计。

所有密钥存 dsh 凭证库（host 侧加密落盘），浏览器抓不到。

## 配置

### 持久默认（设置页改，跨会话生效）

| 字段 | 默认 | 范围 / 说明 |
|---|---|---|
| `autoSpeak` | `true` | 自动朗读每轮回复 |
| `allowInterrupt` | `false` | 说话打断播报（建议戴耳机） |
| `silenceTimeout` | `1.2` | 0.4–6s，触发提交的静音时长 |
| `rate` | `1` | 0.5–2，朗读语速；HUD 磁吸档位 1.0 / 1.2 / 1.5 / 1.8 / 2.0 |
| `voiceLang` | `zh-CN` | BCP-47，识别与合成共用 |
| `ttsTheme` | `system` | 当前音色引擎主题 |
| `maxReadoutChars` | `0` | 0 = 无限；超长按句裁，追加「其余部分请在页面查看」 |
| `qwenModel` | `qwen3-tts-flash-realtime` | 须 realtime 系列 |

### 会话级 override（HUD 改，挂断保留、关会话销毁）

- **语速**：直接顶替持久 `rate`，base 恒为 1.0
- **说话人**：折进当前 theme 的默认 speaker

## 安装与启用

前提：dsh ≥ 0.1.0-rc.7（web profile）、Chrome / Edge、麦克风。

```sh
git clone https://github.com/duoduoqian708/dsh-voice-talk.git
cd dsh-voice-talk && npm install && npm run build
dsh plugin --profile web add /path/to/dsh-voice-talk
```

npm 一行装（`dsh plugin --profile web add dsh-voice-talk`）将在 npm 发布后可用。

重启 `dsh web`，打开 `http://127.0.0.1:3080`：设置 → 插件 → 语音对话 → 引擎卡「启用」→「设置」填密钥（弹窗可试听、设为默认）→ 回对话页点麦克风。

## 扩展：新增 TTS 引擎

采用主题注册表模式——一次 `registerVoiceTheme(id, label, factory)` 调用 + 一个 enum 值，controller 零改动。新引擎的 `create(): TtsProvider` 决定是否原生流式：有原生流式直接实现 `TtsSession`；否则用 `sessionFromSpeak` 兜底为预取缓冲流。

## License

[MIT](LICENSE) · 问题反馈 [Issue](https://github.com/duoduoqian708/dsh-voice-talk/issues)
