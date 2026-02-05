/**
 * Semantic Analyzer
 *
 * Analyzes paragraph content for uniform styles that can be hoisted
 * to block-level @style directives or @bold/@italic modifiers.
 *
 * This moves the style detection logic from converters/paragraph.ts
 * into the semantic layer.
 */

import type {
  ExtractedRun,
  ExtractedRunStyle,
  ExtractedParagraphContent,
  ExtractedHyperlink,
} from "../extraction/types";

/**
 * Type guard for hyperlinks.
 */
function isHyperlink(item: ExtractedParagraphContent): item is ExtractedHyperlink {
  return "type" in item && item.type === "hyperlink";
}

/**
 * Type guard for runs.
 */
function isRun(item: ExtractedParagraphContent): item is ExtractedRun {
  return "text" in item;
}

/**
 * Collect all text runs from paragraph content (flattening hyperlinks).
 */
function collectAllRuns(content: ExtractedParagraphContent[]): ExtractedRun[] {
  const runs: ExtractedRun[] = [];
  for (const item of content) {
    if (isHyperlink(item)) {
      runs.push(...item.runs);
    } else if (isRun(item)) {
      runs.push(item);
    }
  }
  return runs;
}

/**
 * Filter to runs that have actual text content.
 */
function runsWithText(runs: ExtractedRun[]): ExtractedRun[] {
  return runs.filter((r) => r.text.trim().length > 0);
}

/**
 * Detect if all runs share a uniform simple style (bold-only or italic-only).
 * Returns "bold" or "italic" if applicable, undefined otherwise.
 *
 * Used to emit @bold: or @italic: paragraph modifiers.
 */
export function detectUniformEmphasis(
  content: ExtractedParagraphContent[],
): "bold" | "italic" | undefined {
  const runs = runsWithText(collectAllRuns(content));
  if (runs.length === 0) return undefined;

  // Check if ALL are bold-only (bold=true, italic=false, no other formatting)
  const allBoldOnly = runs.every(
    (r) =>
      r.style.bold &&
      !r.style.italic &&
      !r.style.strike &&
      !r.style.code &&
      !r.style.underline,
  );
  if (allBoldOnly) return "bold";

  // Check if ALL are italic-only
  const allItalicOnly = runs.every(
    (r) =>
      r.style.italic &&
      !r.style.bold &&
      !r.style.strike &&
      !r.style.code &&
      !r.style.underline,
  );
  if (allItalicOnly) return "italic";

  return undefined;
}

/**
 * Detect uniform font/size across all runs.
 * Returns the shared font and sizePt, or undefined if not uniform.
 */
export function detectUniformFontSize(
  content: ExtractedParagraphContent[],
): { font?: string; sizePt?: number } {
  const runs = runsWithText(collectAllRuns(content));
  if (runs.length === 0) return {};

  const first = runs[0]!;
  const font = first.style.font;
  const sizePt = first.style.sizePt;

  const allSameFont = font !== undefined && runs.every((r) => r.style.font === font);
  const allSameSize = sizePt !== undefined && runs.every((r) => r.style.sizePt === sizePt);

  return {
    font: allSameFont ? font : undefined,
    sizePt: allSameSize ? sizePt : undefined,
  };
}

/**
 * Dominant style for comparison.
 */
export interface DominantStyle {
  font?: string;
  sizePt?: number;
}

/**
 * Compute style attributes that differ from dominant style.
 * Used for @style block emission.
 */
export function computeStyleDifference(
  paragraphStyle: { font?: string; sizePt?: number },
  dominant: DominantStyle | undefined,
): Record<string, string> | undefined {
  if (!dominant) return undefined;

  const attrs: Record<string, string> = {};

  // Compare font (case-insensitive)
  if (paragraphStyle.font && dominant.font) {
    if (paragraphStyle.font.toLowerCase() !== dominant.font.toLowerCase()) {
      attrs.font = paragraphStyle.font;
    }
  } else if (paragraphStyle.font && !dominant.font) {
    attrs.font = paragraphStyle.font;
  }

  // Compare size
  if (paragraphStyle.sizePt && dominant.sizePt) {
    if (paragraphStyle.sizePt !== dominant.sizePt) {
      attrs.size = `${paragraphStyle.sizePt}pt`;
    }
  } else if (paragraphStyle.sizePt && !dominant.sizePt) {
    attrs.size = `${paragraphStyle.sizePt}pt`;
  }

  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

/**
 * Detect uniform inline style attributes for block @style hoisting.
 * If all runs share the same style differences vs dominant, returns those attrs.
 */
export function detectUniformStyleAttrs(
  content: ExtractedParagraphContent[],
  dominant: DominantStyle,
): Record<string, string> | undefined {
  const runs = runsWithText(collectAllRuns(content));
  if (runs.length === 0) return undefined;

  const makeAttrs = (style: ExtractedRunStyle): Record<string, string> => {
    const attrs: Record<string, string> = {};

    // Font difference
    if (style.font && dominant.font) {
      if (style.font.toLowerCase() !== dominant.font.toLowerCase()) {
        attrs.font = style.font;
      }
    } else if (style.font && !dominant.font) {
      attrs.font = style.font;
    }

    // Size difference
    if (style.sizePt && dominant.sizePt) {
      if (style.sizePt !== dominant.sizePt) {
        attrs.size = `${style.sizePt}pt`;
      }
    } else if (style.sizePt && !dominant.sizePt) {
      attrs.size = `${style.sizePt}pt`;
    }

    // Color: any explicit color is notable
    if (style.color) {
      attrs.color = style.color;
    }

    // Character spacing
    if (style.characterSpacing !== undefined) {
      attrs.spacing =
        style.characterSpacing % 20 === 0
          ? `${style.characterSpacing / 20}pt`
          : `${style.characterSpacing}twip`;
    }

    // Background shading fill
    if (style.shadingFill) {
      attrs.background = `#${style.shadingFill}`;
    }

    return attrs;
  };

  const firstAttrs = makeAttrs(runs[0]!.style);
  if (Object.keys(firstAttrs).length === 0) return undefined;

  const firstJson = JSON.stringify(
    Object.entries(firstAttrs).sort(([a], [b]) => a.localeCompare(b)),
  );

  for (let i = 1; i < runs.length; i++) {
    const attrs = makeAttrs(runs[i]!.style);
    const json = JSON.stringify(
      Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b)),
    );
    if (json !== firstJson) return undefined;
  }

  return firstAttrs;
}

/**
 * Check if a paragraph has any content that requires @style wrapping.
 * (e.g., runs with different styles, inline formatting, etc.)
 */
export function hasVariedStyles(content: ExtractedParagraphContent[]): boolean {
  const runs = runsWithText(collectAllRuns(content));
  if (runs.length <= 1) return false;

  const first = runs[0]!.style;

  for (let i = 1; i < runs.length; i++) {
    const style = runs[i]!.style;
    if (
      style.bold !== first.bold ||
      style.italic !== first.italic ||
      style.strike !== first.strike ||
      style.code !== first.code ||
      style.underline !== first.underline ||
      style.font !== first.font ||
      style.sizePt !== first.sizePt ||
      style.color !== first.color
    ) {
      return true;
    }
  }

  return false;
}
