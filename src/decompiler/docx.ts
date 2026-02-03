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

function normalizeWs(s: string): string {
  // keep internal newlines (from <w:br>), but collapse other whitespace
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[\t\v\f]+/g, " ")
    .replace(/ +/g, " ")
    .trimEnd();
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

function paragraphText(pNode: XmlNode): string {
  const segments = paragraphSegments(pNode);
  return normalizeWs(segments.map((s) => wrapEmphasis(s.text, s.style)).join(""));
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

function paragraphToLdoc(pNode: XmlNode, numInfo: NumberingInfo): string {
  const text = paragraphText(pNode);
  const styleId = paragraphStyleId(pNode);

  if (styleId) {
    const m = styleId.match(/^Heading([1-6])$/i);
    if (m) {
      const level = parseInt(m[1]!, 10);
      const hashes = "#".repeat(Math.max(1, Math.min(6, level)));
      return `${hashes} ${text}`.trimEnd();
    }
  }

  const num = paragraphNumbering(pNode);
  if (num) {
    const { prefix } = listPrefix(numInfo, num.numId, num.ilvl);
    return `${prefix}${text}`.trimEnd();
  }

  return text;
}

export async function docxToLdoc(input: ArrayBuffer | Uint8Array | Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(input);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) throw new Error("Invalid .docx: missing word/document.xml");

  const numberingXml = await zip.file("word/numbering.xml")?.async("text");
  const numInfo = parseNumbering(numberingXml);

  const tree = xmlParser.parse(documentXml) as XmlNode[];
  const body = findPath(tree, ["w:document", "w:body"]);
  if (!body) throw new Error("Invalid .docx: missing w:body");

  const bodyChildren = body["w:body"] as XmlNode[];
  const blocks: string[] = [];

  for (const child of bodyChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:p") {
      const line = paragraphToLdoc(child, numInfo);
      blocks.push(line);
      continue;
    }
    if (key === "w:tbl") {
      blocks.push(tableToLdoc(child));
      continue;
    }
    // ignore sectPr and others
  }

  // Preserve blank paragraphs as blank lines
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n\n");
}
