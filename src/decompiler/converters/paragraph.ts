import { findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import { type NumberingInfo, listPrefix } from "../parsers/numbering";
import { type ParagraphStyleMap, resolveStyleIndentLeftTwips } from "../parsers/styles";
import { type TextSegment, parseRunStyle, collectTextFromNodes, normalizeWs, wrapEmphasis, coalesceStyledSegments, coalesceInlineStyles } from "./run";
import type { FontSizeStats } from "../statistics";

export type DecompilerOptions = {
  /**
   * Control emission of @indent/@outdent directives.
   * - 'on': Always emit indent directives when indentation is detected
   * - 'off': Never emit indent directives (simpler output)
   * - 'auto': Same as 'on' (default behavior)
   */
  emitIndent?: 'on' | 'off' | 'auto' | boolean;
  /**
   * Dominant style for the document (detected from styles.xml or frequency).
   * Used to determine when to emit @style block modifiers.
   */
  dominantStyle?: FontSizeStats;
};

export type ParagraphInfo = {
  line: string;
  alignment?: string; // "center" | "right" | undefined
  indentLeftTwips?: number;
  isHeading: boolean;
  isList: boolean;
  isEmpty: boolean;
  anchors?: string[]; // Bookmark names (from w:bookmarkStart, excluding _ prefix)
  /** Style attributes that differ from dominant (for @style emission) */
  styleAttrs?: Record<string, string>;
  isBlockquote?: boolean;
  spacing?: { after?: number; before?: number };
};

// Hyperlink info for collecting text within hyperlinks
type HyperlinkSegment = {
  type: "hyperlink";
  url: string;
  segments: TextSegment[];
};

type ContentSegment = TextSegment | HyperlinkSegment;

function isTocStyle(styleId: string | undefined): boolean {
  if (!styleId) return false;
  // Match TOC1..TOC9 (case-insensitive)
  return /^toc[1-9]$/i.test(styleId);
}

function isBlockquoteStyle(styleId: string | undefined): boolean {
  if (!styleId) return false;
  const lower = styleId.toLowerCase();
  return lower === "quote" || 
         lower === "blockquote" || 
         lower === "intensequote" ||
         lower.includes("quote");
}

function paragraphAlignment(pNode: XmlNode): string | undefined {
  const pChildren = pNode["w:p"] as XmlNode[];
  const pPr = findFirst(pChildren, "w:pPr");
  if (!pPr) return undefined;
  const pPrChildren = pPr["w:pPr"] as XmlNode[];
  const jc = findFirst(pPrChildren, "w:jc");
  return attrVal(jc, "@_w:val");
}

function isPageBreakParagraph(pNode: XmlNode): boolean {
  // Check for a paragraph that is just a page break:
  // - Has a run with w:br w:type="page"
  // - Or has w:lastRenderedPageBreak (but we ignore that as it's auto-generated)
  // We look for explicit page break
  const pChildren = pNode["w:p"] as XmlNode[];
  let hasPageBreak = false;
  let hasText = false;

  for (const child of pChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:r") {
      const runChildren = child["w:r"] as XmlNode[];
      for (const rc of runChildren ?? []) {
        const rk = getOnlyKey(rc);
        if (rk === "w:br") {
          const brType = attrVal(rc, "@_w:type");
          if (brType === "page") {
            hasPageBreak = true;
          }
        }
        if (rk === "w:t") {
          // Check if there's actual text
          const kids = rc["w:t"] as XmlNode[];
          for (const c of kids ?? []) {
            const t = c?.["#text"];
            if (typeof t === "string" && t.trim()) hasText = true;
          }
        }
      }
    }
  }

  return hasPageBreak && !hasText;
}

function paragraphSpacing(pNode: XmlNode): { after?: number; before?: number } | undefined {
  const pChildren = pNode["w:p"] as XmlNode[];
  const pPr = findFirst(pChildren, "w:pPr");
  if (!pPr) return undefined;
  const pPrChildren = pPr["w:pPr"] as XmlNode[];
  const spacing = findFirst(pPrChildren, "w:spacing");
  if (!spacing) return undefined;

  const after = attrVal(spacing, "@_w:after");
  const before = attrVal(spacing, "@_w:before");

  if (after === undefined && before === undefined) return undefined;

  return {
    after: after ? parseInt(after, 10) : undefined,
    before: before ? parseInt(before, 10) : undefined,
  };
}

