import { xmlParser, findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import { halfPointsToPt } from "../../shared/units";
import { wordStyleToLdoc } from "../../shared/style-names";

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
