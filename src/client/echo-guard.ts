// Echo guard: decide whether a recognized utterance during playback is the
// speaker's own voice picked up by the microphone (feed-back) rather than the
// user talking. Pure string logic, deliberately conservative: only drop when
// the match against the readout is strong, so real barge-in survives.
//
// v2: character-bigram Dice similarity catches partial captures and lightly
// distorted re-voices (segmentation differences); strict containment catches
// clean captures. True homophone-only re-voicing cannot be detected without
// a pinyin pass — the half-duplex default remains the primary defense.

/** Strip punctuation/symbols/whitespace and lowercase for tolerant comparison. */
export function normalizeForEcho(text: string): string {
  return text
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .toLowerCase()
}

/** Minimum normalized length of an utterance before echo judgment applies. */
const MIN_UTTERANCE_LENGTH = 4
/** Minimum shared character run that counts as suffix/containment overlap. */
const MIN_OVERLAP = 6
/** Longest tail window of the spoken text we compare against. */
const TAIL_WINDOW = 24
/** Dice-similarity threshold over character bigrams for the fuzzy verdict. */
const DICE_THRESHOLD = 0.3
/** Normalized length under which any overlap counts as echo (short fragments). */
const STRICT_SHORT_LENGTH = 6

/** Character bigrams of a normalized string ('' when too short). */
export function bigrams(text: string): Set<string> {
  const grams = new Set<string>()
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2))
  return grams
}

/** Dice coefficient over character bigrams (0..1). */
export function bigramDice(a: string, b: string): number {
  const ga = bigrams(a)
  const gb = bigrams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let shared = 0
  for (const gram of ga) {
    if (gb.has(gram)) shared++
  }
  return (2 * shared) / (ga.size + gb.size)
}

/**
 * Whether `utterance` plausibly re-voices `spokenText`:
 * containment in either direction, a >=6-char shared run against the spoken
 * text's tail (ASR typically captures the last words of an ongoing readout),
 * or a fuzzy bigram overlap. Short fragments with ANY overlap are echo too —
 * short real commands are the user's problem only while barge-in is on with
 * speakers, which the settings card warns against.
 */
export function looksLikeEcho(utterance: string, spokenText: string): boolean {
  const u = normalizeForEcho(utterance)
  if (u.length < MIN_UTTERANCE_LENGTH) return true
  const s = normalizeForEcho(spokenText)
  if (s === '') return false
  if (s.includes(u) || u.includes(s)) return true

  const tail = s.slice(-TAIL_WINDOW)
  // Suffix-run overlap: the capture starts inside the spoken tail.
  for (let k = Math.min(MIN_OVERLAP, u.length, tail.length); k >= MIN_OVERLAP; k--) {
    if (tail.endsWith(u.slice(0, k)) || u.endsWith(tail.slice(-k))) return true
  }

  const dice = bigramDice(u, tail)
  if (dice >= DICE_THRESHOLD) return true
  // Short fragments: any single shared bigram is enough to call echo.
  if (u.length < STRICT_SHORT_LENGTH && dice > 0) return true
  return false
}
