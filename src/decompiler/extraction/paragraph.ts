/**
 * Paragraph Extraction
 *
 * Extracts paragraph data from DOCX XML without generating LDOC syntax.
 */

import { findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import { extractRunElements, isTextRun } from "./run";
import { resolveStyleIndentLeftTwips, type ParagraphStyleMap } from "../parsers/styles";
import type {
  ExtractedParagraph,
  ExtractedParagraphContent,
  ExtractedHyperlink,
  ExtractedNumbering,
  ExtractedRun,
} from "./types";

/**
 * Extract paragraph style ID from w:pPr/w:pStyle.
 */
function extractStyleId(pNode: XmlNode): string | undefined {
  const pChildren = pNode["w:p"] as XmlNode[];
  const pPr = findFirst(pChildren, "w:pPr");
  if (!pPr) return undefined;
  const pPrChildren = pPr["w:pPr"] as XmlNode[];
  const pStyle = findFirst(pPrChildren, "w:pStyle");
  const val = attrVal(pStyle, "@_w:val");
  return typeof val === "string" ? val : undefined;
}

/**
 * Extract paragraph alignment from w:pPr/w:jc.
 */
function extractAlignment(pNode: XmlNode): "left" | "center" | "right" | "justify" | undefined {
  const pChildren = pNode["w:p"] as XmlNode[];
  const pPr = findFirst(pChildren, "w:pPr");
  if (!pPr) return undefined;
  const pPrChildren = pPr["w:pPr"] as XmlNode[];
  const jc = findFirst(pPrChildren, "w:jc");
  const val = attrVal(jc, "@_w:val");
  
  switch (val) {
    case "left": return "left";
    case "center": return "center";
    case "right": return "right";
    case "both": return "justify";
    case "justify": return "justify";
    default: return undefined;
  }
}

/**
 * Extract numbering info from w:pPr/w:numPr.
 */
function extractNumbering(pNode: XmlNode): ExtractedNumbering | undefined {
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

/**
 * Extract left indent in twips from w:pPr/w:ind.
 */
function extractIndentLeftTwips(pNode: XmlNode, styles: ParagraphStyleMap): number {
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
  const styleId = extractStyleId(pNode);
  return resolveStyleIndentLeftTwips(styleId, styles) ?? 0;
}

/**
 * Extract spacing from w:pPr/w:spacing.
 */
function extractSpacing(pNode: XmlNode): { before?: number; after?: number } | undefined {
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
    after: after !== undefined ? parseInt(after, 10) : undefined,
    before: before !== undefined ? parseInt(before, 10) : undefined,
  };
}

/**
 * Extract bookmark names from w:bookmarkStart elements.
 * Filters out hidden bookmarks (names starting with `_`).
 */
function extractBookmarks(pNode: XmlNode): string[] {
  const pChildren = pNode["w:p"] as XmlNode[];
  const names: string[] = [];
  for (const child of pChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:bookmarkStart") {
      const name = attrVal(child, "@_w:name");
      if (typeof name === "string" && !name.startsWith("_")) {
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * Check if paragraph contains a page break.
 */
function hasPageBreak(pNode: XmlNode): boolean {
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

/**
 * Check if paragraph is ONLY a page break (no other content).
 */
function isPageBreakOnly(pNode: XmlNode): boolean {
  const pChildren = pNode["w:p"] as XmlNode[];
  let hasPageBr = false;
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
            hasPageBr = true;
          }
        }
        if (rk === "w:t") {
          const kids = rc["w:t"] as XmlNode[];
          for (const c of kids ?? []) {
            const t = c?.["#text"];
            if (typeof t === "string" && t.trim()) hasText = true;
          }
        }
      }
    }
  }

  return hasPageBr && !hasText;
}

/**
 * Extract hyperlink content.
 */
function extractHyperlink(
  hlNode: XmlNode,
  rels?: Map<string, string>
): ExtractedHyperlink {
  // Check for internal cross-reference (has w:anchor attribute)
  const anchor = attrVal(hlNode, "@_w:anchor");
  
  // External hyperlink (r:id)
  const rId = attrVal(hlNode, "@_r:id");
  const url = rId && rels ? rels.get(rId) : undefined;

  // Collect runs within the hyperlink
  const linkChildren = hlNode["w:hyperlink"] as XmlNode[];
  const runs: ExtractedRun[] = [];

  for (const n of linkChildren ?? []) {
    const k = getOnlyKey(n);
    if (k === "w:r") {
      const elements = extractRunElements(n, rels);
      for (const el of elements) {
        if (isTextRun(el)) {
          runs.push(el);
        }
      }
    }
  }

  return {
    type: "hyperlink",
    url: url || undefined,
    anchor: anchor || undefined,
    runs,
  };
}

/**
 * Extract all content from a paragraph.
 */
function extractParagraphContent(
  pNode: XmlNode,
  rels?: Map<string, string>
): ExtractedParagraphContent[] {
  const pChildren = pNode["w:p"] as XmlNode[];
  const content: ExtractedParagraphContent[] = [];

  for (const child of pChildren ?? []) {
    const key = getOnlyKey(child);
    if (!key) continue;

    // Regular run
    if (key === "w:r") {
      const elements = extractRunElements(child, rels);
      content.push(...elements);
      continue;
    }

    // Hyperlink
    if (key === "w:hyperlink") {
      const hyperlink = extractHyperlink(child, rels);
      content.push(hyperlink);
      continue;
    }

    // Skip paragraph properties, bookmarks, etc.
    // These are handled separately
  }

  return content;
}

/**
 * Extract a paragraph from DOCX XML.
 * Returns raw data without LDOC syntax.
 */
export function extractParagraph(
  pNode: XmlNode,
  styles: ParagraphStyleMap,
  rels?: Map<string, string>
): ExtractedParagraph {
  const spacing = extractSpacing(pNode);

  return {
    type: "paragraph",
    content: extractParagraphContent(pNode, rels),
    styleId: extractStyleId(pNode),
    numbering: extractNumbering(pNode),
    alignment: extractAlignment(pNode),
    indentLeftTwips: extractIndentLeftTwips(pNode, styles),
    spacingBefore: spacing?.before,
    spacingAfter: spacing?.after,
    bookmarks: extractBookmarks(pNode),
    hasPageBreak: hasPageBreak(pNode),
    isPageBreakOnly: isPageBreakOnly(pNode),
  };
}
