import type { Node } from "./ast";
import type { ParserContext } from "./parsers/inline";

export function pushBlankLines(target: Node[], line: number, column: number, newlineCount: number): void {
  // 2+ newlines => 1+ blank lines (N newlines = N-1 blank lines)
  if (newlineCount >= 2) {
    target.push({
      type: "empty_paragraph",
      line,
      column,
      count: newlineCount - 1,
    } as any);
  }
}

export function parseLengthToTwip(raw: string, line: number): number {
  const m = raw.trim().match(/^([0-9]+(?:\.[0-9]+)?)(in|cm|mm|pt)$/i);
  if (!m) {
    throw new Error(`Invalid length: ${raw} at line ${line}. Use units like 1in, 2cm, 12pt.`);
  }
  const value = parseFloat(m[1]!);
  const unit = m[2]!.toLowerCase();
  switch (unit) {
    case "in":
      return Math.round(value * 1440);
    case "cm":
      return Math.round((value * 1440) / 2.54);
    case "mm":
      return Math.round((value * 1440) / 25.4);
    case "pt":
      return Math.round(value * 20);
    default:
      throw new Error(`Unsupported unit: ${unit}`);
  }
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
