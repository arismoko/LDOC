/**
 * Inline Emission
 *
 * Converts ExtractedRun elements to LDOC inline syntax:
 * - **bold**, *italic*, `code`, ~~strike~~, ==highlight==
 * - @style(font, size, color)[text]
 * - @br (hard break), @tab (tab character)
 * - ![alt](path) for images
 * - [text](url) for hyperlinks
 * - [[anchor]] for cross-references
 * - [^id] for footnotes
 */

import type {
  ExtractedRun,
  ExtractedRunStyle,
  ExtractedParagraphContent,
  ExtractedHyperlink,
  ExtractedImage,
  ExtractedFootnoteRef,
} from "../extraction/types";
import type { EmissionContext } from "./types";
import type { DominantStyle } from "../semantic/analyzer";

/**
 * Type guard for hyperlinks.
 */
function isHyperlink(item: ExtractedParagraphContent): item is ExtractedHyperlink {
  return "type" in item && item.type === "hyperlink";
}

/**
 * Type guard for images.
 */
function isImage(item: ExtractedParagraphContent): item is ExtractedImage {
  return "type" in item && item.type === "image";
}

/**
 * Type guard for footnotes.
 */
function isFootnote(item: ExtractedParagraphContent): item is ExtractedFootnoteRef {
  return "type" in item && item.type === "footnote";
}

/**
 * Type guard for runs.
 */
function isRun(item: ExtractedParagraphContent): item is ExtractedRun {
  return "text" in item && "style" in item;
}

/**
 * Wrap text with emphasis markers.
 * Preserves leading/trailing whitespace outside markers.
 */
function wrapEmphasis(text: string, style: ExtractedRunStyle): string {
  if (!text) return text;

  // Extract leading/trailing whitespace
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
      wrapped = `==${wrapped}==`;
    } else {
      wrapped = `@highlight(${style.highlight})[${wrapped}]`;
    }
  }

  // Apply underline
  if (style.underline) {
    wrapped = `@underline[${wrapped}]`;
  }

  // Apply subscript/superscript
  if (style.subscript) wrapped = `@sub[${wrapped}]`;
  if (style.superscript) wrapped = `@sup[${wrapped}]`;

  // Apply all caps / small caps
  if (style.allCaps) wrapped = `@caps[${wrapped}]`;
  if (style.smallCaps) wrapped = `@smallcaps[${wrapped}]`;

  // Apply bold/italic (outermost)
  if (style.bold && style.italic) wrapped = `***${wrapped}***`;
  else if (style.bold) wrapped = `**${wrapped}**`;
  else if (style.italic) wrapped = `*${wrapped}*`;

  return `${lead}${wrapped}${trail}`;
}

/**
 * Style attributes for inline @style emission.
 */
interface InlineStyleAttrs {
  font?: string;
  size?: string;
  color?: string;
  spacing?: string;
  background?: string;
}

/**
 * Get inline style attributes that differ from dominant style.
 */
function getStyleAttrs(
  style: ExtractedRunStyle,
  dominant: DominantStyle,
): InlineStyleAttrs | null {
  const attrs: InlineStyleAttrs = {};

  // Font differs from dominant
  if (style.font) {
    if (!dominant.font || style.font.toLowerCase() !== dominant.font.toLowerCase()) {
      attrs.font = style.font;
    }
  }

  // Size differs from dominant
  if (style.sizePt) {
    if (!dominant.sizePt || style.sizePt !== dominant.sizePt) {
      attrs.size = `${style.sizePt}pt`;
    }
  }

  // Color is always emitted if present
  if (style.color) {
    attrs.color = style.color;
  }

  // Character spacing — only emit if significant (> 1pt = 20 twips).
  // Values ≤ 1pt are Word's internal kerning/justification noise
  // that varies on reflow and has no semantic meaning.
  if (style.characterSpacing !== undefined && Math.abs(style.characterSpacing) > 20) {
    attrs.spacing =
      style.characterSpacing % 20 === 0
        ? `${style.characterSpacing / 20}pt`
        : `${style.characterSpacing}twip`;
  }

  // Shading fill (background)
  if (style.shadingFill) {
    attrs.background = `#${style.shadingFill}`;
  }

  return Object.keys(attrs).length > 0 ? attrs : null;
}

/**
 * Format inline style attributes as string.
 */
function formatStyleAttrs(attrs: InlineStyleAttrs): string {
  const parts: string[] = [];
  if (attrs.font) {
    parts.push(`font: ${attrs.font.includes(" ") ? JSON.stringify(attrs.font) : attrs.font}`);
  }
  if (attrs.size) parts.push(`size: ${attrs.size}`);
  if (attrs.color) parts.push(`color: ${attrs.color}`);
  if (attrs.spacing) parts.push(`spacing: ${attrs.spacing}`);
  if (attrs.background) parts.push(`background: ${attrs.background}`);
  return parts.join(", ");
}

/**
 * Check if two style attr objects are equal.
 */
