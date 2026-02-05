import { findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import type { RunStyle } from "../parsers/styles";
import { extractImageFromDrawing, extractImageFromPict, extractAltText } from "./image";
import { halfPointsToPt } from "../../shared/units";
import { isHighlightColor } from "../../shared/highlight";

export type TextSegment = {
  style: RunStyle;
  text: string;
};

/** Style flags relevant for emphasis coalescing (ignoring font/size) */
type EmphasisStyle = {
  bold: boolean;
  italic: boolean;
  strike?: boolean;
  code?: boolean;
  highlight?: string;
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
  // Collapse multiple spaces but preserve "  \n" (hard break marker)
  // Temporarily replace hard break marker, collapse spaces, then restore
  result = result.replace(/  \n/g, "\x00HARDBREAK\x00");
  result = result.replace(/ +/g, " ");
  result = result.replace(/\x00HARDBREAK\x00/g, "  \n");

  if (!trimEnd) return result;

  // Preserve terminal hard-break markers ("  \n") when trimming.
  // These represent explicit DOCX w:br/w:cr and must survive round-trip.
  const m = result.match(/(?:  \n)+$/);
  if (!m) return result.trimEnd();

  const suffix = m[0];
  const core = result.slice(0, -suffix.length).trimEnd();
  return core + suffix;
}

export function wrapEmphasis(text: string, style: EmphasisStyle): string {
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
  
  // Apply highlight
  if (style.highlight) {
    if (style.highlight === "yellow") {
      // Default yellow uses == syntax
      wrapped = `==${wrapped}==`;
    } else {
      // Explicit color uses @highlight(color)[text] syntax
      wrapped = `@highlight(${style.highlight})[${wrapped}]`;
    }
  }
  
  // Apply bold/italic (outermost)
  if (style.bold && style.italic) wrapped = `***${wrapped}***`;
  else if (style.bold) wrapped = `**${wrapped}**`;
  else if (style.italic) wrapped = `*${wrapped}*`;
  
  return `${lead}${wrapped}${trail}`;
}

/**
 * Check if two runs share at least one emphasis style (for grouping).
 * Code runs are never grouped (backticks can't nest).
 */
function sharesEmphasisStyle(a: EmphasisStyle, b: EmphasisStyle): boolean {
  if (a.code || b.code) return false; // Code can't nest
  return (a.bold && b.bold) || (a.italic && b.italic) || (!!a.strike && !!b.strike) || (!!a.highlight && !!b.highlight && a.highlight === b.highlight);
}

/**
 * Check if a style has any emphasis flags set.
 */
function hasEmphasis(style: EmphasisStyle): boolean {
  return style.bold || style.italic || !!style.strike || !!style.code || !!style.highlight;
}

/**
 * Group consecutive segments that share at least one common emphasis style.
 */
function groupBySharedStyles(segments: TextSegment[]): TextSegment[][] {
  const groups: TextSegment[][] = [];
  let currentGroup: TextSegment[] = [];

  for (const seg of segments) {
    if (currentGroup.length === 0) {
      currentGroup.push(seg);
      continue;
    }

    const last = currentGroup[currentGroup.length - 1]!;
    if (sharesEmphasisStyle(last.style, seg.style)) {
      currentGroup.push(seg);
    } else {
      groups.push(currentGroup);
      currentGroup = [seg];
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Coalesce a group of runs that share common styles.
 * Extracts common "outer" styles and wraps once, processing inner variations.
 */
function coalesceGroup(group: TextSegment[]): string {
  if (group.length === 0) return "";
  if (group.length === 1) {
    return wrapEmphasis(group[0]!.text, group[0]!.style);
  }

  // Find styles common to ALL runs in group
  // For highlight, only consider it common if all have the same highlight color
  const firstHighlight = group[0]!.style.highlight;
  const allSameHighlight = group.every(r => r.style.highlight === firstHighlight);
  
  const commonStyles: EmphasisStyle = {
    bold: group.every(r => r.style.bold),
    italic: group.every(r => r.style.italic),
    strike: group.every(r => !!r.style.strike),
    code: group.every(r => !!r.style.code),
    highlight: allSameHighlight ? firstHighlight : undefined,
  };

  const hasCommon = hasEmphasis(commonStyles);

  if (!hasCommon) {
    // No common styles - process each independently
    return group.map(r => wrapEmphasis(r.text, r.style)).join("");
  }

  // Process inner content with remaining (non-common) styles
  const innerContent = group.map(r => {
    const remainingStyles: EmphasisStyle = {
      bold: r.style.bold && !commonStyles.bold,
      italic: r.style.italic && !commonStyles.italic,
      strike: !!r.style.strike && !commonStyles.strike,
      code: !!r.style.code && !commonStyles.code,
      highlight: r.style.highlight !== commonStyles.highlight ? r.style.highlight : undefined,
    };
    
    if (hasEmphasis(remainingStyles)) {
      return wrapEmphasis(r.text, remainingStyles);
    }
    return r.text;
  }).join("");

  // Wrap with common styles
  return wrapEmphasis(innerContent, commonStyles);
}

/**
 * Process text segments with style span coalescing.
 * Groups adjacent runs with shared styles and wraps them together,
 * producing cleaner nested emphasis output.
 */
export function coalesceStyledSegments(segments: TextSegment[]): string {
  const groups = groupBySharedStyles(segments);
  return groups.map(coalesceGroup).join("");
}

/** Style attributes for inline @style emission */
type InlineStyleAttrs = {
  font?: string;
  size?: string;  // e.g. "14pt"
  color?: string; // e.g. "FF0000"
  spacing?: string; // e.g. "20twip" or "1pt"
  background?: string; // e.g. "#FF0000" (shading)
};

/**
 * Check if a segment has style attributes that differ from dominant.
 */
function getInlineStyleAttrs(
  style: RunStyle, 
  dominant: { font?: string; sizePt?: number }
): InlineStyleAttrs | null {
  const attrs: InlineStyleAttrs = {};
  
  // Font differs from dominant (or segment has font but dominant doesn't)
  if (style.font && (!dominant.font || 
      style.font.toLowerCase() !== dominant.font.toLowerCase())) {
    attrs.font = style.font;
  }
  
  // Size differs from dominant (or segment has size but dominant doesn't)
  if (style.sizePt && (!dominant.sizePt || style.sizePt !== dominant.sizePt)) {
    attrs.size = `${style.sizePt}pt`;
  }
  
  // Color present (no "dominant color" concept - any color is notable)
  if (style.color) {
    attrs.color = style.color;
  }

  if (style.characterSpacing !== undefined) {
    // Prefer pt when divisible by 20
    attrs.spacing = style.characterSpacing % 20 === 0
      ? `${style.characterSpacing / 20}pt`
      : `${style.characterSpacing}twip`;
  }

  // Only treat custom shading as background; highlight is emitted as == / @highlight()
  if (style.shadingFill) {
    attrs.background = `#${style.shadingFill}`;
  }
  
  return Object.keys(attrs).length > 0 ? attrs : null;
}

/**
 * Format inline style attributes as string: font=X size=Ypt color=Z
 */
function formatInlineStyleAttrs(attrs: InlineStyleAttrs): string {
  const parts: string[] = [];
  if (attrs.font) {
    // Quote if contains spaces
    parts.push(`font: ${attrs.font.includes(" ") ? JSON.stringify(attrs.font) : attrs.font}`);
  }
  if (attrs.size) parts.push(`size: ${attrs.size}`);
  if (attrs.color) parts.push(`color: ${attrs.color}`);
  if (attrs.spacing) parts.push(`spacing: ${attrs.spacing}`);
  if (attrs.background) parts.push(`background: ${attrs.background}`);
  return parts.join(", ");
}

/**
 * Check if two segments have the same inline style attrs.
 */
function sameInlineStyle(a: InlineStyleAttrs | null, b: InlineStyleAttrs | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.font === b.font &&
    a.size === b.size &&
    a.color === b.color &&
    a.spacing === b.spacing &&
    a.background === b.background
  );
}

/**
 * Coalesce segments, wrapping those with non-dominant styles in @style().
 * Call order: this wraps emphasis coalescing.
 */
export function coalesceInlineStyles(
  segments: TextSegment[],
  dominant: { font?: string; sizePt?: number }
): string {
  if (segments.length === 0) return "";

  // Group adjacent segments with same inline style attrs
  // Break groups at newlines to avoid @style()[] spanning lines
  const groups: { attrs: InlineStyleAttrs | null; segments: TextSegment[] }[] = [];

  for (const seg of segments) {
    const attrs = getInlineStyleAttrs(seg.style, dominant);
    const lastGroup = groups[groups.length - 1];

    // Check if previous segment ended with newline - if so, start new group
    const prevSeg = lastGroup?.segments[lastGroup.segments.length - 1];
    const prevEndsWithNewline = prevSeg?.text.includes("\n");

    if (lastGroup && sameInlineStyle(lastGroup.attrs, attrs) && !prevEndsWithNewline) {
      lastGroup.segments.push(seg);
    } else {
      groups.push({ attrs, segments: [seg] });
    }
  }

  // Process each group
  return groups
    .map((group) => {
      // First coalesce emphasis within the group
      const emphasisText = coalesceStyledSegments(group.segments);

      // Then wrap with @style if needed
      if (group.attrs) {
        const attrStr = formatInlineStyleAttrs(group.attrs);

        // If content contains newlines, we can't wrap in inline @style()[]
        // Split by newline and wrap each non-empty line separately
        if (emphasisText.includes("\n")) {
          const parts = emphasisText.split("\n");
          return parts
            .map((part, i) => {
              const suffix = i < parts.length - 1 ? "\n" : "";
              // Preserve markdown hard-break marker (two spaces at end-of-line)
              // by moving it OUTSIDE the @style(...)[...] wrapper.
              const hasHardBreak = part.endsWith("  ");
              const core = hasHardBreak ? part.slice(0, -2) : part;
              const hardBreakSuffix = hasHardBreak ? "  " : "";
              // Only wrap non-whitespace parts
              if (core.trim()) {
                return `@style(${attrStr})[${core}]${hardBreakSuffix}${suffix}`;
              }
              // Whitespace-only line: don't wrap; still preserve hard break if present.
              return core + hardBreakSuffix + suffix;
            })
            .join("");
        }

        return `@style(${attrStr})[${emphasisText}]`;
      }

      return emphasisText;
    })
    .join("");
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

  // Extract font name (prefer ascii, fallback to hAnsi, then cs)
  const fontName = asciiFont || hAnsiFont || csFont;

  // Extract size from w:sz (value is in half-points, so divide by 2)
  const szNode = findFirst(rPrChildren, "w:sz");
  const szVal = attrVal(szNode, "@_w:val");
  const sizePt = szVal ? halfPointsToPt(parseInt(szVal, 10)) : undefined;

  // Extract color from w:color
  const colorNode = findFirst(rPrChildren, "w:color");
  const colorVal = attrVal(colorNode, "@_w:val");
  // Normalize: uppercase hex, ignore "auto"
  const color = colorVal && colorVal.toLowerCase() !== "auto" 
    ? colorVal.toUpperCase() 
    : undefined;

  // Extract highlight from w:highlight
  const highlightNode = findFirst(rPrChildren, "w:highlight");
  const highlightVal = attrVal(highlightNode, "@_w:val");
  const highlight = highlightVal && isHighlightColor(highlightVal) ? highlightVal : undefined;

  // Extract shading fill from w:shd
  const shdNode = findFirst(rPrChildren, "w:shd");
  const fillVal = attrVal(shdNode, "@_w:fill");
  const shadingFill = fillVal && fillVal.toLowerCase() !== "auto" ? fillVal.toUpperCase() : undefined;

  // Extract character spacing from w:spacing (twips)
  const spacingNode = findFirst(rPrChildren, "w:spacing");
  const spacingVal = attrVal(spacingNode, "@_w:val");
  const characterSpacing = spacingVal ? parseInt(spacingVal, 10) : undefined;

  return { 
    bold, 
    italic, 
    strike, 
    code,
    font: fontName || undefined,
    sizePt: Number.isFinite(sizePt) ? sizePt : undefined,
    color,
    highlight,
    shadingFill,
    characterSpacing: Number.isFinite(characterSpacing) ? characterSpacing : undefined,
  };
}

export function collectTextFromNodes(nodes: XmlNode[], segments: TextSegment[], currentStyle: RunStyle, rels?: Map<string, string>): void {
  for (const n of nodes) {
    const key = getOnlyKey(n);
    if (!key) continue;

    // Handle footnote references
    if (key === "w:footnoteReference") {
      const fnId = attrVal(n, "@_w:id");
      if (fnId) {
        segments.push({ style: { ...currentStyle, bold: false, italic: false }, text: `[^${fnId}]` });
      }
      continue;
    }

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
      // Check for page break (handled at paragraph level)
      const brType = attrVal(n, "@_w:type");
      if (brType === "page") {
        // Page breaks are handled by isPageBreakParagraph
        continue;
      }
      // Hard break: emit double-space + newline (Markdown-style line break)
      segments.push({ style: { ...currentStyle }, text: "  \n" });
      continue;
    }

    if (key === "w:cr") {
      // Carriage return: also treated as hard break
      segments.push({ style: { ...currentStyle }, text: "  \n" });
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
