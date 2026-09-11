// Lightweight markdown renderer for the call overlay's assistant prose.
// Native is out of reach (ui-conversation ships no component exports), so
// this mirrors the common blocks — headings, fenced/inline code, lists,
// blockquotes, tables, emphasis, links — closely enough to read naturally in
// a speech call. It stays raw-text oriented: every block/item/cell carries
// its raw span, and the karaoke marker (a raw character range into the
// message) tints exactly the clause being read.

import { useMemo } from 'react'
import type { ReactElement } from 'react'

/** A karaoke range in a message's raw prose (both ends are raw offsets). */
export type MarkRange = { readonly from: number; readonly to: number }

/* ---- inline tokens --------------------------------------------------------- */

type InlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; label: string; href: string }

const INLINE_SPECIAL = /[`*[!~]/

/** Forgiving inline tokenizer: unmatched syntax falls through as text. */
function tokenizeInline(raw: string): InlinePart[] {
  const parts: InlinePart[] = []
  let i = 0
  while (i < raw.length) {
    const rest = raw.slice(i)
    const image = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(rest)
    if (image !== null) {
      parts.push({ kind: 'link', label: image[1] ?? '', href: image[2]! })
      i += image[0].length
      continue
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest)
    if (link !== null) {
      parts.push({ kind: 'link', label: link[1]!, href: link[2]! })
      i += link[0].length
      continue
    }
    const code = /^`([^`]+)`/.exec(rest)
    if (code !== null) {
      parts.push({ kind: 'code', text: code[1]! })
      i += code[0].length
      continue
    }
    const bold = /^\*\*([^*]+)\*\*/.exec(rest)
    if (bold !== null) {
      parts.push({ kind: 'bold', text: bold[1]! })
      i += bold[0].length
      continue
    }
    const strike = /^~~([^~]+)~~/.exec(rest)
    if (strike !== null) {
      parts.push({ kind: 'strike', text: strike[1]! })
      i += strike[0].length
      continue
    }
    const italic = /^\*([^*]+)\*/.exec(rest)
    if (italic !== null) {
      parts.push({ kind: 'italic', text: italic[1]! })
      i += italic[0].length
      continue
    }
    const next = rest.search(INLINE_SPECIAL)
    if (next === -1) {
      parts.push({ kind: 'text', text: rest })
      break
    }
    if (next === 0) {
      parts.push({ kind: 'text', text: rest[0]! })
      i += 1
      continue
    }
    parts.push({ kind: 'text', text: rest.slice(0, next) })
    i += next
  }
  return parts
}

function renderInline(raw: string): ReactElement {
  const parts = tokenizeInline(raw)
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case 'text':
            return <span key={i}>{part.text}</span>
          case 'bold':
            return <strong key={i}>{part.text}</strong>
          case 'italic':
            return <em key={i}>{part.text}</em>
          case 'strike':
            return <s key={i}>{part.text}</s>
          case 'code':
            return <code key={i} className='dsh-voice-inline-code'>{part.text}</code>
          case 'link':
            return (
              <a key={i} className='dsh-voice-link' href={part.href} target='_blank' rel='noreferrer' onClick={event => event.stopPropagation()}>
                {part.label}
              </a>
            )
        }
      })}
    </>
  )
}

/**
 * Render inline content with a karaoke range: `from`/`to` are raw-character
 * offsets into `raw` (clamped by the caller); only the slice between them is
 * tinted — what was read earlier loses the tint. Degenerate ranges fall
 * through to plain rendering.
 */
function MarkedRegion({ raw, from, to }: { raw: string; from: number; to: number }): ReactElement {
  const start = Math.max(0, Math.min(from, raw.length))
  const end = Math.max(0, Math.min(to, raw.length))
  if (end <= start) return <>{renderInline(raw)}</>
  return (
    <>
      {start > 0 && renderInline(raw.slice(0, start))}
      <span className='dsh-voice-marked'>{renderInline(raw.slice(start, end))}</span>
      {end < raw.length && renderInline(raw.slice(end))}
    </>
  )
}

/* ---- block parsing --------------------------------------------------------- */

interface ListItem {
  readonly text: string
  readonly contentStart: number
  readonly end: number
}

interface TableRow {
  readonly cells: readonly string[]
  readonly contentStart: number
}

