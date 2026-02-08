/**
 * Document IR (Intermediate Representation)
 * 
 * This is the CRITICAL abstraction in the pipeline:
 * - Output of EVALUATE phase (after Lua evaluation and expansion)
 * - Input to STYLE phase
 * - NO DIRECTIVES remain - only pure document content
 * - Format-agnostic - same representation regardless of output format
 * 
 * This is similar to Pandoc's AST or Typst's Content Tree.
 */

import type { SourceLocation } from "./source-location.ts";

// =============================================================================
// Base
// =============================================================================

interface IRBase {
  /** Source location for error reporting (may be synthetic after expansion) */
  loc?: SourceLocation;
}

// =============================================================================
// Document Root
// =============================================================================

export interface Document extends IRBase {
  type: "Document";
  metadata: DocumentMetadata;
  blocks: Block[];
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  date?: string;
  /** Custom metadata from @document directive */
  custom: Record<string, unknown>;
  /** Page layout settings */
  layout?: PageLayout;
  /** Document headers */
  headers?: HeaderFooterConfig;
  /** Document footers */
  footers?: HeaderFooterConfig;
}

export interface PageLayout {
  pageSize?: { width: number; height: number }; // in twips
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
  orientation?: "portrait" | "landscape";
}

// =============================================================================
// Style Reference (resolved in STYLE phase)
// =============================================================================

/**
 * Reference to a style. Resolved to concrete values in STYLE phase.
 */
export interface StyleRef {
  /** Named style (e.g., "Heading1", "MyCustomStyle") */
  name?: string;
  /** Inline style overrides */
  inline?: InlineStyleProps;
}

/**
 * Inline style properties that can be applied to any element.
 */
export interface InlineStyleProps {
  // Font
  fontFamily?: string;
  fontSize?: number; // in half-points for DOCX compatibility
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  smallCaps?: boolean;
  allCaps?: boolean;
  
  // Color
  color?: string; // hex color
  backgroundColor?: string;
  highlightColor?: string;
  
  // Spacing
  spaceBefore?: number; // in twips
  spaceAfter?: number;
  lineHeight?: number; // as multiplier (1.0 = single, 1.5 = 1.5x)
  
  // Alignment
  textAlign?: "left" | "center" | "right" | "justify";
  
  // Indentation
  indentLeft?: number; // in twips
  indentRight?: number;
  indentFirstLine?: number;
  indentHanging?: number;
  
  // Borders
  border?: BorderStyle;
  
  // Keep together
  keepWithNext?: boolean;
  keepTogether?: boolean;
  pageBreakBefore?: boolean;
}

export interface BorderStyle {
  top?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
  right?: BorderSide;
}

export interface BorderSide {
  width: number; // in points
  color: string;
  style: "single" | "double" | "dashed" | "dotted" | "none";
}

// =============================================================================
// Block Nodes
// =============================================================================

export interface Paragraph extends IRBase {
  type: "Paragraph";
  content: Inline[];
  style?: StyleRef;
}

export interface List extends IRBase {
  type: "List";
  ordered: boolean;
  items: ListItem[];
  style?: StyleRef;
  /** Numbering format for ordered lists */
  numberFormat?: "decimal" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman";
  /** Starting number */
  start?: number;
  /** Continue numbering from previous list */
  continue?: boolean;
}

export interface ListItem extends IRBase {
  type: "ListItem";
  content: Inline[];
  children: Block[]; // Nested blocks (including nested lists)
  style?: StyleRef;
}

export interface Table extends IRBase {
  type: "Table";
  rows: TableRow[];
  style?: StyleRef;
  /** Column widths in twips (optional - can be auto) */
  columnWidths?: number[];
}

export interface TableRow extends IRBase {
  type: "TableRow";
  cells: TableCell[];
  /** Is this a header row? */
  isHeader?: boolean;
  style?: StyleRef;
}

