import { xmlParser, findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import { TWIPS_PER_LINE_UNIT, halfPointsToPt } from "../../shared/units";
import { wordStyleToLdoc } from "../../shared/style-names";
import type { CoreTextStyle } from "../../shared/style-types";

export interface RunStyle extends CoreTextStyle {
  bold: boolean;
  italic: boolean;
  code?: boolean;
}

export interface DocumentDefaults {
  font?: string;
  sizePt?: number;
}

export type HeadingStyleInfo = {
  align?: "center" | "right" | "justify";
  bold?: boolean;
  italic?: boolean;
  font?: string;
  sizePt?: number;
};

export type HeadingStyles = {
  heading1?: HeadingStyleInfo;
  heading2?: HeadingStyleInfo;
  heading3?: HeadingStyleInfo;
  heading4?: HeadingStyleInfo;
  heading5?: HeadingStyleInfo;
  heading6?: HeadingStyleInfo;
};

export type ParagraphStyleInfo = {
  basedOn?: string;
  indentLeftTwips?: number;
};

export type ParagraphStyleMap = Map<string, ParagraphStyleInfo>;

export function parseSpacingFromStylesXml(
  stylesXml: string | undefined,
): { lineMultiplier?: number; beforeTwip?: number; afterTwip?: number; align?: "left" | "center" | "right" | "justify" } | undefined {
  if (!stylesXml) return undefined;

  const tree = xmlParser.parse(stylesXml) as XmlNode[];
  const styles = findFirst(tree, "w:styles");
  if (!styles) return undefined;

  const stylesChildren = styles["w:styles"] as XmlNode[];
  const docDefaults = findFirst(stylesChildren, "w:docDefaults");
  if (!docDefaults) return undefined;

  const docDefaultsChildren = docDefaults["w:docDefaults"] as XmlNode[];
  const pPrDefault = findFirst(docDefaultsChildren, "w:pPrDefault");
  if (!pPrDefault) return undefined;

  const pPrDefaultChildren = pPrDefault["w:pPrDefault"] as XmlNode[];
  const pPr = findFirst(pPrDefaultChildren, "w:pPr");
  if (!pPr) return undefined;

  const pPrChildren = pPr["w:pPr"] as XmlNode[];
  const spacing = findFirst(pPrChildren, "w:spacing");
  
  const lineVal = spacing ? attrVal(spacing, "@_w:line") : undefined;
  const lineRule = spacing ? attrVal(spacing, "@_w:lineRule") : undefined;
  const beforeVal = spacing ? attrVal(spacing, "@_w:before") : undefined;
  const afterVal = spacing ? attrVal(spacing, "@_w:after") : undefined;

  const beforeTwip = beforeVal !== undefined ? parseInt(beforeVal, 10) : undefined;
  const afterTwip = afterVal !== undefined ? parseInt(afterVal, 10) : undefined;
  const base: { lineMultiplier?: number; beforeTwip?: number; afterTwip?: number; align?: "left" | "center" | "right" | "justify" } = {};
  if (Number.isFinite(beforeTwip as any)) base.beforeTwip = beforeTwip;
  if (Number.isFinite(afterTwip as any)) base.afterTwip = afterTwip;

  // Check for default alignment (w:jc)
  const jc = findFirst(pPrChildren, "w:jc");
  const jcVal = attrVal(jc, "@_w:val");
  if (jcVal === "both") {
    base.align = "justify";
  } else if (jcVal === "center" || jcVal === "right" || jcVal === "left") {
    base.align = jcVal;
  }

  if (lineVal && lineRule === "auto") {
    const line = parseInt(lineVal, 10);
    // In auto mode, line is in 1/240ths of a line (TWIPS_PER_LINE_UNIT = single space)
    const multiplier = line / TWIPS_PER_LINE_UNIT;
    // Check for common multipliers
    if (Math.abs(multiplier - 1.0) < 0.05) return { ...base, lineMultiplier: 1.0 };
    if (Math.abs(multiplier - 1.15) < 0.05) return { ...base, lineMultiplier: 1.15 };
    if (Math.abs(multiplier - 1.5) < 0.05) return { ...base, lineMultiplier: 1.5 };
    if (Math.abs(multiplier - 2.0) < 0.05) return { ...base, lineMultiplier: 2.0 };
    // Not a standard multiplier, don't emit
  }

  return Object.keys(base).length > 0 ? base : undefined;
}

/**
 * Extract font and size defaults from styles.xml.
 * Looks in w:docDefaults -> w:rPrDefault -> w:rPr first,
 * then falls back to the Normal style if not found.
 */
export function parseDocumentDefaults(stylesXml: string | undefined): DocumentDefaults {
  if (!stylesXml) return {};

  const tree = xmlParser.parse(stylesXml) as XmlNode[];
  const styles = findFirst(tree, "w:styles");
  if (!styles) return {};

  const stylesChildren = styles["w:styles"] as XmlNode[];

  // Helper to extract font and size from an rPr node
  function extractFromRPr(rPr: XmlNode | undefined): DocumentDefaults {
    if (!rPr) return {};
    const rPrChildren = rPr["w:rPr"] as XmlNode[];
    if (!rPrChildren) return {};

    let font: string | undefined;
    let sizePt: number | undefined;

    // Look for w:rFonts - prefer w:ascii, fallback to w:hAnsi
    const rFonts = findFirst(rPrChildren, "w:rFonts");
    if (rFonts) {
      font = attrVal(rFonts, "@_w:ascii") || attrVal(rFonts, "@_w:hAnsi");
    }

    // Look for w:sz - value is in half-points, divide by 2 for points
    const sz = findFirst(rPrChildren, "w:sz");
    if (sz) {
      const szVal = attrVal(sz, "@_w:val");
      if (szVal) {
        const halfPoints = parseInt(szVal, 10);
        if (Number.isFinite(halfPoints)) {
          sizePt = halfPointsToPt(halfPoints);
        }
      }
    }

    return { font, sizePt };
  }

  // Try docDefaults -> rPrDefault -> rPr first
  const docDefaults = findFirst(stylesChildren, "w:docDefaults");
  if (docDefaults) {
    const docDefaultsChildren = docDefaults["w:docDefaults"] as XmlNode[];
    const rPrDefault = findFirst(docDefaultsChildren, "w:rPrDefault");
    if (rPrDefault) {
      const rPrDefaultChildren = rPrDefault["w:rPrDefault"] as XmlNode[];
      const rPr = findFirst(rPrDefaultChildren, "w:rPr");
      const defaults = extractFromRPr(rPr);
      if (defaults.font || defaults.sizePt) {
        return defaults;
      }
    }
  }

  // Fallback: try the Normal style
  for (const child of stylesChildren ?? []) {
    const key = getOnlyKey(child);
    if (key !== "w:style") continue;

    const styleId = attrVal(child, "@_w:styleId");
    if (styleId === "Normal") {
      const styleChildren = child["w:style"] as XmlNode[];
      const rPr = findFirst(styleChildren, "w:rPr");
      return extractFromRPr(rPr);
    }
  }

  return {};
}

export function parseParagraphStyles(stylesXml: string | undefined): ParagraphStyleMap {
  const map: ParagraphStyleMap = new Map();
  if (!stylesXml) return map;

  const tree = xmlParser.parse(stylesXml) as XmlNode[];
  const styles = findFirst(tree, "w:styles");
  if (!styles) return map;

  const stylesChildren = styles["w:styles"] as XmlNode[];
  for (const child of stylesChildren ?? []) {
    const key = getOnlyKey(child);
    if (key !== "w:style") continue;

    const styleId = attrVal(child, "@_w:styleId");
    if (!styleId) continue;

    const styleChildren = child["w:style"] as XmlNode[];
    const basedOnNode = findFirst(styleChildren, "w:basedOn");
    const basedOn = attrVal(basedOnNode, "@_w:val");

    let indentLeftTwips: number | undefined;
    const pPr = findFirst(styleChildren, "w:pPr");
    if (pPr) {
      const pPrChildren = pPr["w:pPr"] as XmlNode[];
      const ind = findFirst(pPrChildren, "w:ind");
      const left = attrVal(ind, "@_w:left");
      if (left !== undefined) {
        const n = parseInt(left, 10);
        if (Number.isFinite(n)) indentLeftTwips = n;
      }
    }

    map.set(styleId, { basedOn: basedOn || undefined, indentLeftTwips });
  }

  return map;
}

export function resolveStyleIndentLeftTwips(styleId: string | undefined, styles: ParagraphStyleMap): number | undefined {
  if (!styleId) return undefined;
  const seen = new Set<string>();
  let cur: string | undefined = styleId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const info = styles.get(cur);
    if (!info) break;
    if (info.indentLeftTwips !== undefined) return info.indentLeftTwips;
    cur = info.basedOn;
  }
  return undefined;
}

