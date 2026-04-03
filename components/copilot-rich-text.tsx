"use client"

import type { ReactNode } from "react"
import { sanitizeCopilotLinkUrl } from "@/lib/copilot-security"
import styles from "./ai-copilot-console.module.css"

type ParagraphBlock = {
  type: "paragraph"
  lines: string[]
}

type HeadingBlock = {
  type: "heading"
  level: number
  content: string
}

type ListBlock = {
  type: "list"
  ordered: boolean
  items: string[]
}

type TableBlock = {
  type: "table"
  headers: string[]
  rows: string[][]
}

type CodeBlock = {
  type: "code"
  lines: string[]
}

type QuoteBlock = {
  type: "quote"
  lines: string[]
}

type DividerBlock = {
  type: "divider"
}

type RichBlock =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | TableBlock
  | CodeBlock
  | QuoteBlock
  | DividerBlock

function isTableSeparator(line: string) {
  const normalized = line.trim()
  if (!normalized.includes("|")) return false
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(normalized)
}

function isTableRow(line: string) {
  const normalized = line.trim()
  return normalized.includes("|") && normalized.replace(/\|/g, "").trim().length > 0
}

function splitTableCells(line: string) {
  const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return normalized.split("|").map((cell) => cell.trim())
}

function parseBlocks(content: string): RichBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const blocks: RichBlock[] = []
  let index = 0

  while (index < lines.length) {
    const current = lines[index]
    const trimmed = current.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed === "---" || trimmed === "***") {
      blocks.push({ type: "divider" })
      index += 1
      continue
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({ type: "code", lines: codeLines })
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      })
      index += 1
      continue
    }

    if (isTableRow(trimmed) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = splitTableCells(trimmed)
      const rows: string[][] = []
      index += 2

      while (index < lines.length && isTableRow(lines[index].trim())) {
        rows.push(splitTableCells(lines[index]))
        index += 1
      }

      blocks.push({ type: "table", headers, rows })
      continue
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (unorderedMatch) {
      const items: string[] = []
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*]\s+(.+)$/)
        if (!match) break
        items.push(match[1])
        index += 1
      }
      blocks.push({ type: "list", ordered: false, items })
      continue
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) {
      const items: string[] = []
      while (index < lines.length) {
        const match = lines[index].trim().match(/^\d+\.\s+(.+)$/)
        if (!match) break
        items.push(match[1])
        index += 1
      }
      blocks.push({ type: "list", ordered: true, items })
      continue
    }

    const quoteMatch = trimmed.match(/^>\s?(.+)$/)
    if (quoteMatch) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const match = lines[index].trim().match(/^>\s?(.+)$/)
        if (!match) break
        quoteLines.push(match[1])
        index += 1
      }
      blocks.push({ type: "quote", lines: quoteLines })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const next = lines[index]
      const nextTrimmed = next.trim()
      if (!nextTrimmed) break
      if (nextTrimmed.startsWith("```")) break
      if (/^(#{1,6})\s+/.test(nextTrimmed)) break
      if (nextTrimmed === "---" || nextTrimmed === "***") break
      if (/^[-*]\s+/.test(nextTrimmed) || /^\d+\.\s+/.test(nextTrimmed)) break
      if (/^>\s?/.test(nextTrimmed)) break
      if (
        isTableRow(nextTrimmed) &&
        index + 1 < lines.length &&
        isTableSeparator(lines[index + 1])
      ) {
        break
      }
      paragraphLines.push(next)
      index += 1
    }
    blocks.push({ type: "paragraph", lines: paragraphLines })
  }

  return blocks
}

function renderTextWithMarks(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let tokenIndex = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code key={`${keyPrefix}-code-${tokenIndex}`} className={styles.inlineCode}>
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={`${keyPrefix}-strong-${tokenIndex}`}>
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        const safeHref = sanitizeCopilotLinkUrl(linkMatch[2])
        if (!safeHref) {
          parts.push(linkMatch[1])
          lastIndex = pattern.lastIndex
          tokenIndex += 1
          continue
        }
        parts.push(
          <a
            key={`${keyPrefix}-link-${tokenIndex}`}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={styles.resultLink}
          >
            {linkMatch[1]}
          </a>
        )
      } else {
        parts.push(token)
      }
    } else {
      parts.push(token)
    }

    lastIndex = pattern.lastIndex
    tokenIndex += 1
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function renderParagraphLines(lines: string[], keyPrefix: string) {
  return lines.map((line, index) => (
    <span key={`${keyPrefix}-line-${index}`}>
      {renderTextWithMarks(line, `${keyPrefix}-${index}`)}
      {index < lines.length - 1 ? <br /> : null}
    </span>
  ))
}

export function CopilotRichText({ content }: { content: string }) {
  const blocks = parseBlocks(content)

  return (
    <div className={styles.richText}>
      {blocks.map((block, index) => {
        const key = `block-${index}`

        switch (block.type) {
          case "heading": {
            const HeadingTag =
              block.level <= 2 ? "h4" : block.level === 3 ? "h5" : ("h6" as const)
            return (
              <HeadingTag key={key} className={styles.richHeading}>
                {renderTextWithMarks(block.content, key)}
              </HeadingTag>
            )
          }
          case "list":
            return block.ordered ? (
              <ol key={key} className={styles.richList}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-item-${itemIndex}`}>
                    {renderTextWithMarks(item, `${key}-item-${itemIndex}`)}
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={key} className={styles.richList}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-item-${itemIndex}`}>
                    {renderTextWithMarks(item, `${key}-item-${itemIndex}`)}
                  </li>
                ))}
              </ul>
            )
          case "table":
            return (
              <div key={key} className={styles.tableWrap}>
                <table className={styles.richTable}>
                  <thead>
                    <tr>
                      {block.headers.map((header, headerIndex) => (
                        <th key={`${key}-head-${headerIndex}`}>
                          {renderTextWithMarks(header, `${key}-head-${headerIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}-row-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${key}-cell-${rowIndex}-${cellIndex}`}>
                            {renderTextWithMarks(cell, `${key}-cell-${rowIndex}-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case "code":
            return (
              <pre key={key} className={styles.codeBlock}>
                <code>{block.lines.join("\n")}</code>
              </pre>
            )
          case "quote":
            return (
              <blockquote key={key} className={styles.blockQuote}>
                {renderParagraphLines(block.lines, key)}
              </blockquote>
            )
          case "divider":
            return <hr key={key} className={styles.richDivider} />
          case "paragraph":
          default:
            return (
              <p key={key} className={styles.richParagraph}>
                {renderParagraphLines(block.lines, key)}
              </p>
            )
        }
      })}
    </div>
  )
}