interface MarkdownBlock {
  readonly kind: 'heading' | 'para' | 'quote' | 'code' | 'list' | 'table' | 'hr'
  readonly start: number
  readonly end: number
  readonly headingLevel?: number
  readonly text?: string
  readonly contentStart?: number
  readonly codeLang?: string
  readonly codeText?: string
  readonly ordered?: boolean
  readonly items?: readonly ListItem[]
  readonly rows?: readonly TableRow[]
}

/** Does this line read like a pipe-prefixed markdown table row? */
function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}

/** Does this line read like a table separator row (`| :--- | ---: |`)? */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*[\-:|\s]+\|?\s*$/.test(line) && /-/.test(line)
}

/** Split the lines of `text` into blocks with their raw spans. */
export function parseBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  // Per line: `start` = first char index; `end` = exclusive content end (the
  // trailing newline, when present, lives BETWEEN lines — no phantom +1 after
  // the last line).
  const lines: { line: string; start: number; end: number }[] = []
  const rawLines = text.split('\n')
  let pos = 0
  for (let k = 0; k < rawLines.length; k++) {
    const rawLine = rawLines[k]!
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const start = pos
    const end = start + line.length
    lines.push({ line, start, end })
    pos = end + (k < rawLines.length - 1 ? 1 : 0) // the newline after every line but the last
  }
  let i = 0
  while (i < lines.length) {
    const { line, start } = lines[i]!
    const trimmed = line.trim()
    if (trimmed === '') {
      i += 1
      continue
    }
    const endOf = (index: number): number => lines[index]!.end

    // Fenced code block (unclosed runs to EOF — mid-stream swallows cleanly).
    const fence = /^```(\w*)\s*$/.exec(trimmed)
    if (fence !== null) {
      const inner: string[] = []
      let j = i + 1
      let end = endOf(i)
      for (; j < lines.length; j++) {
        if (/^```\s*$/.test(lines[j]!.line.trim())) {
          end = endOf(j)
          break
        }
        inner.push(lines[j]!.line)
      }
      blocks.push({ kind: 'code', codeLang: fence[1] ?? '', codeText: inner.join('\n'), start, end })
      i = j < lines.length ? j + 1 : lines.length
      continue
    }

    // ATX heading.
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = (line.match(/^#{1,6}/)![0]!).length
      const textStart = start + line.length - heading[1]!.length
      blocks.push({ kind: 'heading', headingLevel: level, text: heading[1]!, start, end: endOf(i), contentStart: textStart })
      i += 1
      continue
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      blocks.push({ kind: 'hr', start, end: endOf(i) })
      i += 1
      continue
    }

    // List — consecutive same-kind items fold into one block.
    const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line)
    if (item !== null) {
      const ordered = /\d/.test(item[2]!)
      const items: ListItem[] = []
      let j = i
      let end = endOf(i)
      while (j < lines.length) {
        const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[j]!.line)
        if (m === null) break
        items.push({
          text: m[3]!,
          contentStart: lines[j]!.start + m[1]!.length + m[2]!.length + 1,
          end: lines[j]!.start + lines[j]!.line.length,
        })
        end = endOf(j)
        j += 1
      }
      blocks.push({ kind: 'list', ordered, items, start, end })
      i = j
      continue
    }

    // Blockquote — consecutive `>` lines fold.
    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = []
      let contentStart = start
      let j = i
      let end = endOf(i)
      while (j < lines.length && /^\s*>\s?/.test(lines[j]!.line)) {
        const raw = lines[j]!.line
        const marker = raw.indexOf('>')
        quoted.push(raw.slice(marker + 1).replace(/^\s/, ''))
        if (j === i) contentStart = start + marker + 1 + (raw[marker + 1] === ' ' ? 1 : 0)
        end = endOf(j)
        j += 1
      }
      blocks.push({ kind: 'quote', text: quoted.join('\n'), start, end, contentStart })
      i = j
      continue
    }

    // Table — consecutive pipe rows fold; separator rows are dropped.
    if (isTableRow(line)) {
      const rows: TableRow[] = []
      let j = i
      let end = endOf(i)
      while (j < lines.length && (isTableRow(lines[j]!.line) || isTableSeparator(lines[j]!.line))) {
        const raw = lines[j]!.line
        if (isTableSeparator(raw)) {
          end = endOf(j)
          j += 1
          continue
        }
        const cells = raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
        rows.push({ cells, contentStart: start + raw.indexOf(cells[0] ?? '') })
        end = endOf(j)
        j += 1
      }
      if (rows.length > 0) {
        blocks.push({ kind: 'table', rows, start, end })
        i = j
        continue
      }
    }

    // Paragraph — consecutive plain lines.
    const para: string[] = []
    let contentStart = start
    let j = i
    let end = endOf(i)
    while (j < lines.length) {
      const raw = lines[j]!.line
      const t = raw.trim()
      if (t === '') break
      if (/^```/.test(t) || /^#{1,6}\s/.test(t) || /^(-{3,}|\*{3,}|_{3,})$/.test(t) || isTableRow(raw)) break
      if (/^\s*>\s?/.test(raw) || /^(\s*)([-*+]|\d+\.)\s+/.test(raw)) break
      para.push(raw)
      end = endOf(j)
      j += 1
    }
    blocks.push({ kind: 'para', text: para.join('\n'), start, end, contentStart })
    i = j
  }
  return blocks
}

/** Clamp a message-level range into `[0, span]` relative to `contentStart`. */
function rangeWithin(contentStart: number, contentEnd: number, mark: MarkRange | null): MarkRange {
  if (mark === null) return { from: 0, to: 0 }
  const span = contentEnd - contentStart
  return {
    from: Math.max(0, Math.min(mark.from - contentStart, span)),
    to: Math.max(0, Math.min(mark.to - contentStart, span)),
  }
}

/** Approximate a table cell's raw span: `| a | b |` ≈ cell + ' | ' padding. */
function tableCellRange(row: TableRow, cellIndex: number, mark: MarkRange | null): MarkRange {
  let acc = 0
  for (let k = 0; k < cellIndex && k < row.cells.length; k++) acc += row.cells[k]!.length + 3
  const start = row.contentStart + 1 + acc
  return rangeWithin(start, start + row.cells[cellIndex]!.length, mark)
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

/**
 * Render a raw markdown run as blocks. `mark` is a raw character range into
 * `text` (or null for no highlight); every text-bearing block tints the part
 * of the range it owns. Code blocks are never tinted — the readout skips
 * them.
 */
export function Markdown({ text, mark }: { text: string; mark: MarkRange | null }): ReactElement {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <>
      {blocks.map((block, bi) => {
        switch (block.kind) {
          case 'code':
            return <pre key={bi} className='dsh-voice-code'><code>{block.codeText}</code></pre>
          case 'hr':
            return <hr key={bi} className='dsh-voice-hr' />
          case 'heading': {
            const Tag = HEADING_TAGS[(block.headingLevel ?? 2) - 1] ?? 'h3'
            const range = rangeWithin(block.contentStart!, block.end, mark)
            return (
              <Tag key={bi} className='dsh-voice-heading'>
                <MarkedRegion raw={block.text!} from={range.from} to={range.to} />
              </Tag>
            )
          }
          case 'para': {
            const range = rangeWithin(block.contentStart!, block.end, mark)
            return (
              <p key={bi} className='dsh-voice-prose'>
                <MarkedRegion raw={block.text!} from={range.from} to={range.to} />
              </p>
            )
          }
          case 'quote': {
            const range = rangeWithin(block.contentStart!, block.end, mark)
            return (
              <blockquote key={bi} className='dsh-voice-quote'>
                <MarkedRegion raw={block.text!} from={range.from} to={range.to} />
              </blockquote>
            )
          }
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul'
            return (
              <Tag key={bi} className='dsh-voice-list'>
                {block.items!.map((item, ii) => {
                  const range = rangeWithin(item.contentStart, item.end, mark)
                  return (
                    <li key={ii}>
                      <MarkedRegion raw={item.text} from={range.from} to={range.to} />
                    </li>
                  )
                })}
              </Tag>
            )
          }
          case 'table': {
            const rows = block.rows!
            const [header, ...body] = rows
            return (
              <div key={bi} className='dsh-voice-table-wrap'>
                <table className='dsh-voice-table'>
                  {header !== undefined && (
                    <thead>
                      <tr>
                        {header.cells.map((cell, ci) => (
                          <th key={ci}>{cell}</th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  {body.length > 0 && (
                    <tbody>
                      {body.map((row, ri) => (
                        <tr key={ri}>
                          {row.cells.map((cell, ci) => {
                            const range = tableCellRange(row, ci, mark)
                            return (
                              <td key={ci}>
                                <MarkedRegion raw={cell} from={range.from} to={range.to} />
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  )}
                </table>
              </div>
            )
          }
        }
      })}
    </>
  )
}
