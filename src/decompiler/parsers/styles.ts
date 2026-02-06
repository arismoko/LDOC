import { xmlParser, findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import { TWIPS_PER_LINE_UNIT, halfPointsToPt } from "../../shared/units";

export interface DocumentDefaults {
  font?: string;
  sizePt?: number;
}

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