// ============================================================================
// Full Style Extraction System
// ============================================================================

export interface FullStyleInfo {
  styleId: string;
  name?: string;
  type: "paragraph" | "character";
  basedOn?: string;

  // Paragraph properties (pPr)
  align?: "left" | "center" | "right" | "justify";
  indentLeftTwips?: number;
  indentFirstTwips?: number;
  spaceBeforeTwips?: number;
  spaceAfterTwips?: number;
  keepWithNext?: boolean;

  // Run properties (rPr)
  font?: string;
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  color?: string;
  caps?: boolean;
  smallCaps?: boolean;
  strike?: boolean;
}

export type StyleMap = Map<string, FullStyleInfo>;

/**
 * Parse all styles from styles.xml into a map.
 */
export function parseAllStyles(stylesXml: string | undefined): StyleMap {
  const map: StyleMap = new Map();
  if (!stylesXml) return map;

  const tree = xmlParser.parse(stylesXml) as XmlNode[];
  const styles = findFirst(tree, "w:styles");
  if (!styles) return map;

  const stylesChildren = styles["w:styles"] as XmlNode[];
  for (const child of stylesChildren ?? []) {
    const key = getOnlyKey(child);
    if (key !== "w:style") continue;

    const styleId = attrVal(child, "@_w:styleId");
    if (!styleId) continue;

    const styleType = attrVal(child, "@_w:type") as "paragraph" | "character" | undefined;
    if (!styleType || (styleType !== "paragraph" && styleType !== "character")) continue;

    const styleChildren = child["w:style"] as XmlNode[];

    // Get name
    const nameNode = findFirst(styleChildren, "w:name");
    const name = attrVal(nameNode, "@_w:val");

    // Get basedOn
    const basedOnNode = findFirst(styleChildren, "w:basedOn");
    const basedOn = attrVal(basedOnNode, "@_w:val");

    const info: FullStyleInfo = {
      styleId,
      name,
      type: styleType,
      basedOn: basedOn || undefined,
    };

    // Parse paragraph properties (pPr)
    const pPr = findFirst(styleChildren, "w:pPr");
    if (pPr) {
      const pPrChildren = pPr["w:pPr"] as XmlNode[];

      // Alignment (jc)
      const jc = findFirst(pPrChildren, "w:jc");
      const jcVal = attrVal(jc, "@_w:val");
      if (jcVal === "center" || jcVal === "right" || jcVal === "both" || jcVal === "left") {
        info.align = jcVal === "both" ? "justify" : jcVal;
      }

      // Indent
      const ind = findFirst(pPrChildren, "w:ind");
      const indLeft = attrVal(ind, "@_w:left");
      if (indLeft) {
        const n = parseInt(indLeft, 10);
        if (Number.isFinite(n)) info.indentLeftTwips = n;
      }
      const indFirstLine = attrVal(ind, "@_w:firstLine");
      if (indFirstLine) {
        const n = parseInt(indFirstLine, 10);
        if (Number.isFinite(n)) info.indentFirstTwips = n;
      }

      // Spacing
      const spacing = findFirst(pPrChildren, "w:spacing");
      const spaceBefore = attrVal(spacing, "@_w:before");
      if (spaceBefore) {
        const n = parseInt(spaceBefore, 10);
        if (Number.isFinite(n)) info.spaceBeforeTwips = n;
      }
      const spaceAfter = attrVal(spacing, "@_w:after");
      if (spaceAfter) {
        const n = parseInt(spaceAfter, 10);
        if (Number.isFinite(n)) info.spaceAfterTwips = n;
      }

      // keepNext
      const keepNext = findFirst(pPrChildren, "w:keepNext");
      if (keepNext) info.keepWithNext = true;
    }

    // Parse run properties (rPr)
    const rPr = findFirst(styleChildren, "w:rPr");
    if (rPr) {
      const rPrChildren = rPr["w:rPr"] as XmlNode[];

      // Font
      const rFonts = findFirst(rPrChildren, "w:rFonts");
      const ascii = attrVal(rFonts, "@_w:ascii") || attrVal(rFonts, "@_w:hAnsi");
      if (ascii) info.font = ascii;

      // Size (half-points to points)
      const sz = findFirst(rPrChildren, "w:sz");
      const szVal = attrVal(sz, "@_w:val");
      if (szVal) {
        const halfPoints = parseInt(szVal, 10);
        if (Number.isFinite(halfPoints)) info.sizePt = halfPointsToPt(halfPoints);
      }

      // Bold
      const bNode = findFirst(rPrChildren, "w:b");
      if (bNode) {
        const bVal = attrVal(bNode, "@_w:val");
        info.bold = bVal !== "0" && bVal !== "false";
      }

      // Italic
      const iNode = findFirst(rPrChildren, "w:i");
      if (iNode) {
        const iVal = attrVal(iNode, "@_w:val");
        info.italic = iVal !== "0" && iVal !== "false";
      }

      // Strike
      const strikeNode = findFirst(rPrChildren, "w:strike");
      if (strikeNode) {
        const strikeVal = attrVal(strikeNode, "@_w:val");
        info.strike = strikeVal !== "0" && strikeVal !== "false";
      }

      // Color
      const colorNode = findFirst(rPrChildren, "w:color");
      const colorVal = attrVal(colorNode, "@_w:val");
      if (colorVal && colorVal !== "auto") {
        info.color = colorVal.toUpperCase();
      }

      // Underline
      const uNode = findFirst(rPrChildren, "w:u");
      const uVal = attrVal(uNode, "@_w:val");
      if (uVal && uVal !== "none") info.underline = uVal;

      // Caps
      const capsNode = findFirst(rPrChildren, "w:caps");
      if (capsNode) {
        const capsVal = attrVal(capsNode, "@_w:val");
        info.caps = capsVal !== "0" && capsVal !== "false";
      }

      // SmallCaps
      const smallCapsNode = findFirst(rPrChildren, "w:smallCaps");
      if (smallCapsNode) {
        const smallCapsVal = attrVal(smallCapsNode, "@_w:val");
        info.smallCaps = smallCapsVal !== "0" && smallCapsVal !== "false";
      }
    }

    map.set(styleId, info);
  }

  return map;
}

