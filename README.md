# dsh-voice-talk

DeepSeek Harness Web 的语音对话插件：点一下麦克风，全屏通话层起——边说边听，AI 回复边生成边念，只念正文不念代码。支持系统离线 / 阿里千问 / 讯飞三种语音引擎，密钥不出 host。

## 语音引擎

| 引擎 | 成本 | 音色 | 首包 | 凭证 |
|---|---|---|---|---|
| 系统语音 | 免费 · 离线 | 平台自带 | 即时 | 无需 |
| 阿里千问 | ¥1/万字符 | 48（含 10 方言） | ~500ms | DashScope Key |
| 讯飞 | 免费 500 次/日 | 3 | 整段返回 | APPID + Key + Secret |

密钥存 host 侧凭证库，浏览器拿不到。一轮 300 字回复按千问约 0.03 元。

## 配置

设置页改的是持久默认；HUD 上调的是会话级，挂断保留、新会话回默认。

| 字段 | 默认 | 说明 |
|---|---|---|
| autoSpeak | true | 自动朗读 |
| allowInterrupt | false | 说话打断播报（建议戴耳机） |
| silenceTimeout | 1.2s | 静音判定时长 |
| rate | 1.0 | 语速，HUD 五档磁吸 |
| maxReadoutChars | 0 | 朗读字数上限，0 为不限 |

## 安装与启用

前提：dsh ≥ 0.1.0-rc.7（web profile）、Chrome / Edge、麦克风。

```sh
git clone https://github.com/duoduoqian708/dsh-voice-talk.git
cd dsh-voice-talk && npm install && npm run build
dsh plugin --profile web add /path/to/dsh-voice-talk
```

设置 → 插件 → 语音对话 → 引擎卡「启用」→ 填密钥（可试听）→ 回对话页点麦克风。

## License

[MIT](LICENSE) · 问题反馈 [Issue](https://github.com/duoduoqian708/dsh-voice-talk/issues)
