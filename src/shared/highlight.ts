/**
 * Valid DOCX highlight colors.
 * These map directly to the w:highlight w:val enumeration.
 */
export const HIGHLIGHT_COLORS = [
  "black",
  "blue",
  "cyan",
  "green",
  "magenta",
  "red",
  "yellow",
  "white",
  "darkBlue",
  "darkCyan",
  "darkGreen",
  "darkMagenta",
  "darkRed",
  "darkYellow",
  "darkGray",
  "lightGray",
  "none",
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export function isHighlightColor(color: string): color is HighlightColor {
  return HIGHLIGHT_COLORS.includes(color as HighlightColor);
}

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";
