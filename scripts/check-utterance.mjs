// Offline scenario checks for the listening-utterance state machine
// (src/client/utterance.ts) and the local voice endpointer (endpointer.ts).
//
// Browser-free: a fake clock drives time and every output is recorded, so the
// submission policy is asserted deterministically — no mic, no vendor, no
// timers. Run with:  npm run test:utterance

import assert from 'node:assert/strict'
import { UtteranceMachine } from '../src/client/utterance.ts'
import { VoiceEndpointer } from '../src/client/endpointer.ts'

/** Deterministic clock + timer queue for the injected host. */
class Clock {
  constructor() {
    this.t = 0
    this.seq = 1
    this.timers = new Map()
  }
  now() {
    return this.t
  }
  setTimer(fn, ms) {
    const handle = this.seq++
    this.timers.set(handle, { at: this.t + ms, fn })
    return handle
  }
  clearTimer(handle) {
    this.timers.delete(handle)
  }
  advance(ms) {
    const end = this.t + ms
    for (;;) {
      let next = -1
      for (const handle of this.timers.keys()) {
        if (next === -1 || this.timers.get(handle).at < this.timers.get(next).at) next = handle
      }
      if (next === -1 || this.timers.get(next).at > end) break
      const { fn } = this.timers.get(next)
      this.t = this.timers.get(next).at
      this.timers.delete(next)
      fn()
    }
    this.t = end
  }
}

const FEED_MS = 40
const VOICE_RMS = 0.05
const NOISE_RMS = 0.001
const SILENCE_MS = 2000
const MARGIN_MS = 300
const WINDOW = SILENCE_MS + MARGIN_MS

function harness() {
  const clock = new Clock()
  const submits = []
  const windows = []
  const traces = []
  const displays = []
  const machine = new UtteranceMachine({
    now: () => clock.now(),
    setTimer: (fn, ms) => clock.setTimer(fn, ms),
    clearTimer: handle => clock.clearTimer(handle),
    onSubmit: text => submits.push({ t: clock.now(), text }),
    onDisplay: text => displays.push({ t: clock.now(), text }),
    onWindow: at => windows.push({ t: clock.now(), at }),
    onTrace: (event, detail) => traces.push({ t: clock.now(), event, detail }),
  }, () => ({ silenceMs: SILENCE_MS, marginMs: MARGIN_MS, capMs: 60_000 }))
  const feed = (seconds, rms) => {
    for (let i = 0; i < Math.round((seconds * 1000) / FEED_MS); i++) {
      clock.advance(FEED_MS)
      machine.level(rms)
    }
  }
  return {
    clock, machine, submits, windows, traces, displays,
    speak: seconds => feed(seconds, VOICE_RMS),
    quiet: seconds => feed(seconds, NOISE_RMS),
    noise: (seconds, rms) => feed(seconds, rms),
    partial: text => machine.partial(text),
    final: text => machine.final(text),
  }
}

