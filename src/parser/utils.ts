import type { Node } from "./ast";
import type { ParserContext } from "./parsers/inline";
import { parseLengthToTwip as sharedParseLengthToTwip } from "../shared/units";

export function pushBlankLines(target: Node[], line: number, column: number, newlineCount: number): void {
  // 3+ newlines => 1+ empty paragraphs for extra spacing
  // 2 newlines (1 blank line) = paragraph separator, no visual gap needed
  // 3 newlines (2 blank lines) = 1 empty paragraph
  // 4 newlines (3 blank lines) = 2 empty paragraphs, etc.
  if (newlineCount >= 3) {
    target.push({
      type: "empty_paragraph",
      line,
      column,
      count: newlineCount - 2,
    } as any);
  }
}

/**
 * Parse a length string to twips (strict mode - requires units).
 * Re-exports from shared/units for backward compatibility.
 */
export function parseLengthToTwip(raw: string, line?: number): number {
  return sharedParseLengthToTwip(raw, { line, lenient: false });
}

export function parseLiteral(raw: string): any {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  // quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  // JSON array/object
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      return JSON.parse(s);
    } catch (e) {
      // ignore, treat as string
    }
  }
  return s;
}