export interface TableCell extends IRBase {
  type: "TableCell";
  content: Block[];
  style?: StyleRef;
  /** Column span */
  colspan?: number;
  /** Row span */
  rowspan?: number;
  /** Vertical alignment */
  verticalAlign?: "top" | "center" | "bottom";
}

export interface Blockquote extends IRBase {
  type: "Blockquote";
  content: Block[];
  style?: StyleRef;
}

export interface Section extends IRBase {
  type: "Section";
  content: Block[];
  style?: StyleRef;
  /** Section break type */
  breakType?: "continuous" | "nextPage" | "evenPage" | "oddPage";
  /** Columns in this section */
  columns?: ColumnsConfig;
  /** Headers/footers for this section */
  headers?: HeaderFooterConfig;
  footers?: HeaderFooterConfig;
}

export interface ColumnsConfig {
  count: number;
  space?: number; // gap between columns in twips
  equalWidth?: boolean;
}

export interface HeaderFooterConfig {
  default?: HeaderFooter;
  first?: HeaderFooter;
  even?: HeaderFooter;
}

export interface HeaderFooter extends IRBase {
  type: "HeaderFooter";
  kind: "header" | "footer";
  content: Block[];
}

export interface PageBreak extends IRBase {
  type: "PageBreak";
}

export interface ColumnBreak extends IRBase {
  type: "ColumnBreak";
}

export interface HorizontalRule extends IRBase {
  type: "HorizontalRule";
  style?: StyleRef;
}

export interface Footnote extends IRBase {
  type: "Footnote";
  label: string;
  content: Block[];
}

export interface Anchor extends IRBase {
  type: "Anchor";
  id: string;
}

// =============================================================================
// Inline Nodes
// =============================================================================

export interface Text extends IRBase {
  type: "Text";
  value: string;
}

export interface Styled extends IRBase {
  type: "Styled";
  content: Inline[];
  style: InlineStyleProps;
}

export interface Bold extends IRBase {
  type: "Bold";
  content: Inline[];
}

export interface Italic extends IRBase {
  type: "Italic";
  content: Inline[];
}

export interface Underline extends IRBase {
  type: "Underline";
  content: Inline[];
}

export interface Strikethrough extends IRBase {
  type: "Strikethrough";
  content: Inline[];
}

export interface Highlight extends IRBase {
  type: "Highlight";
  content: Inline[];
  color?: string;
}

export interface Code extends IRBase {
  type: "Code";
  value: string;
}

export interface Link extends IRBase {
  type: "Link";
  content: Inline[];
  url: string;
  title?: string;
}

export interface Image extends IRBase {
  type: "Image";
  src: string;
  alt?: string;
  title?: string;
  width?: number; // in EMUs
  height?: number;
  /** Resolved image data (filled in during emit) */
  data?: Uint8Array;
}

export interface FootnoteRef extends IRBase {
  type: "FootnoteRef";
  label: string;
}

export interface CrossRef extends IRBase {
  type: "CrossRef";
  target: string;
  /** Display text (if different from target) */
  text?: string;
}

export interface HardBreak extends IRBase {
  type: "HardBreak";
}

export interface Tab extends IRBase {
  type: "Tab";
}

export interface Field extends IRBase {
  type: "Field";
  fieldType: "PAGE" | "NUMPAGES" | "DATE" | "TIME" | string;
  format?: string;
}

// =============================================================================
// Union Types
// =============================================================================

export type Inline =
  | Text
  | Styled
  | Bold
  | Italic
  | Underline
  | Strikethrough
  | Highlight
  | Code
  | Link
  | Image
  | FootnoteRef
  | CrossRef
  | HardBreak
  | Tab
  | Field;

export type Block =
  | Paragraph
  | List
  | Table
  | Blockquote
  | Section
  | PageBreak
  | ColumnBreak
  | HorizontalRule
  | Footnote
  | Anchor;

// =============================================================================
// Result Types
// =============================================================================

import type { Diagnostic } from "./diagnostics.ts";

export interface EvaluateResult {
  document: Document;
  diagnostics: Diagnostic[];
}
