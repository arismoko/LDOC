/**
 * Semantic Classifier
 *
 * Classifies ExtractedParagraph into SemanticParagraph with:
 * - Paragraph kind (heading, list, normal, empty, pageBreak)
 * - Heading level detection
 * - List prefix and level
 * - Alignment and spacing metadata
 */

import type {
  ExtractedParagraph,
  ExtractedRun,
  ExtractedParagraphContent,
  ExtractedHyperlink,
} from "../extraction/types";
import type { NumberingInfo } from "../parsers/numbering";
import { listPrefix } from "../parsers/numbering";
import type { SemanticParagraph, ParagraphKind } from "./types";

/**
 * Check if a style ID is a heading style (Heading1-6).
 * Returns the heading level (1-6) or undefined.
 */
function detectHeadingLevel(styleId: string | undefined): number | undefined {
  if (!styleId) return undefined;
  const m = styleId.match(/^Heading([1-6])$/i);
  if (m) {
    return parseInt(m[1]!, 10);
  }
  return undefined;
}

/**
 * Check if a style ID is a blockquote style.
 */
function isBlockquoteStyle(styleId: string | undefined): boolean {
  if (!styleId) return false;
  const lower = styleId.toLowerCase();
  return (
    lower === "quote" ||
    lower === "blockquote" ||
    lower === "intensequote" ||
    lower.includes("quote")
  );
}

/**
 * Check if a style ID is a TOC style (TOC1-9).
 */
function isTocStyle(styleId: string | undefined): boolean {
  if (!styleId) return false;
  return /^toc[1-9]$/i.test(styleId);
}

/**
 * Type guard for hyperlinks.
 */
function isHyperlink(item: ExtractedParagraphContent): item is ExtractedHyperlink {
  return "type" in item && item.type === "hyperlink";
}

/**
 * Type guard for runs (have "text" property).
 */
function isRun(item: ExtractedParagraphContent): item is ExtractedRun {
  return "text" in item;
}

/**
 * Check if paragraph has any visible text content.
 */
function hasTextContent(content: ExtractedParagraphContent[]): boolean {
  for (const item of content) {
    if (isHyperlink(item)) {
      for (const run of item.runs) {
        if (run.text.trim().length > 0) return true;
      }
    } else if (isRun(item)) {
      if (item.text.trim().length > 0) return true;
    } else {
      // Images and footnotes are "content"
      return true;
    }
  }
  return false;
}

/**
 * Check if paragraph has any structural markers (tabs, hard breaks).
 */
function hasStructuralMarkers(content: ExtractedParagraphContent[]): boolean {
  for (const item of content) {
    if (isHyperlink(item)) {
      for (const run of item.runs) {
        if (run.tab || run.hardBreak) return true;
      }
    } else if (isRun(item)) {
      if (item.tab || item.hardBreak) return true;
    }
  }
  return false;
}

/**
 * Classify an extracted paragraph into a semantic paragraph.
 */
export function classifyParagraph(
  extracted: ExtractedParagraph,
  numInfo: NumberingInfo,
): SemanticParagraph {
  const { styleId, numbering, alignment, content, bookmarks } = extracted;

  // 1. Page break only
  if (extracted.isPageBreakOnly) {
    return {
      type: "paragraph",
      extracted,
      kind: "pageBreak",
      isEmpty: false,
      indentLeftTwips: 0,
      anchors: bookmarks,
    };
  }

  // 2. Check for empty paragraph
  const hasText = hasTextContent(content);
  const hasMarkers = hasStructuralMarkers(content);
  const isEmpty = !hasText && !hasMarkers;

  // Normalize alignment (only keep center/right as significant)
  const effectiveAlignment: "center" | "right" | undefined =
    alignment === "center" ? "center" : alignment === "right" ? "right" : undefined;

  // Spacing
  const spacingBefore = extracted.spacingBefore;
  const spacingAfter = extracted.spacingAfter;

  // Base result properties
  const baseResult = {
    type: "paragraph" as const,
    extracted,
    isEmpty,
    alignment: effectiveAlignment,
    indentLeftTwips: extracted.indentLeftTwips ?? 0,
    spacingBefore,
    spacingAfter,
    anchors: bookmarks,
  };

  // 3. Heading detection
  const headingLevel = detectHeadingLevel(styleId);
  if (headingLevel !== undefined) {
    return {
      ...baseResult,
      kind: "heading",
      headingLevel,
      // Headings don't carry indentLeftTwips for emission purposes
      indentLeftTwips: 0,
    };
  }

  // 4. List detection
  if (numbering && !isTocStyle(styleId)) {
    const { prefix } = listPrefix(numInfo, numbering.numId, numbering.ilvl);
    return {
      ...baseResult,
      kind: "list",
      listPrefix: prefix,
      listLevel: numbering.ilvl,
      // Lists don't carry indentLeftTwips; numbering handles indentation
      indentLeftTwips: 0,
    };
  }

  // 5. Empty paragraph
  if (isEmpty) {
    return {
      ...baseResult,
      kind: "empty",
    };
  }

  // 6. Normal paragraph
  return {
    ...baseResult,
    kind: "normal",
  };
}


