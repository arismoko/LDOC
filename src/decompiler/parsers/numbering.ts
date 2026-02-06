import { xmlParser, findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import {
  toRoman,
  toLowerLetter,
  toUpperLetter,
  getDefaultFormat,
  type NumberFormat,
} from "../../shared/numbering";

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
  const effectiveFmt = fmt ?? getDefaultFormat(ilvl);
  
  switch (effectiveFmt) {
    case "decimal":
      return String(count);
    case "lowerLetter":
      return toLowerLetter(count);
    case "upperLetter":
      return toUpperLetter(count);
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

/**
 * Get the format marker for directive-style lists.
 * Maps DOCX numFmt to LDOC format markers: "1" (decimal), "a" (lowerLetter), etc.
 */
function getFormatMarker(fmt: string | undefined, ilvl: number): string {
  const effectiveFmt = fmt ?? getDefaultFormat(ilvl);
  switch (effectiveFmt) {
    case "decimal":
      return "1";
    case "lowerLetter":
      return "a";
    case "upperLetter":
      return "A";
    case "lowerRoman":
      return "i";
    case "upperRoman":
      return "I";
    default:
      return "1";
  }
}

export function listPrefix(numInfo: NumberingInfo, numId: string, ilvl: number): { prefix: string; isList: boolean } {
  const absId = numInfo.numToAbstract.get(numId);
  const levels = absId ? numInfo.abstractLevels.get(absId) : undefined;
  const fmt = levels?.get(ilvl)?.numFmt;
  const depth = Math.max(0, ilvl) + 1; // ilvl 0 → depth 1, ilvl 1 → depth 2, etc.
  
  // For bullets:
  // - Top-level (depth 1): use Markdown-style "- "
  // - Nested (depth > 1): use directive-style "@@- ", "@@@- ", etc.
  if (fmt === "bullet") {
    if (depth === 1) {
      return { prefix: "- ", isList: true };
    } else {
      // Directive-style: @@ = level 1, @@@ = level 2, so depth + 1 @-symbols
      const at = "@".repeat(depth + 1);
      return { prefix: `${at}- `, isList: true };
    }
  }
  
  // For ordered lists:
  // - Top-level (depth 1): use Markdown-style "1. ", "2. ", "a. ", etc.
  // - Nested (depth > 1): use directive-style "@@1 ", "@@@a ", etc.
  
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
  
  // All levels use directive-style: @@1, @@a, @@@1, @@@a, etc.
  // @@ = level 1 (top-level), @@@ = level 2, etc. (depth + 1 @-symbols)
  const at = "@".repeat(depth + 1);
  const formatMarker = getFormatMarker(fmt, ilvl);
  return { prefix: `${at}${formatMarker} `, isList: true };
}
