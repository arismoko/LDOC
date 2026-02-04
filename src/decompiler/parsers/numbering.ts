import { xmlParser, findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";

export type NumberingLevel = {
  numFmt?: string;
};

export type NumberingInfo = {
  // numId -> abstractNumId
  numToAbstract: Map<string, string>;
  // abstractNumId -> ilvl -> level info
  abstractLevels: Map<string, Map<number, NumberingLevel>>;
  // Runtime counters: numId -> ilvl -> current count
  counters: Map<string, Map<number, number>>;
};

export function parseNumbering(numberingXml: string | undefined): NumberingInfo {
  const info: NumberingInfo = {
    numToAbstract: new Map(),
    abstractLevels: new Map(),
    counters: new Map(),
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

// Format a number according to numFmt
function formatValue(count: number, fmt: string | undefined, ilvl: number): string {
  const effectiveFmt = fmt ?? ["decimal", "lowerLetter", "lowerRoman", "upperLetter"][ilvl % 4] ?? "decimal";
  
  switch (effectiveFmt) {
    case "decimal":
      return String(count);
    case "lowerLetter": {
      // 1->a, 2->b, ..., 26->z, 27->aa, etc.
      let result = "";
      let n = count;
      while (n > 0) {
        n--;
        result = String.fromCharCode(97 + (n % 26)) + result;
        n = Math.floor(n / 26);
      }
      return result || "a";
    }
    case "upperLetter": {
      let result = "";
      let n = count;
      while (n > 0) {
        n--;
        result = String.fromCharCode(65 + (n % 26)) + result;
        n = Math.floor(n / 26);
      }
      return result || "A";
    }
    case "lowerRoman":
      return toRoman(count).toLowerCase();
    case "upperRoman":
      return toRoman(count);
    case "bullet":
      return "-";
    default:
      return String(count);
  }
}

function toRoman(num: number): string {
  const romanNumerals: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let result = "";
  let n = num;
  for (const [value, numeral] of romanNumerals) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }
  return result || "I";
}

export function listPrefix(numInfo: NumberingInfo, numId: string, ilvl: number): { prefix: string; isList: boolean } {
  const absId = numInfo.numToAbstract.get(numId);
  const levels = absId ? numInfo.abstractLevels.get(absId) : undefined;
  const fmt = levels?.get(ilvl)?.numFmt;
  const depth = Math.max(0, ilvl) + 1;
  const at = "@".repeat(depth);
  
  if (fmt === "bullet") return { prefix: `${at}- `, isList: true };
  
  // Get or create counter for this numId
  let numCounters = numInfo.counters.get(numId);
  if (!numCounters) {
    numCounters = new Map();
    numInfo.counters.set(numId, numCounters);
  }
  
  // When moving to a new level, reset deeper levels
  // (This is a simplification - real DOCX has more complex restart rules)
  const currentCount = (numCounters.get(ilvl) ?? 0) + 1;
  numCounters.set(ilvl, currentCount);
  
  // Reset all deeper levels when we're at a shallower level
  for (const [level] of numCounters) {
    if (level > ilvl) {
      numCounters.delete(level);
    }
  }
  
  const value = formatValue(currentCount, fmt, ilvl);
  return { prefix: `${at}${value} `, isList: true };
}