const near = (actual, expected, tol, label) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected}±${tol}, got ${actual}`)

const scenarios = []
const scenario = (name, fn) => scenarios.push({ name, fn })

scenario('连续说话中云端文本断档 5 秒：不提交', () => {
  const h = harness()
  h.partial('大家好')
  h.speak(1)
  h.final('大家好')
  h.speak(5) // 只有人声，没有任何文本
  assert.equal(h.submits.length, 0, 'mid-speech text gap must not submit')
  h.speak(1)
  h.quiet(3)
  assert.equal(h.submits.length, 1)
  assert.equal(h.submits[0].text, '大家好')
})

scenario('云端慢吞吞吐字（1s/段）：一直等它吐完', () => {
  const h = harness()
  let acc = '一'
  h.partial(acc)
  h.clock.advance(500)
  for (const ch of ['二', '三', '四', '五']) {
    h.clock.advance(1000)
    acc += ch
    h.partial(acc)
    assert.equal(h.submits.length, 0, 'slow streaming must not be cut')
  }
  h.clock.advance(WINDOW + 200)
  assert.equal(h.submits.length, 1)
  assert.equal(h.submits[0].text, acc)
})

scenario('停口后云端无任何事件：按时提交', () => {
  const h = harness()
  h.partial('你好世界')
  h.speak(1)
  const lastVoice = h.clock.now()
  h.quiet(3)
  assert.equal(h.submits.length, 1)
  // The endpointer holds voice for a few quiet frames after the last loud one,
  // so the countdown starts at the release: the window plus that short tail.
  assert.ok(h.submits[0].t >= lastVoice + WINDOW, `no earlier than the window (got ${h.submits[0].t - lastVoice})`)
  assert.ok(h.submits[0].t <= lastVoice + WINDOW + 400, `released within the endpointer tail (got ${h.submits[0].t - lastVoice})`)
  assert.equal(h.submits[0].text, '你好世界')
})

scenario('中途停 1 秒不提交、续说后停 3 秒提交', () => {
  const h = harness()
  h.partial('前半句')
  h.speak(1)
  h.quiet(1)
  assert.equal(h.submits.length, 0, 'a pause under the window must not submit')
  h.speak(1)
  h.final('前半句')
  h.quiet(3)
  assert.equal(h.submits.length, 1)
  assert.equal(h.submits[0].text, '前半句')
})

scenario('只有文本、没有本地电平：也按时提交', () => {
  const h = harness()
  h.partial('纯文本')
  h.clock.advance(WINDOW + 200)
  assert.equal(h.submits.length, 1)
  assert.equal(h.submits[0].text, '纯文本')
})

scenario('只有噪音/风声、没有文字：不开窗、永不提交', () => {
  const h = harness()
  h.noise(10, 0.02)
  assert.equal(h.windows.length, 0, 'noise must not open the window')
  assert.equal(h.submits.length, 0, 'noise must never submit')
})

scenario('断线挂起：计时冻结、文本保留、恢复后重新计时', () => {
  const h = harness()
  h.partial('保留我')
  h.speak(0.5)
  h.machine.suspend()
  h.clock.advance(10_000)
  assert.equal(h.submits.length, 0, 'suspended machine must not submit')
  h.machine.resume()
  h.clock.advance(WINDOW + 200)
  assert.equal(h.submits.length, 1)
  assert.equal(h.submits[0].text, '保留我')
})

scenario('回声停麦挂起：已有文本保留，恢复后可续说', () => {
  const h = harness()
  h.partial('前')
  h.final('前')
  h.machine.suspend()
  h.clock.advance(2000)
  h.machine.resume()
  h.partial('后')
  h.clock.advance(1000)
  assert.equal(h.submits.length, 0)
  h.clock.advance(1500)
  assert.equal(h.submits.length, 1)
  assert.equal(h.submits[0].text, '前，后')
})

scenario('60 秒上限：连续说话也强制提交', () => {
  const h = harness()
  let i = 0
  h.partial(`长${++i}`)
  while (h.submits.length === 0 && h.clock.now() < 61_000) {
    h.speak(0.5)
    h.partial(`长${++i}`)
  }
  assert.equal(h.submits.length, 1)
  assert.ok(h.submits[0].t <= 60_100, `cap flush at ~60s, got ${h.submits[0].t}`)
  const flush = [...h.traces].reverse().find(entry => entry.event === 'flush')
  assert.equal(flush.detail.reason, 'cap')
})

scenario('重复刷同一 partial：不刷新计时器', () => {
  const h = harness()
  h.partial('你好')
  const t0 = h.clock.now()
  h.clock.advance(1000)
  h.partial('你好')
  h.clock.advance(1000)
  h.partial('你好')
  h.clock.advance(400)
  assert.equal(h.submits.length, 1)
  near(h.submits[0].t, t0 + WINDOW, FEED_MS * 2, 'identical repeats must not extend')
})

scenario('提交后归零：新一轮互不串扰', () => {
  const h = harness()
  h.partial('一')
  h.clock.advance(WINDOW + 200)
  h.partial('二')
  h.clock.advance(WINDOW + 200)
  assert.deepEqual(h.submits.map(entry => entry.text), ['一', '二'])
})

scenario('显示与提交一致：提交的正是屏幕上的文字', () => {
  const h = harness()
  h.partial('甲')
  h.clock.advance(200)
  h.final('甲')
  h.partial('乙')
  h.clock.advance(WINDOW + 200)
  assert.equal(h.submits.length, 1)
  const submit = h.submits[0]
  assert.equal(submit.text, '甲，乙')
  const shown = [...h.displays].reverse().find(entry => entry.t <= submit.t && entry.text !== '')
  assert.equal(shown.text, submit.text, 'the submitted text was on screen until the flush')
})

scenario('端检器：稳态噪音不算人声、说话算、点击不算', () => {
  const ep = new VoiceEndpointer()
  for (let i = 0; i < 250; i++) assert.equal(ep.push(0.01), false, 'steady noise is not voice')
  let active = false
  for (let i = 0; i < 10; i++) active = ep.push(0.06)
  assert.equal(active, true, 'speech opens voice')
  for (let i = 0; i < 10; i++) active = ep.push(0.001)
  assert.equal(active, false, 'silence closes voice')
  ep.reset()
  ep.push(0.08) // one loud frame = a click
  for (let i = 0; i < 5; i++) assert.equal(ep.push(0.001), false, 'a click is not voice')
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
console.log(`\n${scenarios.length - failed}/${scenarios.length} utterance scenarios passed`)
if (failed > 0) process.exitCode = 1
