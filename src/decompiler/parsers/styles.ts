import { xmlParser, findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";

export type RunStyle = {
  bold: boolean;
  italic: boolean;
  strike?: boolean;
  code?: boolean;
};

export type ParagraphStyleInfo = {
  basedOn?: string;
  indentLeftTwips?: number;
};

export type ParagraphStyleMap = Map<string, ParagraphStyleInfo>;

export function parseSpacingFromStylesXml(stylesXml: string | undefined): { lineMultiplier?: number } | undefined {
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
  if (!spacing) return undefined;

  const lineVal = attrVal(spacing, "@_w:line");
  const lineRule = attrVal(spacing, "@_w:lineRule");

  if (lineVal && lineRule === "auto") {
    const line = parseInt(lineVal, 10);
    // In auto mode, line is in 1/240ths of a line (240 = single space)
    const multiplier = line / 240;
    // Check for common multipliers
    if (Math.abs(multiplier - 1.0) < 0.05) return { lineMultiplier: 1.0 };
    if (Math.abs(multiplier - 1.15) < 0.05) return { lineMultiplier: 1.15 };
    if (Math.abs(multiplier - 1.5) < 0.05) return { lineMultiplier: 1.5 };
    if (Math.abs(multiplier - 2.0) < 0.05) return { lineMultiplier: 2.0 };
    // Not a standard multiplier, don't emit
  }

  return undefined;
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