/**
 * Resolve basedOn chain and return flattened style with all inherited properties.
 */
export function resolveStyle(styleId: string, styles: StyleMap): FullStyleInfo | undefined {
  const chain: FullStyleInfo[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = styleId;

  // Build inheritance chain
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const info = styles.get(cur);
    if (!info) break;
    chain.push(info);
    cur = info.basedOn;
  }

  if (chain.length === 0) return undefined;

  // Merge from base to derived (later overrides earlier)
  const resolved: FullStyleInfo = {
    styleId,
    type: chain[0]!.type,
    name: chain[0]!.name,
  };

  // Reverse so we process base first
  for (const info of chain.reverse()) {
    if (info.align) resolved.align = info.align;
    if (info.indentLeftTwips !== undefined) resolved.indentLeftTwips = info.indentLeftTwips;
    if (info.indentFirstTwips !== undefined) resolved.indentFirstTwips = info.indentFirstTwips;
    if (info.spaceBeforeTwips !== undefined) resolved.spaceBeforeTwips = info.spaceBeforeTwips;
    if (info.spaceAfterTwips !== undefined) resolved.spaceAfterTwips = info.spaceAfterTwips;
    if (info.keepWithNext !== undefined) resolved.keepWithNext = info.keepWithNext;
    if (info.font) resolved.font = info.font;
    if (info.sizePt !== undefined) resolved.sizePt = info.sizePt;
    if (info.bold !== undefined) resolved.bold = info.bold;
    if (info.italic !== undefined) resolved.italic = info.italic;
    if (info.underline) resolved.underline = info.underline;
    if (info.color) resolved.color = info.color;
    if (info.caps !== undefined) resolved.caps = info.caps;
    if (info.smallCaps !== undefined) resolved.smallCaps = info.smallCaps;
    if (info.strike !== undefined) resolved.strike = info.strike;
  }

  return resolved;
}

