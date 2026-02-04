import { findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import { type NumberingInfo, listPrefix } from "../parsers/numbering";
import { type ParagraphStyleMap, resolveStyleIndentLeftTwips } from "../parsers/styles";
import { type TextSegment, parseRunStyle, collectTextFromNodes, normalizeWs, wrapEmphasis } from "./run";

export type DecompilerOptions = {
  /**
   * Control emission of @indent/@outdent directives.
   * - 'on': Always emit indent directives when indentation is detected
   * - 'off': Never emit indent directives (simpler output)
   * - 'auto': Same as 'on' (default behavior)
   */
  emitIndent?: 'on' | 'off' | 'auto' | boolean;
};

export type ParagraphInfo = {
  line: string;
  alignment?: string; // "center" | "right" | undefined
  indentLeftTwips?: number;
  isHeading: boolean;
  isList: boolean;
  isEmpty: boolean;
};

function isTocStyle(styleId: string | undefined): boolean {
  if (!styleId) return false;
  // Match TOC1..TOC9 (case-insensitive)
  return /^toc[1-9]$/i.test(styleId);
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

function paragraphSegments(pNode: XmlNode): TextSegment[] {
  const pChildren = pNode["w:p"] as XmlNode[];
  const segments: TextSegment[] = [];

  for (const child of pChildren ?? []) {
    const key = getOnlyKey(child);
    if (!key) continue;

    if (key === "w:r") {
      const style = parseRunStyle(child);
      const runChildren = child["w:r"] as XmlNode[];
      collectTextFromNodes(runChildren, segments, style);
      continue;
    }

    if (key === "w:hyperlink") {
      // Treat hyperlink like a container; collect its runs.
      const linkChildren = child["w:hyperlink"] as XmlNode[];
      for (const n of linkChildren ?? []) {
        const k = getOnlyKey(n);
        if (k === "w:r") {
          const style = parseRunStyle(n);
          const runChildren = n["w:r"] as XmlNode[];
          collectTextFromNodes(runChildren, segments, style);
        }
      }
      continue;
    }
  }

  // Merge adjacent segments with same style
  const merged: TextSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.style.bold === seg.style.bold && last.style.italic === seg.style.italic) {
      last.text += seg.text;
    } else {
      merged.push({ style: seg.style, text: seg.text });
    }
  }
  return merged;
}

export function paragraphText(pNode: XmlNode, preserveTabs = false): string {
  const segments = paragraphSegments(pNode);
  return normalizeWs(segments.map((s) => wrapEmphasis(s.text, s.style)).join(""), preserveTabs);
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

export function paragraphToLdoc(pNode: XmlNode, numInfo: NumberingInfo, styles: ParagraphStyleMap, options?: DecompilerOptions): ParagraphInfo {
  // Check for page break only paragraph
  if (isPageBreakParagraph(pNode)) {
    return { line: "@pagebreak", isHeading: false, isList: false, isEmpty: false };
  }

  const styleId = paragraphStyleId(pNode);
  const alignment = paragraphAlignment(pNode);
  const indentLeftTwips = paragraphIndentLeftTwips(pNode, styles);
  
  // Check for TOC styles - don't emit list markers for TOC paragraphs
  const isToc = isTocStyle(styleId);
  
  // For TOC paragraphs, preserve tabs for readable title+page format
  const text = paragraphText(pNode, isToc);
  const isEmpty = !text.trim();

  // Check for heading style first
  if (styleId) {
    const m = styleId.match(/^Heading([1-6])$/i);
    if (m) {
      const level = parseInt(m[1]!, 10);
      const hashes = "#".repeat(Math.max(1, Math.min(6, level)));
      return {
        line: `${hashes} ${text}`.trimEnd(),
        indentLeftTwips,
        isHeading: true,
        isList: false,
        isEmpty,
      };
    }
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
    };
  }

  const num = paragraphNumbering(pNode);
  if (num) {
    const { prefix } = listPrefix(numInfo, num.numId, num.ilvl);
    // Lists with alignment get inline alignment prefix
    const alignPrefix = alignment === "center" ? "@center " : alignment === "right" ? "@right " : "";
    return {
      line: `${alignPrefix}${prefix}${text}`.trimEnd(),
      // Avoid emitting @indent for list items; numbering carries indentation.
      indentLeftTwips: 0,
      isHeading: false,
      isList: true,
      isEmpty,
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
  };
}
