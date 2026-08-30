import React from "react";
import { Box, Text } from "ink";
import { wrapText, getTerminalSize } from "../utils/terminalSize.js";

interface Props {
  title: string;
  markdown: string;
  mermaidDiagrams: string[];
  scrollOffset: number;
  maxVisibleLines: number;
}

/**
 * Simple Markdown-ish renderer for the terminal.
 * Supports # headings, ``` code fences, **bold**, and plain text.
 * Mermaid diagrams are shown as source blocks (terminals can't render graphs natively).
 */
export function LessonViewer({
  title,
  markdown,
  mermaidDiagrams,
  scrollOffset,
  maxVisibleLines,
}: Props): React.ReactElement {
  const { columns } = getTerminalSize();
  const contentWidth = Math.max(40, columns - 4);

  const rendered = renderMarkdown(markdown, contentWidth);
  const diagramBlocks = mermaidDiagrams.flatMap((d, i) => [
    "",
    `── Mermaid Diagram ${i + 1} ──`,
    ...d.split("\n"),
    "────────────────────────",
  ]);

  const allLines = [...rendered, ...diagramBlocks];
  const visible = allLines.slice(scrollOffset, scrollOffset + maxVisibleLines);
  const total = allLines.length;
  const atEnd = scrollOffset + maxVisibleLines >= total;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      <Text dimColor>
        Lines {scrollOffset + 1}–{Math.min(scrollOffset + maxVisibleLines, total)} of {total}
        {atEnd ? "  (end)" : "  ↓ more"}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((line, i) => (
          <Text key={i}>{line || " "}</Text>
        ))}
      </Box>
    </Box>
  );
}

function renderMarkdown(md: string, width: number): string[] {
  const lines: string[] = [];
  const raw = md.split("\n");
  let inCode = false;

  for (const line of raw) {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      lines.push(inCode ? "┌─ code ─────────────────" : "└────────────────────────");
      continue;
    }
    if (inCode) {
      lines.push("│ " + line.slice(0, width - 2));
      continue;
    }
    if (line.startsWith("# ")) {
      lines.push("");
      lines.push(`▸ ${line.slice(2).toUpperCase()}`);
      lines.push("─".repeat(Math.min(width, line.length + 2)));
      continue;
    }
    if (line.startsWith("## ")) {
      lines.push("");
      lines.push(`• ${line.slice(3)}`);
      continue;
    }
    if (line.startsWith("### ")) {
      lines.push(`  › ${line.slice(4)}`);
      continue;
    }
    // Strip simple bold/italic markers for cleaner terminal output
    const cleaned = line
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`(.*?)`/g, "$1");
    lines.push(...wrapText(cleaned, width));
  }
  return lines;
}

export function countLessonLines(
  markdown: string,
  mermaidDiagrams: string[],
  width?: number
): number {
  const w = width ?? getTerminalSize().columns - 4;
  const rendered = renderMarkdown(markdown, w);
  const diagramExtra = mermaidDiagrams.reduce(
    (acc, d) => acc + d.split("\n").length + 3,
    0
  );
  return rendered.length + diagramExtra;
}
