// Readout extraction: decide what part of one finalized reply gets spoken.
//
// The reply's own blocks already separate audiences: `reasoning` blocks are
// the model's thinking (never rendered to the user), `tool-call` blocks are
// execution mechanics, and `text` blocks are the prose written FOR the user.
// The caller hands in only the text-block prose. This module then:
//   1. prefers the sections the reply's own headings flag as conclusions
//      (结论/总结/结果/效果/摘要/要点/答案),
//   2. falls back to the FULL cleaned prose (no truncation by default),
//   3. strips markdown noise so the speaker reads sentences, not symbols.
//
// `maxChars` (settings, 0 = unlimited) is a safety valve applied on sentence
// boundaries only — never mid-sentence — with an audible notice appended.

/** Heading lines that mark "read me" sections (splitSections strips the #). */
const CONCLUSION_HEADING = /(?:结论|总结|结果|效果|摘要|要点|答案)/

/** Fenced code blocks: pure noise for a listener. */
const FENCE = /```[\s\S]*?```/g
/** Inline code keeps the content, drops the ticks. */
const INLINE_CODE = /`([^`]+)`/g
/** Images and links keep the label text. */
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK = /\[([^\]]+)\]\([^)]*\)/g
/** Emphasis markers. */
const EMPHASIS = /(\*\*|__|\*|_|~~)/g
/** Heading and quote markers. */
const HEADING = /^#{1,6}\s+/gm
const QUOTE = /^>\s?/gm
/** List bullets/numbers keep the item text. */
const BULLETS = /^\s*[-*+]\s+/gm
const ORDERED = /^\s*\d+\.\s+/gm
/** Table rows: separator lines vanish, pipes become pauses. */
const TABLE_SEP = /^\s*\|?[-:|]+\|?\s*$/gm

/** Strip markdown surface noise so the speaker reads prose. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(FENCE, '')
    .replace(INLINE_CODE, '$1')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(EMPHASIS, '')
    .replace(HEADING, '')
    .replace(QUOTE, '')
    .replace(BULLETS, '')
    .replace(ORDERED, '')
    .replace(TABLE_SEP, '')
    .replace(/\|/g, '，')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, '，')
    .replace(/[ \t]+/g, ' ')
    // A line ending in punctuation plus the newline pause doubles up.
    .replace(/([。，、！？；.!?])\1+/g, '$1')
    .trim()
}

/**
 * Split raw markdown into (heading, body) sections. The first chunk carries
 * an empty heading when the reply opens with prose before any heading.
 */
export function splitSections(raw: string): Array<{ heading: string; body: string }> {
  const lines = raw.split('\n')
  const sections: Array<{ heading: string; body: string }> = []
  let heading = ''
  let buffer: string[] = []
  const flush = (): void => {
    const body = buffer.join('\n').trim()
    if (heading !== '' || body !== '') sections.push({ heading, body })
    buffer = []
  }
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match !== null) {
      flush()
      heading = match[2] ?? ''
    } else {
      buffer.push(line)
    }
  }
  flush()
  return sections
}

/**
 * The prose the reply wants heard: sections whose headings name a conclusion,
 * joined in order. Empty when the reply carries no conclusion-marked section.
 */
export function conclusionProse(raw: string): string | null {
  const sections = splitSections(raw)
  const hits = sections.filter(section => CONCLUSION_HEADING.test(section.heading))
  if (hits.length === 0) return null
  const body = cleanForSpeech(hits.map(section => section.body).join('\n\n'))
  return body === '' ? null : body
}

/** Cut on a sentence boundary at or before `maxChars`. */
export function trimToSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastStop = Math.max(
    cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'),
    cut.lastIndexOf('；'), cut.lastIndexOf('.'),
  )
  return lastStop > maxChars / 2 ? cut.slice(0, lastStop + 1) : cut
}

/** Tail notice appended when the safety valve trims a readout. */
export const READOUT_TRIMMED_NOTICE = '内容较长，其余部分请在页面查看。'

/**
 * The readout of one reply: conclusion sections when the reply marks them,
 * otherwise the full cleaned prose. `maxChars > 0` trims on a sentence
 * boundary and appends the page-view notice. Empty string when the reply
 * carries nothing listenable (a pure-code reply, for instance).
 */
export function extractReadout(rawText: string, maxChars = 0): string {
  const body = conclusionProse(rawText) ?? cleanForSpeech(rawText)
  if (body === '') return ''
  if (maxChars > 0 && body.length > maxChars) {
    return `${trimToSentence(body, maxChars)}${READOUT_TRIMMED_NOTICE}`
  }
  return body
}

/**
 * Stream-safe cleaner: like cleanForSpeech, but an UNCLOSED fenced code block
 * is swallowed whole (its content may still be arriving) instead of leaking
 * code into speech.
 */
export function cleanStreamProse(raw: string): string {
  const openFence = raw.lastIndexOf('```')
  const closedFences = (raw.match(/```/g) ?? []).length
  let safe = raw
  if (closedFences % 2 === 1 && openFence >= 0) safe = raw.slice(0, openFence)
  // The newline-collapsed tail often ends in a dangling pause; trim it.
  return cleanForSpeech(safe).replace(/[，,、]+$/, '')
}

/**
 * Raw-prefix length matching a cleaned-char count: the karaoke marker maps
 * "N cleaned characters have been read" back onto the rendered raw text.
 * Prefix-cleaned length is not perfectly monotone at fence boundaries, so
 * this is a visual approximation (sentence-grained, which is how pieces
 * arrive anyway).
 */
export function rawPrefixForCleaned(text: string, chars: number): number {
  if (chars <= 0) return 0
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (cleanStreamProse(text.slice(0, mid)).length <= chars) lo = mid
    else hi = mid - 1
  }
  return lo
}
