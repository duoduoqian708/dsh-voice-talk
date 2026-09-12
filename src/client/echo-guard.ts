// Echo guard: decide whether a recognized utterance during playback is the
// speaker's own voice picked up by the microphone (feed-back) rather than the
// user talking. Pure string logic, deliberately conservative: only drop when
// the match against the readout is strong, so real barge-in survives.
//
// v2: character-bigram Dice similarity catches partial captures and lightly
// distorted re-voices (segmentation differences); strict containment catches
// clean captures. True homophone-only re-voicing cannot be detected without
// a pinyin pass — the half-duplex default remains the primary defense.
//
// v3: a `strict` mode for the platform speechSynthesis voice, whose output no
// echo canceller can remove. It lowers the thresholds, accepts short suffix
// runs, and scores the utterance against EVERY sentence of the readout (a
// capture can ride any sentence that was sounding, not just the tail). Cloud
// themes keep the v2 verdict byte for byte — their audio is echo-cancelled.

/** Strip punctuation/symbols/whitespace and lowercase for tolerant comparison. */
export function normalizeForEcho(text: string): string {
  return text
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .toLowerCase()
}

/**
 * Explicit "silence the readout" commands. They bypass the echo guard and
 * the arm delay entirely: short commands like 打住 are unconditionally
 * echo-classified by the length gate below and could never interrupt, and
 * on speaker playback they mean "stop", not "answer this". Exact match
 * after normalization — no fuzzy matching, zero false-positive surface.
 */
const STOP_COMMANDS = ['打住', '停', '停下', '停止', '停一下', '停一停', '别念了', '别读了', '别说了', '闭嘴', 'stop']

/** Whether the utterance is an explicit stop-readout command. */
export function isStopCommand(utterance: string): boolean {
  return STOP_COMMANDS.includes(normalizeForEcho(utterance))
}

/** Minimum normalized length of an utterance before echo judgment applies. */
const MIN_UTTERANCE_LENGTH = 4
/** Minimum shared character run that counts as suffix/containment overlap. */
const MIN_OVERLAP = 6
/** Longest tail window of the spoken text we compare against. */
const TAIL_WINDOW = 24
/** Dice-similarity threshold over character bigrams for the fuzzy verdict. */
const DICE_THRESHOLD = 0.3
/** Strict (uncancellable platform voice) verdict: a weaker overlap already
 *  counts as a re-captured readout. */
const STRICT_DICE_THRESHOLD = 0.15
/** Strict-mode suffix run: shorter runs count too. */
const STRICT_MIN_OVERLAP = 4
/** Normalized length under which any overlap counts as echo (short fragments). */
const STRICT_SHORT_LENGTH = 6
/** Strict mode: a fragment this short is echo on ANY shared bigram. */
const STRICT_FRAGMENT_LENGTH = 5
/** Shortest normalized reference sentence the per-sentence pass scores. */
const MIN_SENTENCE_LENGTH = 4

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
 * Best bigram Dice of `utterance` against any single sentence of the RAW
 * spoken text. Sentences are split BEFORE normalization (punctuation is the
 * boundary a normalization pass erases), so a capture of a mid-readout
 * sentence scores against that sentence instead of drowning in the whole
 * reply. `utterance` must already be normalized; `spokenText` is raw.
 */
export function bestSentenceDice(utterance: string, spokenText: string): number {
  let best = 0
  for (const part of spokenText.split(/[。！？；.!?…\n]+/)) {
    const sentence = normalizeForEcho(part)
    if (sentence.length < MIN_SENTENCE_LENGTH) continue
    const score = bigramDice(utterance, sentence)
    if (score > best) best = score
  }
  return best
}

/**
 * Whether `utterance` plausibly re-voices `spokenText`:
 * containment in either direction, a >=6-char shared run against the spoken
 * text's tail (ASR typically captures the last words of an ongoing readout),
 * or a fuzzy bigram overlap. Short fragments with ANY overlap are echo too —
 * short real commands are the user's problem only while barge-in is on with
 * speakers, which the settings card warns against.
 *
 * `strict` is for the platform speechSynthesis voice: no echo canceller can
 * remove it from the mic, so the thresholds drop, short suffix runs count,
 * and every readout sentence gets a fuzzy pass. Cloud themes never opt in.
 */
export function looksLikeEcho(utterance: string, spokenText: string, strict = false): boolean {
  const u = normalizeForEcho(utterance)
  if (u.length < MIN_UTTERANCE_LENGTH) return true
  const s = normalizeForEcho(spokenText)
  if (s === '') return false
  if (s.includes(u) || u.includes(s)) return true

  const tail = s.slice(-TAIL_WINDOW)
  // Suffix-run overlap: the capture starts inside the spoken tail.
  const minOverlap = strict ? STRICT_MIN_OVERLAP : MIN_OVERLAP
  for (let k = Math.min(minOverlap, u.length, tail.length); k >= minOverlap; k--) {
    if (tail.endsWith(u.slice(0, k)) || u.endsWith(tail.slice(-k))) return true
  }

  const threshold = strict ? STRICT_DICE_THRESHOLD : DICE_THRESHOLD
  const dice = bigramDice(u, tail)
  if (dice >= threshold) return true
  // Short fragments: any single shared bigram is enough to call echo.
  if (u.length < STRICT_SHORT_LENGTH && dice > 0) return true
  if (strict) {
    const sentence = bestSentenceDice(u, spokenText)
    if (sentence >= STRICT_DICE_THRESHOLD) return true
    // A sliver of the sounding readout: any shared bigram is enough.
    if (u.length <= STRICT_FRAGMENT_LENGTH && sentence > 0) return true
  }
  return false
}
