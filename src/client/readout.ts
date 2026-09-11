// Readout extraction: turn the reply's user-facing prose into speakable text.
//
// The reply's own blocks already separate audiences: `reasoning` blocks are
// the model's thinking (never rendered to the user), `tool-call` blocks are
// execution mechanics, and `text` blocks are the prose written FOR the user.
// The caller hands in only the text-block prose, streaming it sentence by
// sentence as it generates; this module strips markdown surface noise so the
// speaker reads sentences, not symbols. Code fences are dropped whole (the
// stream-safe variant swallows an unclosed one too), inline code and link
// labels keep their words, and everything else is read in full.

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
function cleanForSpeech(text: string): string {
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
