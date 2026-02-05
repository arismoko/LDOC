/**
 * Run Extraction
 *
 * Extracts text runs from DOCX XML without generating LDOC syntax.
 * Hard breaks and tabs are represented as boolean flags, not as text.
 */

import { findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import { halfPointsToPt } from "../../shared/units";
import { isHighlightColor, type HighlightColor } from "../../shared/highlight";
import type {
  ExtractedRun,
  ExtractedRunStyle,
  ExtractedRunElement,
  ExtractedImage,
  ExtractedFootnoteRef,
} from "./types";

// Monospace fonts that indicate code formatting
const MONOSPACE_FONTS = new Set([
  "courier",
  "courier new",
  "consolas",
  "monaco",
  "menlo",
  "lucida console",
  "dejavu sans mono",
  "liberation mono",
  "source code pro",
  "fira code",
  "jetbrains mono",
]);

function isMonospaceFont(fontName: string | undefined): boolean {
  if (!fontName) return false;
  return MONOSPACE_FONTS.has(fontName.toLowerCase());
}

/**
 * Word's boolean attributes can be:
 * - absent (false)
 * - present with no value (true)
 * - present with "0", "false", "off" (false)
 * - present with "1", "true", "on", or any other value (true)
 */
function truthyWordBool(val: string | undefined): boolean {
  if (val === undefined) return true; // Present with no value means true
  const lower = val.toLowerCase();
  return lower !== "0" && lower !== "false" && lower !== "off";
}

/**
 * Parse run style properties from w:rPr.
 */
export function parseRunStyle(runNode: XmlNode): ExtractedRunStyle {
  const runChildren = runNode["w:r"] as XmlNode[];
  const rPr = findFirst(runChildren, "w:rPr");
  if (!rPr) return { bold: false, italic: false };

  const rPrChildren = rPr["w:rPr"] as XmlNode[];

  // Basic formatting
  const bNode = findFirst(rPrChildren, "w:b");
  const iNode = findFirst(rPrChildren, "w:i");
  const strikeNode = findFirst(rPrChildren, "w:strike");
  const dstrikeNode = findFirst(rPrChildren, "w:dstrike");
  const uNode = findFirst(rPrChildren, "w:u");
  const capsNode = findFirst(rPrChildren, "w:caps");
  const smallCapsNode = findFirst(rPrChildren, "w:smallCaps");
  const vertAlignNode = findFirst(rPrChildren, "w:vertAlign");

  const bold = bNode ? truthyWordBool(attrVal(bNode, "@_w:val")) : false;
  const italic = iNode ? truthyWordBool(attrVal(iNode, "@_w:val")) : false;
  const strike = strikeNode ? truthyWordBool(attrVal(strikeNode, "@_w:val")) : false;
  const doubleStrike = dstrikeNode ? truthyWordBool(attrVal(dstrikeNode, "@_w:val")) : false;
  const underline = uNode ? truthyWordBool(attrVal(uNode, "@_w:val")) : false;
  const allCaps = capsNode ? truthyWordBool(attrVal(capsNode, "@_w:val")) : false;
  const smallCaps = smallCapsNode ? truthyWordBool(attrVal(smallCapsNode, "@_w:val")) : false;

  // Vertical alignment (subscript/superscript)
  const vertAlignVal = attrVal(vertAlignNode, "@_w:val");
  const subscript = vertAlignVal === "subscript";
  const superscript = vertAlignVal === "superscript";

  // Font detection
  const rFonts = findFirst(rPrChildren, "w:rFonts");
  const asciiFont = attrVal(rFonts, "@_w:ascii");
  const hAnsiFont = attrVal(rFonts, "@_w:hAnsi");
  const csFont = attrVal(rFonts, "@_w:cs");
  const code = isMonospaceFont(asciiFont) || isMonospaceFont(hAnsiFont) || isMonospaceFont(csFont);
  const font = asciiFont || hAnsiFont || csFont || undefined;

  // Size (in half-points, convert to points)
  const szNode = findFirst(rPrChildren, "w:sz");
  const szVal = attrVal(szNode, "@_w:val");
  const sizePt = szVal ? halfPointsToPt(parseInt(szVal, 10)) : undefined;

  // Color
  const colorNode = findFirst(rPrChildren, "w:color");
  const colorVal = attrVal(colorNode, "@_w:val");
  const color = colorVal && colorVal.toLowerCase() !== "auto"
    ? colorVal.toUpperCase()
    : undefined;

  // Highlight
  const highlightNode = findFirst(rPrChildren, "w:highlight");
  const highlightVal = attrVal(highlightNode, "@_w:val");
  const highlight = highlightVal && isHighlightColor(highlightVal)
    ? highlightVal as HighlightColor
    : undefined;

  // Shading fill
  const shdNode = findFirst(rPrChildren, "w:shd");
  const fillVal = attrVal(shdNode, "@_w:fill");
  const shadingFill = fillVal && fillVal.toLowerCase() !== "auto"
    ? fillVal.toUpperCase()
    : undefined;

  // Character spacing (can be negative!)
  const spacingNode = findFirst(rPrChildren, "w:spacing");
  const spacingVal = attrVal(spacingNode, "@_w:val");
  const characterSpacing = spacingVal ? parseInt(spacingVal, 10) : undefined;

  return {
    bold,
    italic,
    strike: strike || undefined,
    doubleStrike: doubleStrike || undefined,
    underline: underline || undefined,
    allCaps: allCaps || undefined,
    smallCaps: smallCaps || undefined,
    subscript: subscript || undefined,
    superscript: superscript || undefined,
    code: code || undefined,
    font,
    sizePt: Number.isFinite(sizePt) ? sizePt : undefined,
    color,
    highlight,
    shadingFill,
    characterSpacing: Number.isFinite(characterSpacing) ? characterSpacing : undefined,
  };
}

/**
 * Normalize whitespace in extracted text.
 * - Collapse multiple spaces to single space
 * - Convert \r\n to \n
 * - Preserve tabs as \t
 *
 * Note: This is the ONLY place whitespace normalization happens in extraction.
 */
function normalizeRunText(text: string): string {
  let result = text.replace(/\r\n/g, "\n");
  result = result.replace(/[\v\f]+/g, " ");
  result = result.replace(/ +/g, " ");
  return result;
}

/**
 * Extract text content from a w:t node.
 */
function extractTextFromWt(wtNode: XmlNode): string {
  const kids = wtNode["w:t"] as XmlNode[];
  let text = "";
  for (const c of kids ?? []) {
    if (typeof c === "string" || typeof c === "number" || typeof c === "boolean") {
      text += c;
      continue;
    }
    const t = c?.["#text"];
    if (typeof t === "string" || typeof t === "number" || typeof t === "boolean") {
      text += `${t}`;
    }
  }
  return text;
}

/**
 * Extract image information from w:drawing.
 */
function extractImageFromDrawing(
  drawingNode: XmlNode,
  rels: Map<string, string>
): ExtractedImage | null {
  // Navigate through the drawing structure to find the image reference
  // wp:inline or wp:anchor -> a:graphic -> a:graphicData -> pic:pic -> pic:blipFill -> a:blip
  const drawingChildren = drawingNode["w:drawing"] as XmlNode[];

  for (const child of drawingChildren ?? []) {
    const key = getOnlyKey(child);
    if (key !== "wp:inline" && key !== "wp:anchor") continue;

    const inlineChildren = child[key] as XmlNode[];
    const graphic = findFirst(inlineChildren, "a:graphic");
    if (!graphic) continue;

    const graphicChildren = graphic["a:graphic"] as XmlNode[];
    const graphicData = findFirst(graphicChildren, "a:graphicData");
    if (!graphicData) continue;

    const graphicDataChildren = graphicData["a:graphicData"] as XmlNode[];
    const pic = findFirst(graphicDataChildren, "pic:pic");
    if (!pic) continue;

    const picChildren = pic["pic:pic"] as XmlNode[];
    const blipFill = findFirst(picChildren, "pic:blipFill");
    if (!blipFill) continue;

    const blipFillChildren = blipFill["pic:blipFill"] as XmlNode[];
    const blip = findFirst(blipFillChildren, "a:blip");
    if (!blip) continue;

    const rId = attrVal(blip, "@_r:embed");
    if (!rId) continue;

    const target = rels.get(rId);
    if (!target) continue;

    // Extract dimensions from wp:extent if available
    const extent = findFirst(inlineChildren, "wp:extent");
    const cx = attrVal(extent, "@_cx");
    const cy = attrVal(extent, "@_cy");

    // Extract alt text from wp:docPr
    const docPr = findFirst(inlineChildren, "wp:docPr");
    const altText = attrVal(docPr, "@_descr") || attrVal(docPr, "@_title");

    return {
      type: "image",
      rId,
      altText: altText || undefined,
      widthEmu: cx ? parseInt(cx, 10) : undefined,
      heightEmu: cy ? parseInt(cy, 10) : undefined,
    };
  }

  return null;
}

/**
 * Extract runs from a w:r node.
 * Returns an array because a single w:r can contain multiple elements.
 */
export function extractRunElements(
  runNode: XmlNode,
  rels?: Map<string, string>
): ExtractedRunElement[] {
  const style = parseRunStyle(runNode);
  const runChildren = runNode["w:r"] as XmlNode[];
  const elements: ExtractedRunElement[] = [];

  // Track accumulated text and whether next run should have hardBreak flag
  let accumulatedText = "";
  let pendingHardBreak = false;
  let pendingTab = false;

  const flushText = () => {
    if (accumulatedText || pendingTab) {
      const normalizedText = normalizeRunText(accumulatedText);
      elements.push({
        text: normalizedText,
        style: { ...style },
        hardBreak: pendingHardBreak,
        tab: pendingTab,
      });
      accumulatedText = "";
      pendingHardBreak = false;
      pendingTab = false;
    }
  };

  for (const n of runChildren ?? []) {
    const key = getOnlyKey(n);
    if (!key) continue;

    // Text content
    if (key === "w:t") {
      accumulatedText += extractTextFromWt(n);
      continue;
    }

    // Tab - flush current text, mark next as tab
    if (key === "w:tab") {
      flushText();
      pendingTab = true;
      continue;
    }

    // Hard break (line break)
    if (key === "w:br") {
      const brType = attrVal(n, "@_w:type");
      if (brType === "page") {
        // Page breaks handled at paragraph level
        continue;
      }
      // Flush current text with hard break flag
      flushText();
      pendingHardBreak = true;
      continue;
    }

    // Carriage return (also a hard break)
    if (key === "w:cr") {
      flushText();
      pendingHardBreak = true;
      continue;
    }

    // Footnote reference
    if (key === "w:footnoteReference") {
      flushText();
      const fnId = attrVal(n, "@_w:id");
      if (fnId) {
        elements.push({
          type: "footnote",
          id: fnId,
        });
      }
      continue;
    }

    // Image in drawing
    if (key === "w:drawing" && rels) {
      flushText();
      const image = extractImageFromDrawing(n, rels);
      if (image) {
        elements.push(image);
      }
      continue;
    }

    // Legacy VML image (w:pict) - simplified handling
    if (key === "w:pict" && rels) {
      flushText();
      // For now, skip VML images - they're rare and complex
      // TODO: Add VML image extraction if needed
      continue;
    }

    // Skip run properties (already parsed)
    if (key === "w:rPr") continue;

    // Skip field codes and other structural elements
    if (key === "w:fldChar" || key === "w:instrText") continue;
  }

  // Flush any remaining text
  flushText();

  // If we ended with a pending hard break but no text, create an empty run with the flag
  if (pendingHardBreak) {
    elements.push({
      text: "",
      style: { ...style },
      hardBreak: true,
      tab: false,
    });
  }

  return elements;
}

/**
 * Check if a run element is a text run (not image or footnote).
 */
export function isTextRun(element: ExtractedRunElement): element is ExtractedRun {
  return !("type" in element);
}
