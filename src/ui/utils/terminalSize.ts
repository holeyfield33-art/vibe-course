export interface TerminalSize {
  columns: number;
  rows: number;
}

export function getTerminalSize(): TerminalSize {
  return {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Split a long string into visual lines that fit the terminal width.
 */
export function wrapText(text: string, width: number): string[] {
  if (width < 10) width = 10;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(" ", width);
      if (breakAt < width * 0.5) breakAt = width;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining.length) lines.push(remaining);
  }
  return lines;
}
