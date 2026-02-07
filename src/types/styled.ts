/**
 * Styled Document types.
 * 
 * Output of the STYLE phase:
 * - Every node has concrete, computed styles
 * - All StyleRefs have been resolved to ComputedStyle
 * - Ready for format-specific emission
 */

import type { Document, Block, Inline, InlineStyleProps, StyleRef } from "./document-ir.ts";
import type { Diagnostic } from "./diagnostics.ts";

// =============================================================================
// Style Resolver Function
// =============================================================================

/**
 * Function that resolves a StyleRef to a ComputedStyle.
 * Passed to EMIT phase so it can resolve styles on-demand.
 */
export type StyleResolver = (styleRef: StyleRef) => ComputedStyle;

// =============================================================================
// Computed Style
// =============================================================================

/**
 * Fully resolved style with all properties computed.
 * No more references - all values are concrete.
 */
export interface ComputedStyle {
  // Font
  fontFamily: string;
  fontSize: number; // in half-points
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  smallCaps: boolean;
  allCaps: boolean;
  
  // Color
  color: string; // hex, e.g., "000000"
  backgroundColor: string | null;
  highlightColor: string | null;
  
  // Paragraph spacing (only for block elements)
  spaceBefore: number; // in twips
  spaceAfter: number;
  lineHeight: number; // as 240ths (240 = single line)
  
  // Alignment
  textAlign: "left" | "center" | "right" | "justify";
  
  // Indentation
  indentLeft: number; // in twips
  indentRight: number;
  indentFirstLine: number;
  indentHanging: number;
  
  // Borders (null if none)
  borderTop: ComputedBorder | null;
  borderBottom: ComputedBorder | null;
  borderLeft: ComputedBorder | null;
  borderRight: ComputedBorder | null;
  
  // Keep
  keepWithNext: boolean;
  keepTogether: boolean;
  pageBreakBefore: boolean;
  
  // Paragraph style name (for DOCX style references)
  paragraphStyleId: string | null;
  // Character style name
  characterStyleId: string | null;
}

export interface ComputedBorder {
  width: number; // in eighths of a point
  color: string;
  style: "single" | "double" | "dashed" | "dotted" | "none";
}

/**
 * Default computed style values.
 */
export const DEFAULT_STYLE: ComputedStyle = {
  fontFamily: "Times New Roman",
  fontSize: 24, // 12pt in half-points
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  smallCaps: false,
  allCaps: false,
  color: "000000",
  backgroundColor: null,
  highlightColor: null,
  spaceBefore: 0,
  spaceAfter: 0,
  lineHeight: 240,
  textAlign: "left",
  indentLeft: 0,
  indentRight: 0,
  indentFirstLine: 0,
  indentHanging: 0,
  borderTop: null,
  borderBottom: null,
  borderLeft: null,
  borderRight: null,
  keepWithNext: false,
  keepTogether: false,
  pageBreakBefore: false,
  paragraphStyleId: null,
  characterStyleId: null,
};

// =============================================================================
// Styled Nodes
// =============================================================================

/**
 * A block with computed style attached.
 */
export interface StyledBlock {
  node: Block;
  style: ComputedStyle;
}

/**
 * An inline with computed style attached.
 */
export interface StyledInline {
  node: Inline;
  style: ComputedStyle;
}

// =============================================================================
// Styled Document
// =============================================================================

export interface StyledDocument {
  /** Original document with style refs */
  document: Document;
  /** Document-level styles */
  documentStyles: DocumentStyles;
  /** Style definitions for DOCX styles.xml */
  styleDefinitions: StyleDefinition[];
  /** Numbering definitions for DOCX numbering.xml */
  numberingDefinitions: NumberingDefinition[];
  /** Resolve any StyleRef to concrete ComputedStyle */
  resolveStyle: StyleResolver;
}

export interface DocumentStyles {
  /** Default paragraph style */
  defaultParagraph: ComputedStyle;
  /** Default character style */
  defaultCharacter: Partial<ComputedStyle>;
  /** Page layout */
  pageWidth: number; // in twips
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

export interface StyleDefinition {
  id: string;
  name: string;
  type: "paragraph" | "character" | "table";
  basedOn?: string;
  style: Partial<ComputedStyle>;
}

export interface NumberingDefinition {
  id: string;
  levels: NumberingLevel[];
}

export interface NumberingLevel {
  level: number;
  format: "decimal" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman" | "bullet";
  text: string; // e.g., "%1." or "%1.%2."
  indent: number;
  hanging: number;
  /** Starting number (defaults to 1) */
  start?: number;
}

// =============================================================================
// Style Result
// =============================================================================

export interface StyleResult {
  styledDocument: StyledDocument;
  diagnostics: Diagnostic[];
}

// =============================================================================
// Helper: Apply inline styles to computed style
// =============================================================================

export function applyInlineStyles(
  base: ComputedStyle,
  inline: InlineStyleProps
): ComputedStyle {
  return {
    ...base,
    fontFamily: inline.fontFamily ?? base.fontFamily,
    fontSize: inline.fontSize ?? base.fontSize,
    bold: inline.bold ?? base.bold,
    italic: inline.italic ?? base.italic,
    underline: inline.underline ?? base.underline,
    strikethrough: inline.strikethrough ?? base.strikethrough,
    smallCaps: inline.smallCaps ?? base.smallCaps,
    allCaps: inline.allCaps ?? base.allCaps,
    color: inline.color ?? base.color,
    backgroundColor: inline.backgroundColor ?? base.backgroundColor,
    highlightColor: inline.highlightColor ?? base.highlightColor,
    spaceBefore: inline.spaceBefore ?? base.spaceBefore,
    spaceAfter: inline.spaceAfter ?? base.spaceAfter,
    lineHeight: inline.lineHeight ?? base.lineHeight,
    textAlign: inline.textAlign ?? base.textAlign,
    indentLeft: inline.indentLeft ?? base.indentLeft,
    indentRight: inline.indentRight ?? base.indentRight,
    indentFirstLine: inline.indentFirstLine ?? base.indentFirstLine,
    indentHanging: inline.indentHanging ?? base.indentHanging,
    keepWithNext: inline.keepWithNext ?? base.keepWithNext,
    keepTogether: inline.keepTogether ?? base.keepTogether,
    pageBreakBefore: inline.pageBreakBefore ?? base.pageBreakBefore,
    // Borders would need more complex merging
    borderTop: base.borderTop,
    borderBottom: base.borderBottom,
    borderLeft: base.borderLeft,
    borderRight: base.borderRight,
    paragraphStyleId: base.paragraphStyleId,
    characterStyleId: base.characterStyleId,
  };
}
