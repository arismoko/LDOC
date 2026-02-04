import { xmlParser, findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";

export type NumberingLevel = {
  numFmt?: string;
};

export type NumberingInfo = {
  // numId -> abstractNumId
  numToAbstract: Map<string, string>;
  // abstractNumId -> ilvl -> level info
  abstractLevels: Map<string, Map<number, NumberingLevel>>;
};

export function parseNumbering(numberingXml: string | undefined): NumberingInfo {
  const info: NumberingInfo = {
    numToAbstract: new Map(),
    abstractLevels: new Map(),
  };

  if (!numberingXml) return info;
  const tree = xmlParser.parse(numberingXml) as XmlNode[];
  const numbering = findFirst(tree, "w:numbering");
  if (!numbering) return info;
  const children = numbering["w:numbering"] as XmlNode[];

  for (const c of children ?? []) {
    const key = getOnlyKey(c);
    if (key === "w:num") {
      const numId = attrVal(c, "@_w:numId");
      const numChildren = c["w:num"] as XmlNode[];
      const abs = findFirst(numChildren, "w:abstractNumId");
      const absId = attrVal(abs, "@_w:val");
      if (numId && absId) info.numToAbstract.set(numId, absId);
    }

    if (key === "w:abstractNum") {
      const absId = attrVal(c, "@_w:abstractNumId");
      if (!absId) continue;
      const levelMap = new Map<number, NumberingLevel>();
      const absChildren = c["w:abstractNum"] as XmlNode[];
      for (const lvlNode of absChildren ?? []) {
        const k = getOnlyKey(lvlNode);
        if (k !== "w:lvl") continue;
        const ilvlRaw = attrVal(lvlNode, "@_w:ilvl");
        const ilvl = ilvlRaw ? parseInt(ilvlRaw, 10) : 0;
        const lvlChildren = lvlNode["w:lvl"] as XmlNode[];
        const numFmtNode = findFirst(lvlChildren, "w:numFmt");
        const numFmt = attrVal(numFmtNode, "@_w:val");
        levelMap.set(Number.isFinite(ilvl) ? ilvl : 0, { numFmt });
      }
      info.abstractLevels.set(absId, levelMap);
    }
  }

  return info;
}

export function listPrefix(numInfo: NumberingInfo, numId: string, ilvl: number): { prefix: string; isList: boolean } {
  const absId = numInfo.numToAbstract.get(numId);
  const levels = absId ? numInfo.abstractLevels.get(absId) : undefined;
  const fmt = levels?.get(ilvl)?.numFmt;
  const depth = Math.max(0, ilvl) + 1;
  const at = "@".repeat(depth);
  if (!fmt) {
    // Unknown: treat as numbered list
    return { prefix: `${at} `, isList: true };
  }
  if (fmt === "bullet") return { prefix: `${at}- `, isList: true };
  return { prefix: `${at} `, isList: true };
}
