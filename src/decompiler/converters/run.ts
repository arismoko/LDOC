import { findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import type { RunStyle } from "../parsers/styles";

export type TextSegment = {
  style: RunStyle;
  text: string;
};

export function normalizeWs(s: string, preserveTabs = false): string {
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

export function wrapEmphasis(text: string, style: RunStyle): string {
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

export function parseRunStyle(runNode: XmlNode): RunStyle {
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

export function collectTextFromNodes(nodes: XmlNode[], segments: TextSegment[], currentStyle: RunStyle): void {
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
