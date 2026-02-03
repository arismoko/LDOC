import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

type XmlNode = Record<string, any>;

type RunStyle = {
  bold: boolean;
  italic: boolean;
};

type TextSegment = {
  style: RunStyle;
  text: string;
};

type NumberingLevel = {
  numFmt?: string;
};

type NumberingInfo = {
  // numId -> abstractNumId
  numToAbstract: Map<string, string>;
  // abstractNumId -> ilvl -> level info
  abstractLevels: Map<string, Map<number, NumberingLevel>>;
};

type SectionProps = {
  cols?: number;
  colSpace?: number; // twips
  colSep?: boolean;
  sectionType?: string; // "continuous", "nextPage", etc.
};

type LayoutInfo = {
  margins?: { top: number; right: number; bottom: number; left: number };
  landscape?: boolean;
  spacing?: { lineMultiplier?: number };
};

type HeaderFooterRefs = {
  defaultHeader?: string;
  defaultFooter?: string;
  firstHeader?: string;
  firstFooter?: string;
};

type ParagraphStyleInfo = {
  basedOn?: string;
  indentLeftTwips?: number;
};

type ParagraphStyleMap = Map<string, ParagraphStyleInfo>;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
  processEntities: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function getTagKeys(obj: XmlNode): string[] {
  return Object.keys(obj).filter((k) => k !== ":@" && k !== "#text");
}

function getOnlyKey(obj: XmlNode): string | null {
  const keys = getTagKeys(obj);
  if (keys.length !== 1) return null;
  return keys[0] ?? null;
}

function getAttrs(nodeObj: XmlNode): Record<string, any> {
  return (nodeObj[":@"] as any) ?? {};
}

function getChildren(nodeObj: XmlNode, tag: string): XmlNode[] {
  const arr = nodeObj[tag];
  return Array.isArray(arr) ? arr : [];
}