export function paragraphHasPageBreak(pNode: XmlNode): boolean {
  // Check if paragraph contains a page break (even with other content)
  const pChildren = pNode["w:p"] as XmlNode[];
  for (const child of pChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:r") {
      const runChildren = child["w:r"] as XmlNode[];
      for (const rc of runChildren ?? []) {
        const rk = getOnlyKey(rc);
        if (rk === "w:br") {
          const brType = attrVal(rc, "@_w:type");
          if (brType === "page") {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function paragraphSegments(pNode: XmlNode, rels?: Map<string, string>): ContentSegment[] {
  const pChildren = pNode["w:p"] as XmlNode[];
  const segments: ContentSegment[] = [];

  for (const child of pChildren ?? []) {
    const key = getOnlyKey(child);
    if (!key) continue;

    if (key === "w:r") {
      const style = parseRunStyle(child);
      const runChildren = child["w:r"] as XmlNode[];
      const textSegments: TextSegment[] = [];
      collectTextFromNodes(runChildren, textSegments, style, rels);
      segments.push(...textSegments);
      continue;
    }

    if (key === "w:hyperlink") {
      // Check for internal cross-reference (has w:anchor attribute)
      const anchor = attrVal(child, "@_w:anchor");
      if (anchor) {
        // Internal cross-reference - emit as [[anchor]]
        // Collect the link text to verify, but emit the anchor syntax
        const linkChildren = child["w:hyperlink"] as XmlNode[];
        const linkSegments: TextSegment[] = [];
        for (const n of linkChildren ?? []) {
          const k = getOnlyKey(n);
          if (k === "w:r") {
            const style = parseRunStyle(n);
            const runChildren = n["w:r"] as XmlNode[];
            collectTextFromNodes(runChildren, linkSegments, style, rels);
          }
        }
        // Create a segment with the cross-ref syntax
        // Use the first segment's style for emphasis wrapping
        const baseStyle = linkSegments[0]?.style ?? { bold: false, italic: false };
        segments.push({
          style: baseStyle,
          text: `[[${anchor}]]`,
        });
        continue;
      }

      // External hyperlink (existing logic with r:id)
      const rId = attrVal(child, "@_r:id");
      const url = rId && rels ? rels.get(rId) : undefined;
      
      // Collect runs within the hyperlink
      const linkChildren = child["w:hyperlink"] as XmlNode[];
      const linkSegments: TextSegment[] = [];
      
      for (const n of linkChildren ?? []) {
        const k = getOnlyKey(n);
        if (k === "w:r") {
          const style = parseRunStyle(n);
          const runChildren = n["w:r"] as XmlNode[];
          collectTextFromNodes(runChildren, linkSegments, style, rels);
        }
      }
      
      if (url && linkSegments.length > 0) {
        // Create a hyperlink segment
        segments.push({
          type: "hyperlink",
          url,
          segments: linkSegments,
        });
      } else {
        // No URL found, just add the text segments directly
        segments.push(...linkSegments);
      }
      continue;
    }
  }

  return segments;
}

function stylesMatch(a: { bold: boolean; italic: boolean; strike?: boolean; code?: boolean }, b: { bold: boolean; italic: boolean; strike?: boolean; code?: boolean }): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code;
}

// Check if paragraph is uniformly styled with a single style modifier (bold-only, italic-only, etc.)
// Returns the modifier name if applicable, undefined otherwise
function detectUniformStyle(segments: ContentSegment[]): "bold" | "italic" | undefined {
  // Collect all text segments (flatten hyperlinks)
  const allTextSegs: TextSegment[] = [];
  for (const seg of segments) {
    if ("type" in seg && seg.type === "hyperlink") {
      allTextSegs.push(...seg.segments);
    } else {
      allTextSegs.push(seg as TextSegment);
    }
  }
  
  // Filter to segments with actual text content
  const withText = allTextSegs.filter(s => s.text.trim().length > 0);
  if (withText.length === 0) return undefined;
  
  // Check if ALL are bold-only (bold=true, italic=false)
  const allBoldOnly = withText.every(s => s.style.bold && !s.style.italic && !s.style.strike && !s.style.code);
  if (allBoldOnly) return "bold";
  
  // Check if ALL are italic-only (italic=true, bold=false)
  const allItalicOnly = withText.every(s => s.style.italic && !s.style.bold && !s.style.strike && !s.style.code);
  if (allItalicOnly) return "italic";
  
  return undefined;
}

/**
 * Detect uniform font/size across a paragraph.
 * Returns font and sizePt if all runs share the same values.
 */
function detectUniformFontSize(segments: ContentSegment[]): { font?: string; sizePt?: number } {
  const allTextSegs: TextSegment[] = [];
  for (const seg of segments) {
    if ("type" in seg && seg.type === "hyperlink") {
      allTextSegs.push(...seg.segments);
    } else {
      allTextSegs.push(seg as TextSegment);
    }
  }
  
  const withText = allTextSegs.filter(s => s.text.trim().length > 0);
  if (withText.length === 0) return {};
  
  // Get first segment's font/size
  const first = withText[0]!;
  const font = first.style.font;
  const sizePt = first.style.sizePt;
  
  // Check if all segments have the same font/size
  const allSameFont = font && withText.every(s => s.style.font === font);
  const allSameSize = sizePt && withText.every(s => s.style.sizePt === sizePt);
  
  return {
    font: allSameFont ? font : undefined,
    sizePt: allSameSize ? sizePt : undefined,
  };
}

/**
 * Compute style attributes that differ from dominant style.
 * Returns attributes to use in @style modifier, or undefined if no difference.
 */
function computeStyleAttrs(
  paragraphFontSize: { font?: string; sizePt?: number },
  dominantStyle?: FontSizeStats
): Record<string, string> | undefined {
  if (!dominantStyle) return undefined;
  
  const attrs: Record<string, string> = {};
  
  // Compare font (case-insensitive)
  if (paragraphFontSize.font && dominantStyle.font) {
    if (paragraphFontSize.font.toLowerCase() !== dominantStyle.font.toLowerCase()) {
      attrs.font = paragraphFontSize.font;
    }
  } else if (paragraphFontSize.font && !dominantStyle.font) {
    attrs.font = paragraphFontSize.font;
  }
  
  // Compare size
  if (paragraphFontSize.sizePt && dominantStyle.sizePt) {
    if (paragraphFontSize.sizePt !== dominantStyle.sizePt) {
      attrs.size = `${paragraphFontSize.sizePt}pt`;
    }
  } else if (paragraphFontSize.sizePt && !dominantStyle.sizePt) {
    attrs.size = `${paragraphFontSize.sizePt}pt`;
  }
  
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

// Get paragraph text without emphasis wrapping (for use with @bold/@italic modifiers)
function paragraphTextPlain(pNode: XmlNode, preserveTabs = false, rels?: Map<string, string>): string {
  const contentSegments = paragraphSegments(pNode, rels);
  
  const textSegs: TextSegment[] = [];
  const resultParts: string[] = [];
  
  for (const seg of contentSegments) {
    if ("type" in seg && seg.type === "hyperlink") {
      if (textSegs.length > 0) {
        const merged = mergeTextSegments(textSegs);
        resultParts.push(normalizeWs(merged.map((s) => s.text).join(""), preserveTabs, false));
        textSegs.length = 0;
      }
      const mergedLink = mergeTextSegments(seg.segments);
      const linkText = normalizeWs(mergedLink.map((s) => s.text).join(""), preserveTabs);
      resultParts.push(`[${linkText}](${seg.url})`);
    } else {
      textSegs.push(seg as TextSegment);
    }
  }
  
  if (textSegs.length > 0) {
    const merged = mergeTextSegments(textSegs);
    resultParts.push(normalizeWs(merged.map((s) => s.text).join(""), preserveTabs));
  }
  
  return resultParts.join("");
}

function mergeTextSegments(segments: TextSegment[]): TextSegment[] {
  const merged: TextSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    // Don't merge across newlines - this prevents @style()[] from spanning lines
    const lastEndsWithNewline = last?.text.endsWith("\n");
    if (last && stylesMatch(last.style, seg.style) && !lastEndsWithNewline) {
      last.text += seg.text;
    } else {
      merged.push({ style: { ...seg.style }, text: seg.text });
    }
  }
  return merged;
}

export function paragraphText(pNode: XmlNode, preserveTabs = false, rels?: Map<string, string>, dominantStyle?: FontSizeStats): string {
  const contentSegments = paragraphSegments(pNode, rels);
  
  // Choose the coalescing function based on whether we have a dominant style
  const coalesce = (segments: TextSegment[]) => 
    dominantStyle ? coalesceInlineStyles(segments, dominantStyle) : coalesceStyledSegments(segments);
  
  // Process non-hyperlink segments with merging
  const textSegs: TextSegment[] = [];
  const resultParts: string[] = [];
  
  for (const seg of contentSegments) {
    if ("type" in seg && seg.type === "hyperlink") {
      // Flush accumulated text segments - don't trim trailing space before hyperlink
      if (textSegs.length > 0) {
        const merged = mergeTextSegments(textSegs);
        resultParts.push(normalizeWs(coalesce(merged), preserveTabs, false));
        textSegs.length = 0;
      }
      // Add hyperlink - use standard coalescing for link text
      const mergedLink = mergeTextSegments(seg.segments);
      const linkText = normalizeWs(coalesceStyledSegments(mergedLink), preserveTabs);
      resultParts.push(`[${linkText}](${seg.url})`);
    } else {
      textSegs.push(seg as TextSegment);
    }
  }
  
  // Flush remaining text segments - trim trailing space at end of paragraph
  if (textSegs.length > 0) {
    const merged = mergeTextSegments(textSegs);
    resultParts.push(normalizeWs(coalesce(merged), preserveTabs));
  }
  
  return resultParts.join("");
}

function paragraphStyleId(pNode: XmlNode): string | undefined {
  const pChildren = pNode["w:p"] as XmlNode[];
  const pPr = findFirst(pChildren, "w:pPr");
  if (!pPr) return undefined;
  const pPrChildren = pPr["w:pPr"] as XmlNode[];
  const pStyle = findFirst(pPrChildren, "w:pStyle");
  const val = attrVal(pStyle, "@_w:val");
  return typeof val === "string" ? val : undefined;
}

function paragraphNumbering(pNode: XmlNode): { numId: string; ilvl: number } | undefined {
  const pChildren = pNode["w:p"] as XmlNode[];
  const pPr = findFirst(pChildren, "w:pPr");
  if (!pPr) return undefined;
  const pPrChildren = pPr["w:pPr"] as XmlNode[];
  const numPr = findFirst(pPrChildren, "w:numPr");
  if (!numPr) return undefined;

  const numPrChildren = numPr["w:numPr"] as XmlNode[];
  const ilvlNode = findFirst(numPrChildren, "w:ilvl");
  const numIdNode = findFirst(numPrChildren, "w:numId");
  const ilvlRaw = attrVal(ilvlNode, "@_w:val");
  const numId = attrVal(numIdNode, "@_w:val");
  if (!numId) return undefined;
  const ilvl = ilvlRaw ? parseInt(ilvlRaw, 10) : 0;
  return { numId, ilvl: Number.isFinite(ilvl) ? ilvl : 0 };
}

function paragraphIndentLeftTwips(pNode: XmlNode, styles: ParagraphStyleMap): number {
  const pChildren = pNode["w:p"] as XmlNode[];
  const pPr = findFirst(pChildren, "w:pPr");
  if (pPr) {
    const pPrChildren = pPr["w:pPr"] as XmlNode[];
    const ind = findFirst(pPrChildren, "w:ind");
    const left = attrVal(ind, "@_w:left");
    if (left !== undefined) {
      const n = parseInt(left, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  const styleId = paragraphStyleId(pNode);
  return resolveStyleIndentLeftTwips(styleId, styles) ?? 0;
}

/**
 * Extract bookmark names from w:bookmarkStart elements in a paragraph.
 * Filters out hidden bookmarks (names starting with `_`).
 */
function extractBookmarkNames(pNode: XmlNode): string[] {
  const pChildren = pNode["w:p"] as XmlNode[];
  const names: string[] = [];
  for (const child of pChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:bookmarkStart") {
      const name = attrVal(child, "@_w:name");
      // Filter out hidden bookmarks (start with _)
      if (typeof name === "string" && !name.startsWith("_")) {
        names.push(name);
      }
    }
  }
  return names;
}

export function paragraphToLdoc(pNode: XmlNode, numInfo: NumberingInfo, styles: ParagraphStyleMap, options?: DecompilerOptions, rels?: Map<string, string>): ParagraphInfo {
  // Extract bookmarks (anchors) from this paragraph
  const anchors = extractBookmarkNames(pNode);
  const anchorsField = anchors.length > 0 ? anchors : undefined;

  // Check for page break only paragraph
  if (isPageBreakParagraph(pNode)) {
    return { line: "@pagebreak", isHeading: false, isList: false, isEmpty: false, anchors: anchorsField };
  }

  const styleId = paragraphStyleId(pNode);
  const alignment = paragraphAlignment(pNode);
  const indentLeftTwips = paragraphIndentLeftTwips(pNode, styles);
  const spacing = paragraphSpacing(pNode);
  
  // Check for TOC styles - don't emit list markers for TOC paragraphs
  const isToc = isTocStyle(styleId);
  
  // Get content segments for uniform style detection
  const contentSegments = paragraphSegments(pNode, rels);
  const uniformStyle = detectUniformStyle(contentSegments);
  
  // Detect uniform font/size for @style emission
  const paragraphFontSize = detectUniformFontSize(contentSegments);
  const styleAttrs = computeStyleAttrs(paragraphFontSize, options?.dominantStyle);
  
  // For TOC paragraphs, preserve tabs for readable title+page format
  const text = paragraphText(pNode, isToc, rels, options?.dominantStyle);
  const isEmpty = !text.trim();

  // Check for heading style first
  if (styleId) {
    const m = styleId.match(/^Heading([1-6])$/i);
    if (m) {
      const level = parseInt(m[1]!, 10);
      
      // If heading contains hard breaks (newlines), use @h1 block syntax
      // Hard breaks are represented as "  \n" (double-space before newline)
      if (text.includes("\n")) {
        // Multi-line heading: use @h1 block with indented content
        // Split on hard breaks, preserve trailing spaces for hard break syntax
        const lines = text.split("\n").map((line, i, arr) => {
          // Add trailing double-space for hard break (except last line)
          const hardBreakSuffix = i < arr.length - 1 ? "  " : "";
          // Trim existing trailing spaces before adding our controlled suffix
          return `  ${line.trimEnd()}${hardBreakSuffix}`;
        });
        return {
          line: `@h${level}\n${lines.join("\n")}`,
          indentLeftTwips,
          isHeading: true,
          isList: false,
          isEmpty,
          anchors: anchorsField,
        };
      }
      
      // Single-line heading: use # syntax
      const hashes = "#".repeat(Math.max(1, Math.min(6, level)));
      return {
        line: `${hashes} ${text}`.trimEnd(),
        indentLeftTwips,
        isHeading: true,
        isList: false,
        isEmpty,
        anchors: anchorsField,
      };
    }
  }

  // Check for blockquote style
  if (isBlockquoteStyle(styleId)) {
    return {
      line: `> ${text}`.trimEnd(),
      alignment: alignment === "center" ? "center" : alignment === "right" ? "right" : undefined,
      indentLeftTwips: 0, // Don't also emit indent for blockquotes
      isHeading: false,
      isList: false,
      isEmpty,
      anchors: anchorsField,
      isBlockquote: true,
    };
  }

  // For TOC paragraphs, emit as plain text without list markers
  if (isToc) {
    // For TOC, just emit the text without alignment modifiers on the line
    // (alignment will be handled by grouping logic)
    return {
      line: text.trimEnd(),
      alignment: alignment === "center" ? "center" : alignment === "right" ? "right" : undefined,
      indentLeftTwips,
      isHeading: false,
      isList: false,
      isEmpty,
      anchors: anchorsField,
    };
  }

  const num = paragraphNumbering(pNode);
  if (num) {
    const { prefix } = listPrefix(numInfo, num.numId, num.ilvl);
    // Lists with alignment: alignment will be handled by the generator's emitAligned logic
    // We just record the alignment in the info for potential wrapping
    return {
      line: `${prefix}${text}`.trimEnd(),
      alignment: alignment === "center" ? "center" : alignment === "right" ? "right" : undefined,
      // Avoid emitting @indent for list items; numbering carries indentation.
      indentLeftTwips: 0,
      isHeading: false,
      isList: true,
      isEmpty,
      anchors: anchorsField,
    };
  }

  // Check for uniform @bold or @italic modifier (entire paragraph same style)
  if (uniformStyle && !isEmpty) {
    const plainText = paragraphTextPlain(pNode, isToc, rels);
    return {
      line: `@${uniformStyle}: ${plainText}`.trimEnd(),
      alignment: alignment === "center" ? "center" : alignment === "right" ? "right" : undefined,
      indentLeftTwips,
      isHeading: false,
      isList: false,
      isEmpty,
      anchors: anchorsField,
    };
  }

  // Regular paragraph - capture alignment for potential grouping
  return {
    line: text.trimEnd(),
    alignment: alignment === "center" ? "center" : alignment === "right" ? "right" : undefined,
    indentLeftTwips,
    isHeading: false,
    isList: false,
    isEmpty,
    anchors: anchorsField,
    styleAttrs,
    spacing,
  };
}
