/**
 * DOCX Style Conversion
 * 
 * Converts ComputedStyle to docx paragraph and run options.
 */

import { AlignmentType, BorderStyle, UnderlineType } from "docx";
import type { 
  IParagraphOptions, 
  IRunOptions, 
  IBorderOptions,
  IParagraphStyleOptions,
} from "docx";
import type { ComputedStyle, ComputedBorder, StyleDefinition } from "../../types/styled.ts";
import { type Mutable } from "./utils.ts";

// =============================================================================
// Helpers
// =============================================================================

/** Set a property only if the value is truthy */
function setIf<T, K extends keyof T>(
  obj: T,
  key: K,
  value: T[K] | undefined | false | null
): void {
  if (value !== undefined && value !== false && value !== null) {
    obj[key] = value;
  }
}

// =============================================================================
// Run Options (Text Formatting)
// =============================================================================

/**
 * Convert ComputedStyle to docx run options (text formatting).
 */
export function toRunOptions(style: ComputedStyle): IRunOptions {
  const opts: Mutable<IRunOptions> = {
    font: style.fontFamily,
    size: style.fontSize, // Already in half-points
  };

  // Formatting flags
  setIf(opts, "bold", style.bold);
  setIf(opts, "italics", style.italic);
  setIf(opts, "underline", style.underline && { type: UnderlineType.SINGLE });
  setIf(opts, "strike", style.strikethrough);
  setIf(opts, "smallCaps", style.smallCaps);
  setIf(opts, "allCaps", style.allCaps);

  // Color - only set if not default black
  setIf(opts, "color", style.color !== "000000" && style.color);
  setIf(opts, "highlight", style.highlightColor as IRunOptions["highlight"]);
  if (style.backgroundColor) {
    opts.shading = { fill: style.backgroundColor };
  }

  // Character style reference
  setIf(opts, "style", style.characterStyleId);

  return opts;
}

// =============================================================================
// Paragraph Options
// =============================================================================

/**
 * Convert ComputedStyle to docx paragraph options.
 */
export function toParagraphOptions(style: ComputedStyle): IParagraphOptions {
  const opts: Mutable<IParagraphOptions> = {};

  // Alignment
  setIf(opts, "alignment", toAlignment(style.textAlign));

  // Spacing - only set if non-zero
  const hasSpacing = style.spaceBefore > 0 || style.spaceAfter > 0 || style.lineHeight !== 240;
  if (hasSpacing) {
    opts.spacing = {
      before: style.spaceBefore > 0 ? style.spaceBefore : undefined,
      after: style.spaceAfter > 0 ? style.spaceAfter : undefined,
      line: style.lineHeight !== 240 ? style.lineHeight : undefined,
    };
  }

  // Indentation - only set if non-zero
  const hasIndent = style.indentLeft > 0 || style.indentRight > 0 || 
                    style.indentFirstLine > 0 || style.indentHanging > 0;
  if (hasIndent) {
    opts.indent = {
      left: style.indentLeft > 0 ? style.indentLeft : undefined,
      right: style.indentRight > 0 ? style.indentRight : undefined,
      firstLine: style.indentFirstLine > 0 ? style.indentFirstLine : undefined,
      hanging: style.indentHanging > 0 ? style.indentHanging : undefined,
    };
  }

  // Borders
  const border = toBorderOptions(style);
  setIf(opts, "border", border);

  // Keep properties
  setIf(opts, "keepNext", style.keepWithNext);
  setIf(opts, "keepLines", style.keepTogether);
  setIf(opts, "pageBreakBefore", style.pageBreakBefore);

  // Paragraph style reference
  setIf(opts, "style", style.paragraphStyleId);

  // Paragraph shading (background color at paragraph level)
  if (style.backgroundColor) {
    opts.shading = { fill: style.backgroundColor };
  }

  return opts;
}

// =============================================================================
// Alignment Conversion
// =============================================================================

/**
 * Convert text alignment to docx AlignmentType.
 */
function toAlignment(align: ComputedStyle["textAlign"]): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (align) {
    case "left": return AlignmentType.LEFT;
    case "center": return AlignmentType.CENTER;
    case "right": return AlignmentType.RIGHT;
    case "justify": return AlignmentType.JUSTIFIED;
    default: return undefined;
  }
}

