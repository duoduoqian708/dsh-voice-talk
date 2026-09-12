// Offline checks for the echo guard (src/client/echo-guard.ts).
//
// Browser-free: pure string logic, so the two verdicts are asserted directly.
// The key invariant is the strict boundary — cloud themes (echo-cancelled
// audio) must keep the v2 verdict byte for byte, while the uncancellable
// platform voice gets the aggressive one. Run with:  npm run test:echo

import assert from 'node:assert/strict'
import { bestSentenceDice, bigramDice, isStopCommand, looksLikeEcho, normalizeForEcho } from '../src/client/echo-guard.ts'

const scenarios = []
function scenario(name, fn) {
  scenarios.push({ name, fn })
}

/** Three sentences; the distorted captures below ride the middle one, which
 *  the 24-char tail window no longer sees. */
const READOUT = '今天天气不错可以先出门走走。今天的空气品质非常好适合出门散步顺便晒晒太阳。最后一句话在这里收尾。'
/** Mid-readout capture with ASR substitutions (`非常好` re-voiced as `很可以`). */
const DISTORTED_MID = '今天的空气品质很可以适合出门散步'

scenario('规范化：去标点空格并小写', () => {
  assert.equal(normalizeForEcho('你好， world!'), '你好world')
})

scenario('干净截获（整句/句尾）：两种模式都判回声', () => {
  assert.equal(looksLikeEcho('最后一句话在这里收尾', READOUT), true)
  assert.equal(looksLikeEcho('今天的空气品质非常好', READOUT), true)
  assert.equal(looksLikeEcho('最后一句话在这里收尾', READOUT, true), true)
})

scenario('停止指令识别（不受守卫影响，控制器先行放行）', () => {
  assert.equal(isStopCommand('打住'), true)
  assert.equal(isStopCommand('停一下'), true)
  assert.equal(isStopCommand('好的'), false)
})

scenario('长回复中段失真截获：千问（非严格）不变，系统（严格）判回声', () => {
  // The regression boundary for cloud themes: their verdict must not change.
  assert.equal(looksLikeEcho(DISTORTED_MID, READOUT, false), false)
  assert.equal(looksLikeEcho(DISTORTED_MID, READOUT, true), true)
})

scenario('严格模式短片段：不在尾部窗口也能命中句中句子', () => {
  const fragment = '空气品值' // substitution breaks containment; bigrams still hit
  assert.equal(looksLikeEcho(fragment, READOUT, false), false)
  assert.equal(looksLikeEcho(fragment, READOUT, true), true)
})

scenario('真人说话：两种模式都不误判', () => {
  const user = '帮我打开设置页面看看网络连接'
  assert.equal(looksLikeEcho(user, READOUT, false), false)
  assert.equal(looksLikeEcho(user, READOUT, true), false)
})

scenario('极短片段：按现有短片段规则仍判回声（防自喂优先）', () => {
  assert.equal(looksLikeEcho('走', READOUT), true)
  assert.equal(looksLikeEcho('好', READOUT, true), true)
})

scenario('空参考文本：不判回声（没有可对照的朗读）', () => {
  assert.equal(looksLikeEcho('帮我打开设置页面', ''), false)
})

scenario('逐句 Dice：句中匹配不被整篇稀释', () => {
  const capture = normalizeForEcho('今天的空气品质非常好')
  const whole = bigramDice(capture, normalizeForEcho(READOUT))
  const sentence = bestSentenceDice(capture, READOUT)
  assert.ok(sentence > 0.55, `sentence score should stay high, got ${sentence}`)
  assert.ok(sentence > whole + 0.2, `sentence ${sentence} must beat the diluted whole-text ${whole}`)
})

let failed = 0
for (const { name, fn } of scenarios) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL  ${name}`)
    console.error(`      ${error.message}`)
  }
}
console.log(`\n${scenarios.length - failed}/${scenarios.length} echo scenarios passed`)
if (failed > 0) process.exitCode = 1
