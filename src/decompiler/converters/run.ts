import { findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import type { RunStyle } from "../parsers/styles";
import { extractImageFromDrawing, extractImageFromPict, extractAltText } from "./image";

export type TextSegment = {
  style: RunStyle;
  text: string;
};

export function normalizeWs(s: string, preserveTabs = false, trimEnd = true): string {
  // keep internal newlines (from <w:br>), but collapse other whitespace
  let result = s.replace(/\r\n/g, "\n");
  if (preserveTabs) {
    // Preserve tabs as literal '\t' for roundtrip fidelity
    result = result.replace(/[\v\f]+/g, " ");
  } else {
    result = result.replace(/[\t\v\f]+/g, " ");
  }
  result = result.replace(/ +/g, " ");
  return trimEnd ? result.trimEnd() : result;
}

export function wrapEmphasis(text: string, style: RunStyle): string {
  if (!text) return text;
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const lead = m?.[1] ?? "";
  const core = m?.[2] ?? text;
  const trail = m?.[3] ?? "";
  if (!core) return text;

  let wrapped = core;
  
  // Apply code formatting first (innermost)
  if (style.code) wrapped = `\`${wrapped}\``;
  
  // Apply strikethrough
  if (style.strike) wrapped = `~~${wrapped}~~`;
  
  // Apply bold/italic (outermost)
  if (style.bold && style.italic) wrapped = `***${wrapped}***`;
  else if (style.bold) wrapped = `**${wrapped}**`;
  else if (style.italic) wrapped = `*${wrapped}*`;
  
  return `${lead}${wrapped}${trail}`;
}

function truthyWordBool(val: string | undefined): boolean {
  if (val === undefined) return true;
  const v = val.toLowerCase();
  return v !== "0" && v !== "false";
}

const MONOSPACE_FONTS = new Set([
  "courier new",
  "consolas",
  "monospace",
  "courier",
  "lucida console",
  "monaco",
  "menlo",
  "dejavu sans mono",
  "liberation mono",
  "source code pro",
  "fira code",
  "jetbrains mono",
]);

function isMonospaceFont(fontName: string | undefined): boolean {
  if (!fontName) return false;
  return MONOSPACE_FONTS.has(fontName.toLowerCase());
}

export function parseRunStyle(runNode: XmlNode): RunStyle {
  const runChildren = runNode["w:r"] as XmlNode[];
  const rPr = findFirst(runChildren, "w:rPr");
  if (!rPr) return { bold: false, italic: false };
  const rPrChildren = rPr["w:rPr"] as XmlNode[];
  const bNode = findFirst(rPrChildren, "w:b");
  const iNode = findFirst(rPrChildren, "w:i");
  const strikeNode = findFirst(rPrChildren, "w:strike");

  const bold = bNode ? truthyWordBool(attrVal(bNode, "@_w:val")) : false;
  const italic = iNode ? truthyWordBool(attrVal(iNode, "@_w:val")) : false;
  const strike = strikeNode ? truthyWordBool(attrVal(strikeNode, "@_w:val")) : false;

  // Detect monospace fonts for code formatting
  const rFonts = findFirst(rPrChildren, "w:rFonts");
  const asciiFont = attrVal(rFonts, "@_w:ascii");
  const hAnsiFont = attrVal(rFonts, "@_w:hAnsi");
  const csFont = attrVal(rFonts, "@_w:cs");
  const code = isMonospaceFont(asciiFont) || isMonospaceFont(hAnsiFont) || isMonospaceFont(csFont);

  return { bold, italic, strike, code };
}

export function collectTextFromNodes(nodes: XmlNode[], segments: TextSegment[], currentStyle: RunStyle, rels?: Map<string, string>): void {
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

    // Handle images in drawings
    if (key === "w:drawing" && rels) {
      const imagePath = extractImageFromDrawing(n, rels);
      if (imagePath) {
        const alt = extractAltText(n);
        segments.push({ style: { ...currentStyle }, text: `![${alt}](${imagePath})` });
        continue;
      }
    }

    // Handle legacy VML images
    if (key === "w:pict" && rels) {
      const imagePath = extractImageFromPict(n, rels);
      if (imagePath) {
        segments.push({ style: { ...currentStyle }, text: `![image](${imagePath})` });
        continue;
      }
    }

    // Recurse into other container nodes (e.g., w:instrText is ignored by default)
    const children = Array.isArray(n[key]) ? (n[key] as XmlNode[]) : [];
    collectTextFromNodes(children, segments, currentStyle, rels);
  }
}