function findFirst(nodes: XmlNode[] | undefined, tag: string): XmlNode | undefined {
  if (!nodes) return undefined;
  for (const n of nodes) {
    const keys = getTagKeys(n);
    for (const k of keys) {
      if (k === tag) return n;
      if (Array.isArray(n[k])) {
        const found = findFirst(n[k], tag);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function findPath(root: XmlNode[], tags: string[]): XmlNode | undefined {
  let current: XmlNode | undefined;
  let nodes: XmlNode[] | undefined = root;
  for (const tag of tags) {
    current = findFirst(nodes, tag);
    if (!current) return undefined;
    // descend via the matched tag key
    nodes = Array.isArray((current as any)[tag]) ? ((current as any)[tag] as XmlNode[]) : undefined;
  }
  return current;
}

function attrVal(nodeObj: XmlNode | undefined, attr: string): string | undefined {
  if (!nodeObj) return undefined;
  const attrs = getAttrs(nodeObj);
  const v = attrs[attr];
  return typeof v === "string" ? v : v?.toString?.();
}

function normalizeWs(s: string, preserveTabs = false): string {
  // keep internal newlines (from <w:br>), but collapse other whitespace
  let result = s.replace(/\r\n/g, "\n");
  if (preserveTabs) {
    // Preserve tabs as literal '\t' for roundtrip fidelity
    result = result.replace(/[\v\f]+/g, " ");
  } else {
    result = result.replace(/[\t\v\f]+/g, " ");
  }
  return result.replace(/ +/g, " ").trimEnd();
}

function isTocStyle(styleId: string | undefined): boolean {
  if (!styleId) return false;
  // Match TOC1..TOC9 (case-insensitive)
  return /^toc[1-9]$/i.test(styleId);
}

function twipsToInches(twips: number): number {
  return twips / 1440;
}

function formatInches(inches: number): string {
  // Format to up to 2 decimal places, remove trailing zeros
  const rounded = Math.round(inches * 100) / 100;
  return rounded.toString();
}

function wrapEmphasis(text: string, style: RunStyle): string {
  if (!text) return text;
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const lead = m?.[1] ?? "";
  const core = m?.[2] ?? text;
  const trail = m?.[3] ?? "";
  if (!core) return text;

  let wrapped = core;
  if (style.bold && style.italic) wrapped = `***${core}***`;
  else if (style.bold) wrapped = `**${core}**`;
  else if (style.italic) wrapped = `*${core}*`;
  return `${lead}${wrapped}${trail}`;
}

function truthyWordBool(val: string | undefined): boolean {
  if (val === undefined) return true;
  const v = val.toLowerCase();
  return v !== "0" && v !== "false";
}

function parseRunStyle(runNode: XmlNode): RunStyle {
  const runChildren = runNode["w:r"] as XmlNode[];
  const rPr = findFirst(runChildren, "w:rPr");
  if (!rPr) return { bold: false, italic: false };
  const rPrChildren = rPr["w:rPr"] as XmlNode[];
  const bNode = findFirst(rPrChildren, "w:b");
  const iNode = findFirst(rPrChildren, "w:i");

  const bold = bNode ? truthyWordBool(attrVal(bNode, "@_w:val")) : false;
  const italic = iNode ? truthyWordBool(attrVal(iNode, "@_w:val")) : false;
  return { bold, italic };
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

function paragraphHasPageBreak(pNode: XmlNode): boolean {
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

function collectTextFromNodes(nodes: XmlNode[], segments: TextSegment[], currentStyle: RunStyle): void {
  for (const n of nodes) {
    const key = getOnlyKey(n);
    if (!key) continue;

    if (key === "w:t") {
      const kids = n["w:t"] as XmlNode[];
      // In preserveOrder mode, text is a child node with "#text"
      let text = "";
      for (const c of kids ?? []) {
        if (typeof c === "string" || typeof c === "number" || typeof c === "boolean") {
          text += c;
          continue;
        }
        const t = c?.["#text"];
        if (typeof t === "string" || typeof t === "number" || typeof t === "boolean") text += `${t}`;
      }
      if (text) {
        segments.push({ style: { ...currentStyle }, text });
      }
      continue;
    }

    if (key === "w:tab") {
      segments.push({ style: { ...currentStyle }, text: "\t" });
      continue;
    }

    if (key === "w:br") {
      segments.push({ style: { ...currentStyle }, text: "\n" });
      continue;
    }

    if (key === "w:cr") {
      segments.push({ style: { ...currentStyle }, text: "\n" });
      continue;
    }

    // Recurse into other container nodes (e.g., w:instrText is ignored by default)
    const children = Array.isArray(n[key]) ? (n[key] as XmlNode[]) : [];
    collectTextFromNodes(children, segments, currentStyle);
  }
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

function paragraphText(pNode: XmlNode, preserveTabs = false): string {
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

function parseNumbering(numberingXml: string | undefined): NumberingInfo {
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

function listPrefix(numInfo: NumberingInfo, numId: string, ilvl: number): { prefix: string; isList: boolean } {
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

function escapeTableCell(cell: string): string {
  const safe = cell.replace(/\"/g, "'").replace(/"/g, "'");
  const needsQuotes = /,/.test(safe) || /^\s/.test(safe) || /\s$/.test(safe);
  return needsQuotes ? `"${safe}"` : safe;
}

function tableToLdoc(tblNode: XmlNode): string {
  const tblChildren = tblNode["w:tbl"] as XmlNode[];
  const rows: string[] = [];

  for (const tr of tblChildren ?? []) {
    const k = getOnlyKey(tr);
    if (k !== "w:tr") continue;
    const trChildren = tr["w:tr"] as XmlNode[];
    const cells: string[] = [];
    for (const tc of trChildren ?? []) {
      const kk = getOnlyKey(tc);
      if (kk !== "w:tc") continue;
      const tcChildren = tc["w:tc"] as XmlNode[];
      const paras: string[] = [];
      for (const p of tcChildren ?? []) {
        const pk = getOnlyKey(p);
        if (pk === "w:p") {
          const t = paragraphText(p);
          if (t) paras.push(t);
        }
      }
      const cellText = normalizeWs(paras.join(" "));
      cells.push(escapeTableCell(cellText));
    }
    rows.push(`[${cells.join(", ")}]`);
  }

  // Emit as an indented @table block (matches parser expectation)
  const indented = rows.map((r) => `  ${r}`).join("\n");
  return `@table\n${indented}`;
}

function parseSectionProps(sectPrNode: XmlNode): SectionProps {
  const props: SectionProps = {};
  const sectPrChildren = sectPrNode["w:sectPr"] as XmlNode[];

  for (const child of sectPrChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:cols") {
      const num = attrVal(child, "@_w:num");
      if (num) {
        props.cols = parseInt(num, 10);
      }
      const space = attrVal(child, "@_w:space");
      if (space) {
        props.colSpace = parseInt(space, 10);
      }
      const sep = attrVal(child, "@_w:sep");
      if (sep === "true" || sep === "1") {
        props.colSep = true;
      }
    }
    if (key === "w:type") {
      props.sectionType = attrVal(child, "@_w:val");
    }
  }

  return props;
}

function parseLayoutFromSectPr(sectPrNode: XmlNode): LayoutInfo {
  const layout: LayoutInfo = {};
  const sectPrChildren = sectPrNode["w:sectPr"] as XmlNode[];

  for (const child of sectPrChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:pgMar") {
      const top = attrVal(child, "@_w:top");
      const right = attrVal(child, "@_w:right");
      const bottom = attrVal(child, "@_w:bottom");
      const left = attrVal(child, "@_w:left");
      if (top && right && bottom && left) {
        layout.margins = {
          top: parseInt(top, 10),
          right: parseInt(right, 10),
          bottom: parseInt(bottom, 10),
          left: parseInt(left, 10),
        };
      }
    }
    if (key === "w:pgSz") {
      const orient = attrVal(child, "@_w:orient");
      if (orient === "landscape") {
        layout.landscape = true;
      }
    }
  }

  return layout;
}

function parseHeaderFooterRefs(sectPrNode: XmlNode): HeaderFooterRefs {
  const refs: HeaderFooterRefs = {};
  const sectPrChildren = sectPrNode["w:sectPr"] as XmlNode[];

  for (const child of sectPrChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:headerReference") {
      const type = attrVal(child, "@_w:type");
      const rId = attrVal(child, "@_r:id");
      if (type === "default" && rId) {
        refs.defaultHeader = rId;
      } else if (type === "first" && rId) {
        refs.firstHeader = rId;
      }
    }
    if (key === "w:footerReference") {
      const type = attrVal(child, "@_w:type");
      const rId = attrVal(child, "@_r:id");
      if (type === "default" && rId) {
        refs.defaultFooter = rId;
      } else if (type === "first" && rId) {
        refs.firstFooter = rId;
      }
    }
  }

  return refs;
}

function parseDocumentRels(relsXml: string): Map<string, string> {
  const relMap = new Map<string, string>();
  const tree = xmlParser.parse(relsXml) as XmlNode[];

  const relationships = findFirst(tree, "Relationships");
  if (!relationships) return relMap;

  const relChildren = relationships["Relationships"] as XmlNode[];
  for (const child of relChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "Relationship") {
      const rId = attrVal(child, "@_Id");
      const target = attrVal(child, "@_Target");
      if (rId && target) {
        relMap.set(rId, target);
      }
    }
  }

  return relMap;
}

function parseSpacingFromStylesXml(stylesXml: string | undefined): { lineMultiplier?: number } | undefined {
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

function parseParagraphStyles(stylesXml: string | undefined): ParagraphStyleMap {
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

function resolveStyleIndentLeftTwips(styleId: string | undefined, styles: ParagraphStyleMap): number | undefined {
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

function formatTwipsAsPt(twips: number): string {
  const pt = twips / 20;
  return `${pt
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")}pt`;
}

export type DecompilerOptions = {
  /**
   * Control emission of @indent/@outdent directives.
   * - 'on': Always emit indent directives when indentation is detected
   * - 'off': Never emit indent directives (simpler output)
   * - 'auto': Same as 'on' (default behavior)
   */
  emitIndent?: 'on' | 'off' | 'auto' | boolean;
};

function shouldEmitIndent(options: DecompilerOptions | undefined): boolean {
  const val = options?.emitIndent;
  if (val === 'on' || val === true) return true;
  return false; // 'off', 'auto', false, undefined all suppress indent (default OFF)
}

async function parseHeaderFooterContent(
  zip: JSZip,
  rId: string,
  rels: Map<string, string>,
  numInfo: NumberingInfo,
  styles: ParagraphStyleMap,
  options?: DecompilerOptions
): Promise<string[]> {
  const target = rels.get(rId);
  if (!target) return [];

  // Target is like "header1.xml" or "footer1.xml"
  const filePath = `word/${target}`;
  const xml = await zip.file(filePath)?.async("text");
  if (!xml) return [];

  const tree = xmlParser.parse(xml) as XmlNode[];

  // Find w:hdr or w:ftr
  const hdr = findFirst(tree, "w:hdr");
  const ftr = findFirst(tree, "w:ftr");
  const root = hdr ?? ftr;
  if (!root) return [];

  const rootChildren = (hdr ? root["w:hdr"] : root["w:ftr"]) as XmlNode[];
  const lines: string[] = [];

  for (const child of rootChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:p") {
      const info = paragraphToLdoc(child, numInfo, styles, options);
      let line = info.line;
      if (info.alignment === "center" && !info.isEmpty) line = `@center ${line}`;
      else if (info.alignment === "right" && !info.isEmpty) line = `@right ${line}`;

      const indentTwips = info.isList ? 0 : (info.indentLeftTwips ?? 0);
      if (indentTwips > 0 && !info.isEmpty && shouldEmitIndent(options)) {
        line = `@indent=${formatTwipsAsPt(indentTwips)} ${line}`;
      }

      if (line) lines.push(line);
    } else if (key === "w:tbl") {
      lines.push(tableToLdoc(child));
    }
  }

  return lines;
}

function findFinalSectPr(bodyChildren: XmlNode[]): XmlNode | undefined {
  // The final sectPr is a direct child of w:body
  for (const child of bodyChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:sectPr") {
      return child;
    }
  }
  return undefined;
}

function findParagraphSectPr(pNode: XmlNode): XmlNode | undefined {
  const pChildren = pNode["w:p"] as XmlNode[];
  const pPr = findFirst(pChildren, "w:pPr");
  if (!pPr) return undefined;
  const pPrChildren = pPr["w:pPr"] as XmlNode[];
  return findFirst(pPrChildren, "w:sectPr");
}

type ParagraphInfo = {
  line: string;
  alignment?: string; // "center" | "right" | undefined
  indentLeftTwips?: number;
  isHeading: boolean;
  isList: boolean;
  isEmpty: boolean;
};

function paragraphToLdoc(pNode: XmlNode, numInfo: NumberingInfo, styles: ParagraphStyleMap, options?: DecompilerOptions): ParagraphInfo {
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

export async function docxToLdoc(input: ArrayBuffer | Uint8Array | Buffer, options?: DecompilerOptions): Promise<string> {
  const zip = await JSZip.loadAsync(input);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) throw new Error("Invalid .docx: missing word/document.xml");

  const numberingXml = await zip.file("word/numbering.xml")?.async("text");
  const numInfo = parseNumbering(numberingXml);

  const stylesXml = await zip.file("word/styles.xml")?.async("text");
  const spacingInfo = parseSpacingFromStylesXml(stylesXml);
  const paragraphStyles = parseParagraphStyles(stylesXml);

  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("text");
  const rels = relsXml ? parseDocumentRels(relsXml) : new Map<string, string>();

  const tree = xmlParser.parse(documentXml) as XmlNode[];
  const body = findPath(tree, ["w:document", "w:body"]);
  if (!body) throw new Error("Invalid .docx: missing w:body");

  const bodyChildren = body["w:body"] as XmlNode[];

  // Find final sectPr for layout and header/footer references
  const finalSectPr = findFinalSectPr(bodyChildren);
  let layout: LayoutInfo = {};
  let hfRefs: HeaderFooterRefs = {};

  if (finalSectPr) {
    layout = parseLayoutFromSectPr(finalSectPr);
    hfRefs = parseHeaderFooterRefs(finalSectPr);
  }

  // Build output
  const output: string[] = [];

  // Emit layout directives as @document block
  const hasNonDefaultMargins = layout.margins && !(
    Math.abs(twipsToInches(layout.margins.top) - 1) < 0.05 &&
    Math.abs(twipsToInches(layout.margins.right) - 1) < 0.05 &&
    Math.abs(twipsToInches(layout.margins.bottom) - 1) < 0.05 &&
    Math.abs(twipsToInches(layout.margins.left) - 1) < 0.05
  );
  
  const hasLayoutSettings = hasNonDefaultMargins || layout.landscape || (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0);

  if (hasLayoutSettings) {
    output.push("@document");
    
    if (hasNonDefaultMargins && layout.margins) {
      const { top, right, bottom, left } = layout.margins;
      output.push("  margins:");
      output.push(`    top: ${formatInches(twipsToInches(top))}in`);
      output.push(`    right: ${formatInches(twipsToInches(right))}in`);
      output.push(`    bottom: ${formatInches(twipsToInches(bottom))}in`);
      output.push(`    left: ${formatInches(twipsToInches(left))}in`);
    }
    
    if (layout.landscape) {
      output.push("  orientation: landscape");
    }
    
    if (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0) {
      output.push(`  spacing:`);
      output.push(`    line: ${spacingInfo.lineMultiplier}`);
    }
    
    output.push("");
  }

  // Emit header if present
  if (hfRefs.defaultHeader) {
    const headerLines = await parseHeaderFooterContent(zip, hfRefs.defaultHeader, rels, numInfo, paragraphStyles, options);
    const nonEmptyLines = headerLines.filter((l) => l.trim());
    if (nonEmptyLines.length > 0) {
      output.push("@header\n" + nonEmptyLines.map((l) => `  ${l}`).join("\n"));
    }
  }

  // Emit footer if present
  if (hfRefs.defaultFooter) {
    const footerLines = await parseHeaderFooterContent(zip, hfRefs.defaultFooter, rels, numInfo, paragraphStyles, options);
    const nonEmptyLines = footerLines.filter((l) => l.trim());
    if (nonEmptyLines.length > 0) {
      output.push("@footer\n" + nonEmptyLines.map((l) => `  ${l}`).join("\n"));
    }
  }

  // Partition body children into sections based on sectPr in paragraph pPr
  type Section = {
    props?: SectionProps;
    children: XmlNode[];
  };

  const sections: Section[] = [];
  let currentSection: Section = { children: [] };

  for (const child of bodyChildren ?? []) {
    const key = getOnlyKey(child);

    if (key === "w:sectPr") {
      // Final sectPr - handled separately for layout
      continue;
    }

    if (key === "w:p") {
      // Check for sectPr in paragraph
      const pSectPr = findParagraphSectPr(child);
      if (pSectPr) {
        // This paragraph ends a section
        currentSection.children.push(child);
        currentSection.props = parseSectionProps(pSectPr);
        sections.push(currentSection);
        currentSection = { children: [] };
        continue;
      }
    }

    currentSection.children.push(child);
  }

  // Push remaining content as the final section
  if (currentSection.children.length > 0) {
    if (finalSectPr) {
      currentSection.props = parseSectionProps(finalSectPr);
    }
    sections.push(currentSection);
  }

  // Convert sections to LDOC
  const blocks: string[] = [];

  // Helper to process a list of paragraph children and apply alignment grouping
  function processChildren(children: XmlNode[], indent: string = ""): string[] {
    const result: string[] = [];
    const emitIndentDirectives = shouldEmitIndent(options);
    
    // First, collect all paragraph info
    const items: Array<{ type: "paragraph"; info: ParagraphInfo } | { type: "table"; content: string }> = [];
    for (const child of children) {
      const key = getOnlyKey(child);
      if (key === "w:p") {
        items.push({ type: "paragraph", info: paragraphToLdoc(child, numInfo, paragraphStyles, options) });
      } else if (key === "w:tbl") {
        items.push({ type: "table", content: tableToLdoc(child) });
      }
    }

    const emitAligned = (paragraphInfos: ParagraphInfo[], baseIndent: string): string[] => {
      const out: string[] = [];
      let i = 0;
      while (i < paragraphInfos.length) {
        const info = paragraphInfos[i]!;
        const alignment = info.alignment;

        if (alignment && !info.isHeading && !info.isList && !info.isEmpty) {
          const group: number[] = [i];
          let j = i + 1;
          while (j < paragraphInfos.length) {
            const next = paragraphInfos[j]!;
            if (next.isHeading || next.isList) break;
            if (next.isEmpty) {
              group.push(j);
              j++;
              continue;
            }
            if (next.alignment !== alignment) break;
            group.push(j);
            j++;
          }

          const nonEmptyCount = group.filter((idx) => !paragraphInfos[idx]!.isEmpty).length;
          if (nonEmptyCount >= 2) {
            out.push(`${baseIndent}@${alignment}`);
            for (let gi = 0; gi < group.length; gi++) {
              const idx = group[gi]!;
              const p = paragraphInfos[idx]!;
              // Preserve block indentation on empty lines, otherwise blocks break.
              if (p.isEmpty) {
                out.push(`${baseIndent}  `);
                continue;
              }

              out.push(`${baseIndent}  ${p.line}`);

              // In LDOC, a single newline is a soft wrap for plain paragraphs.
              // Insert an indented blank separator so each DOCX paragraph stays its own paragraph.
              const hasMore = group.slice(gi + 1).some((k) => !paragraphInfos[k]!.isEmpty);
              if (hasMore) out.push(`${baseIndent}  `);
            }
            i = j;
            continue;
          }
        }

        let line = info.line;
        if (info.alignment === "center" && !info.isEmpty) line = `@center ${line}`;
        else if (info.alignment === "right" && !info.isEmpty) line = `@right ${line}`;
        out.push(baseIndent + line);
        i++;
      }
      return out;
    };

    // Indent grouping first, then alignment grouping inside each indent group
    let i = 0;
    while (i < items.length) {
      const item = items[i]!;
      if (item.type === "table") {
        result.push(indent + item.content.split("\n").join("\n" + indent));
        i++;
        continue;
      }

      // Lists should not be wrapped in @indent; they carry indentation via numbering.
      if (item.info.isList) {
        result.push(indent + item.info.line);
        i++;
        continue;
      }

      const indentTwips = item.info.indentLeftTwips ?? 0;
      // When emitIndent is off, treat all paragraphs as having zero indent (skip indent grouping)
      if (indentTwips <= 0 || !emitIndentDirectives) {
        // Collect a run of non-list paragraphs with indent=0 (or all when emitIndent=off) and process with alignment grouping
        const run: ParagraphInfo[] = [];
        let j = i;
        while (j < items.length) {
          const next = items[j]!;
          if (next.type !== "paragraph") break;
          if (next.info.isList) break;
          // When emitIndent is off, don't break on indent changes
          if (emitIndentDirectives && (next.info.indentLeftTwips ?? 0) > 0) break;
          run.push(next.info);
          j++;
        }
        result.push(...emitAligned(run, indent));
        i = j;
        continue;
      }

      // Collect a run of non-list paragraphs with the same indent
      const run: ParagraphInfo[] = [item.info];
      let j = i + 1;
      while (j < items.length) {
        const next = items[j]!;
        if (next.type !== "paragraph") break;
        if (next.info.isList) break;
        if ((next.info.indentLeftTwips ?? 0) !== indentTwips) break;
        run.push(next.info);
        j++;
      }

      const nonEmptyCount = run.filter((p) => !p.isEmpty).length;
      const len = formatTwipsAsPt(indentTwips);
      if (nonEmptyCount >= 2) {
        result.push(`${indent}@indent=${len}`);
        result.push(...emitAligned(run, `${indent}  `));
      } else {
        const only = run[0]!;
        const alignNeedsNesting = only.alignment === "center" || only.alignment === "right";
        if (!only.isEmpty && !alignNeedsNesting) {
          result.push(`${indent}@indent=${len} ${only.line}`);
        } else {
          result.push(`${indent}@indent=${len}`);
          result.push(...emitAligned(run, `${indent}  `));
        }
      }

      i = j;
    }

    return result;
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const isColumnsSection = section.props?.cols && section.props.cols > 1;

    if (isColumnsSection) {
      // Emit @columns block
      const cols = section.props!.cols!;
      let columnsLine = `@columns ${cols}`;

      if (section.props!.colSpace !== undefined) {
        const gapIn = formatInches(twipsToInches(section.props!.colSpace));
        columnsLine += ` gap=${gapIn}in`;
      }

      if (section.props!.colSep) {
        columnsLine += " separator";
      }

      // Collect content lines for columns block
      const contentLines = processChildren(section.children, "  ");
      const nonEmptyLines = contentLines.filter((l) => l.trim());

      // Emit as a single block
      blocks.push(columnsLine + "\n" + nonEmptyLines.join("\n") + "\n@;");
    } else {
      // Normal section - emit blocks with alignment grouping
      const lines = processChildren(section.children, "");
      blocks.push(...lines);
    }
  }

  // Combine output
  const finalOutput = [...output, ...blocks];

  // Join, preserve at most one blank line between blocks, clean up trailing whitespace
  const joined = finalOutput.join("\n");
  const trimmedTrailing = joined
    .split("\n")
    .map((line) => {
      // Preserve indentation-only blank lines inside modifier blocks.
      if (!line.trim()) return line;
      return line.replace(/[ \t]+$/g, "");
    })
    .join("\n");

  return trimmedTrailing.replace(/\n{3,}/g, "\n\n").trim();
}