function sameStyleAttrs(a: InlineStyleAttrs | null, b: InlineStyleAttrs | null): boolean {
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
 * Segment for internal processing.
 */
interface EmitSegment {
  text: string;
  style: ExtractedRunStyle;
  isHardBreak: boolean;
  isTab: boolean;
}

/**
 * Emit a single run to LDOC text.
 * Does NOT include hard break/tab - those are handled separately.
 */
function emitRunText(run: ExtractedRun): string {
  return wrapEmphasis(run.text, run.style);
}

/**
 * Normalize character spacing: values below the significance threshold
 * (±20 twips = ±1pt) are treated as zero for comparison and merging.
 */
function normalizeCharSpacing(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  return Math.abs(v) > 20 ? v : undefined;
}

/**
 * Compare two run styles for equality.
 * Trivial character spacing differences (< 1pt) are ignored so that
 * runs differing only in kerning noise merge into a single run.
 */
function sameRunStyle(a: ExtractedRunStyle, b: ExtractedRunStyle): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.underline === b.underline &&
    a.code === b.code &&
    a.subscript === b.subscript &&
    a.superscript === b.superscript &&
    a.allCaps === b.allCaps &&
    a.smallCaps === b.smallCaps &&
    a.doubleStrike === b.doubleStrike &&
    a.font === b.font &&
    a.sizePt === b.sizePt &&
    a.color === b.color &&
    a.highlight === b.highlight &&
    normalizeCharSpacing(a.characterSpacing) === normalizeCharSpacing(b.characterSpacing) &&
    a.shadingFill === b.shadingFill
  );
}

/**
 * Merge adjacent text runs with identical styles.
 * DOCX often splits runs at arbitrary points (e.g., edit boundaries);
 * merging produces cleaner LDOC output like `**January 8**` instead of
 * `**January** **8**`.
 */
function mergeAdjacentRuns(content: ExtractedParagraphContent[]): ExtractedParagraphContent[] {
  const merged: ExtractedParagraphContent[] = [];

  for (const item of content) {
    const last = merged[merged.length - 1];
    if (
      isRun(item) &&
      last !== undefined &&
      isRun(last) &&
      sameRunStyle(item.style, last.style) &&
      !last.hardBreak &&
      !last.tab &&
      !item.tab
    ) {
      last.text += item.text;
      if (item.hardBreak) last.hardBreak = true;
    } else {
      merged.push({ ...item } as ExtractedParagraphContent);
    }
  }

  return merged;
}

/**
 * Emit paragraph content elements to LDOC inline text.
 * This is the main entry point for inline emission.
 */
export function emitInlineContent(
  content: ExtractedParagraphContent[],
  ctx: EmissionContext,
): string {
  const parts: string[] = [];
  content = mergeAdjacentRuns(content);

  for (const item of content) {
    if (isHyperlink(item)) {
      parts.push(emitHyperlink(item, ctx));
    } else if (isImage(item)) {
      parts.push(emitImage(item, ctx));
    } else if (isFootnote(item)) {
      parts.push(emitFootnote(item));
    } else if (isRun(item)) {
      parts.push(emitRun(item, ctx));
    }
  }

  return parts.join("");
}

/**
 * Emit a single run with possible @style wrapping.
 */
function emitRun(run: ExtractedRun, ctx: EmissionContext): string {
  const parts: string[] = [];

  // Tab character
  if (run.tab) {
    parts.push("@tab");
  }

  // Text content
  if (run.text) {
    const styleAttrs = getStyleAttrs(run.style, ctx.dominantStyle);
    const emphasized = wrapEmphasis(run.text, run.style);

    if (styleAttrs) {
      // Wrap in @style()[]
      const attrStr = formatStyleAttrs(styleAttrs);
      parts.push(`@style(${attrStr})[${emphasized}]`);
    } else {
      parts.push(emphasized);
    }
  }

  // Hard break
  if (run.hardBreak) {
    // Use @br for explicit hard breaks
    // This preserves the break through roundtrip
    parts.push("@br\n");
  }

  return parts.join("");
}

/**
 * Emit a hyperlink.
 */
function emitHyperlink(link: ExtractedHyperlink, ctx: EmissionContext): string {
  // Internal cross-reference
  if (link.anchor) {
    return `[[${link.anchor}]]`;
  }

  // External hyperlink
  if (link.url) {
    const textParts: string[] = [];
    for (const run of link.runs) {
      textParts.push(emitRun(run, ctx));
    }
    const text = textParts.join("");
    return `[${text}](${link.url})`;
  }

  // No URL - just emit the text
  const textParts: string[] = [];
  for (const run of link.runs) {
    textParts.push(emitRun(run, ctx));
  }
  return textParts.join("");
}

/**
 * Emit an image.
 */
function emitImage(img: ExtractedImage, ctx: EmissionContext): string {
  const path = ctx.rels?.get(img.rId);
  if (!path) return "";

  const alt = img.altText ?? "image";
  return `![${alt}](${path})`;
}

/**
 * Emit a footnote reference.
 */
function emitFootnote(fn: ExtractedFootnoteRef): string {
  return `[^${fn.id}]`;
}