// =============================================================================
// Border Conversion
// =============================================================================

/**
 * Convert computed borders to docx border options.
 */
function toBorderOptions(style: ComputedStyle): IParagraphOptions["border"] | undefined {
  const hasBorder = style.borderTop || style.borderBottom || style.borderLeft || style.borderRight;
  if (!hasBorder) return undefined;

  const border: Mutable<NonNullable<IParagraphOptions["border"]>> = {};
  if (style.borderTop) border.top = toBorder(style.borderTop);
  if (style.borderBottom) border.bottom = toBorder(style.borderBottom);
  if (style.borderLeft) border.left = toBorder(style.borderLeft);
  if (style.borderRight) border.right = toBorder(style.borderRight);
  
  return border;
}

/**
 * Convert single border to docx format.
 */
function toBorder(border: ComputedBorder): IBorderOptions {
  return {
    color: border.color,
    size: border.width * 8, // Convert points to eighths
    style: toBorderStyle(border.style),
    space: 1,
  };
}

/**
 * Convert border style to docx BorderStyle.
 */
function toBorderStyle(style: ComputedBorder["style"]): (typeof BorderStyle)[keyof typeof BorderStyle] {
  switch (style) {
    case "single": return BorderStyle.SINGLE;
    case "double": return BorderStyle.DOUBLE;
    case "dashed": return BorderStyle.DASHED;
    case "dotted": return BorderStyle.DOTTED;
    case "none": return BorderStyle.NONE;
    default: return BorderStyle.SINGLE;
  }
}

// =============================================================================
// Style Definitions (for styles.xml)
// =============================================================================

/**
 * Convert StyleDefinition to docx paragraph style options.
 */
export function toStyleDefinition(def: StyleDefinition): IParagraphStyleOptions {
  const run: Mutable<IRunOptions> = {};
  const paragraph: Mutable<IParagraphOptions> = {};
  const style = def.style;

  // Run properties
  setIf(run, "font", style.fontFamily);
  setIf(run, "size", style.fontSize);
  setIf(run, "bold", style.bold);
  setIf(run, "italics", style.italic);
  setIf(run, "underline", style.underline && { type: UnderlineType.SINGLE });
  setIf(run, "strike", style.strikethrough);
  setIf(run, "smallCaps", style.smallCaps);
  setIf(run, "allCaps", style.allCaps);
  setIf(run, "color", style.color);
  setIf(run, "highlight", style.highlightColor as IRunOptions["highlight"]);
  if (style.backgroundColor) {
    run.shading = { fill: style.backgroundColor };
  }

  // Paragraph alignment
  if (style.textAlign) {
    paragraph.alignment = toAlignment(style.textAlign);
  }

  // Paragraph spacing
  if (style.spaceBefore !== undefined || style.spaceAfter !== undefined || style.lineHeight !== undefined) {
    paragraph.spacing = {
      before: style.spaceBefore,
      after: style.spaceAfter,
      line: style.lineHeight,
    };
  }

  // Paragraph indentation
  if (style.indentLeft !== undefined || style.indentRight !== undefined ||
      style.indentFirstLine !== undefined || style.indentHanging !== undefined) {
    paragraph.indent = {
      left: style.indentLeft,
      right: style.indentRight,
      firstLine: style.indentFirstLine,
      hanging: style.indentHanging,
    };
  }

  // Paragraph borders
  const hasBorder = style.borderTop || style.borderBottom || style.borderLeft || style.borderRight;
  if (hasBorder) {
    const border: Mutable<NonNullable<IParagraphOptions["border"]>> = {};
    if (style.borderTop) border.top = toBorder(style.borderTop);
    if (style.borderBottom) border.bottom = toBorder(style.borderBottom);
    if (style.borderLeft) border.left = toBorder(style.borderLeft);
    if (style.borderRight) border.right = toBorder(style.borderRight);
    paragraph.border = border;
  }

  // Keep properties
  setIf(paragraph, "keepNext", style.keepWithNext);
  setIf(paragraph, "keepLines", style.keepTogether);
  setIf(paragraph, "pageBreakBefore", style.pageBreakBefore);

  return {
    id: def.id,
    name: def.name,
    basedOn: def.basedOn,
    run,
    paragraph,
  };
}