/**
 * Collect styleIds actually used in the document body.
 */
export function collectUsedStyles(bodyChildren: XmlNode[]): Set<string> {
  const used = new Set<string>();

  function walk(nodes: XmlNode[]) {
    for (const node of nodes ?? []) {
      const key = getOnlyKey(node);
      if (!key) continue;

      // Check paragraph style
      if (key === "w:p") {
        const pChildren = node["w:p"] as XmlNode[];
        const pPr = findFirst(pChildren, "w:pPr");
        if (pPr) {
          const pPrChildren = pPr["w:pPr"] as XmlNode[];
          const pStyle = findFirst(pPrChildren, "w:pStyle");
          const styleId = attrVal(pStyle, "@_w:val");
          if (styleId) used.add(styleId);
        }
        // Recurse into paragraph
        if (pChildren) walk(pChildren);
      }

      // Check run style
      if (key === "w:r") {
        const rChildren = node["w:r"] as XmlNode[];
        const rPr = findFirst(rChildren, "w:rPr");
        if (rPr) {
          const rPrChildren = rPr["w:rPr"] as XmlNode[];
          const rStyle = findFirst(rPrChildren, "w:rStyle");
          const styleId = attrVal(rStyle, "@_w:val");
          if (styleId) used.add(styleId);
        }
      }

      // Recurse into other elements
      const children = node[key];
      if (Array.isArray(children)) walk(children);
    }
  }

  walk(bodyChildren);
  return used;
}

