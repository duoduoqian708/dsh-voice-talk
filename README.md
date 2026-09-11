# dsh-voice-talk

DSH Web 的语音对话模式：点一下麦克风进入全屏通话，边说边听，AI 回复边生成边朗读。界面中英双语，适配明暗主题，支持语速调节与音色切换。

中文 | [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/dsh-voice-talk.svg)](https://www.npmjs.com/package/dsh-voice-talk)
[![license](https://img.shields.io/npm/l/dsh-voice-talk.svg)](./LICENSE)

![通话模式](docs/screenshots/call-mode.png)

## 快速开始

### 1. 安装

```sh
dsh plugin --profile web add dsh-voice-talk
dsh web   # 装完重启
```

源码安装：

```sh
git clone https://github.com/duoduoqian708/dsh-voice-talk.git
cd dsh-voice-talk && npm install && npm run build
dsh plugin --profile web add /path/to/dsh-voice-talk
```

需要 dsh ≥ 0.1.0-rc.7（`web` profile）、Chrome / Edge、麦克风权限与网络。

### 2. 配置大模型

设置 → 插件 → 语音对话。推荐千问：申请一个 DashScope API Key（https://bailian.console.aliyun.com/cn-beijing/model/market?capabilities=ASR%2CTTS），填进千问的「设置」即可——模型和地址都已内置，充值就能用；想让「说」也用千问，点一下那一行的「启用」。讯飞也已内置，同样在设置页配置。

### 3. 开始使用

在对话页或工作台的输入框旁，有一个麦克风图标；点它进入全屏通话层，直接说话即可。红色挂机键或 `Esc` 退出；通话中可以静音、收起。

![输入框旁的麦克风入口](docs/screenshots/mic-entry.png)

## 配置项

设置页里改的是持久默认，通话层上调的只对本次通话有效。

| 配置 | 说明 | 默认 |
|---|---|---|
| 说话打断播报 | 说话时打断正在播报的内容，建议戴耳机 | 关 |
| 停顿多久自动发送（秒） | 说完停顿多久自动提交 | 2 |
| 声纹效果 | 通话层波形样式：律动 / 波纹 | 波纹 |
| 语速 | 播报语速，按引擎设默认，通话层可临时调 | 1.0x |

![设置页](docs/screenshots/settings.png)

## 产品特色

- 跟随系统主题：浅色 / 深色自动适配。
- 中英文双语：跟随平台语言设置，界面完整本地化。
- 密钥只存本机、绝不上传：浏览器接触不到密钥，语音请求由宿主代理转发。
- 开源 MIT：代码可审计、可自建。

## 常见问题

**Q**：点了麦克风没反应，或者一直停在「聆听中」？

**A**：到设置 → 插件 → 语音对话，确认「听」的引擎已配置密钥并启用。

**Q**：有文字，但没有声音？

**A**：确认「说」的引擎已启用；云端引擎检查密钥与余额；系统语音检查系统音量与所选音色。

**Q**：说话打断不了播报？

**A**：「说话打断播报」默认关闭，需要手动打开；建议戴耳机，否则扬声器的声音会被麦克风收录，影响打断判断。

## 彩蛋

假设你不想盯着屏幕，想到户外活动一下；假设你恰好开了代理端口——那就带着手机出门，边散步边聊开发吧。

<img src="docs/screenshots/call-mode-mobile.png" alt="手机上的通话层" width="240">

## 问题反馈

遇到问题或有想法，欢迎提 [Issue](https://github.com/duoduoqian708/dsh-voice-talk/issues)。

## License

[MIT](./LICENSE)