/**
 * Extract used styles, flattened (inheritance resolved).
 * Only returns styles that are actually referenced in the document.
 */
export function extractUsedStyles(
  stylesXml: string | undefined,
  bodyChildren: XmlNode[]
): StyleMap {
  const allStyles = parseAllStyles(stylesXml);
  const usedIds = collectUsedStyles(bodyChildren);
  const result: StyleMap = new Map();

  for (const styleId of usedIds) {
    const resolved = resolveStyle(styleId, allStyles);
    if (resolved) {
      result.set(styleId, resolved);
    }
  }

  // Always include Normal if it exists (even if not explicitly referenced)
  if (!result.has("Normal") && allStyles.has("Normal")) {
    const resolved = resolveStyle("Normal", allStyles);
    if (resolved) result.set("Normal", resolved);
  }

  return result;
}

/**
 * Map Word styleId to LDOC key name.
 * Re-exports from shared module for backward compatibility.
 */
export function styleIdToLdocKey(styleId: string): string {
  return wordStyleToLdoc(styleId);
}

/**
 * Generate LDOC style block lines for a style.
 * Only emits non-default values.
 */
export function styleToLdocLines(
  ldocKey: string,
  style: FullStyleInfo,
  bodyDefaults?: { font?: string; sizePt?: number }
): string[] {
  const lines: string[] = [];
  lines.push(`    ${ldocKey}:`);

  // Don't emit properties that match body defaults (to keep output clean)
  const isBody = ldocKey === "body";
  const defaultFont = bodyDefaults?.font;
  const defaultSize = bodyDefaults?.sizePt;

  if (style.font && (isBody || style.font !== defaultFont)) {
    lines.push(`      font: ${style.font}`);
  }
  if (style.sizePt !== undefined && (isBody || style.sizePt !== defaultSize)) {
    lines.push(`      size: ${style.sizePt}pt`);
  }
  if (style.bold) {
    lines.push(`      bold: true`);
  }
  if (style.italic) {
    lines.push(`      italic: true`);
  }
  if (style.align && style.align !== "left") {
    lines.push(`      align: ${style.align}`);
  }
  if (style.color) {
    lines.push(`      color: #${style.color}`);
  }

  // Only emit style block if it has properties beyond the key
  return lines.length > 1 ? lines : [];
}
