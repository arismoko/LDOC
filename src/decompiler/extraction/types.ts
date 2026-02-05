/**
 * Extraction Layer Types
 *
 * These types represent raw data extracted from DOCX XML with minimal transformation.
 * No LDOC syntax is generated at this layer.
 *
 * Key principles:
 * - Hard breaks stay as boolean flags (not converted to \n)
 * - Tabs stay as boolean flags (not converted to @tab)
 * - No markdown/LDOC syntax (**bold**, @style, etc.)
 * - Whitespace normalized once during extraction
 * - Negative values allowed (e.g., character spacing)
 */

import type { HighlightColor } from "../../shared/highlight";

/**
 * Style properties for a text run.
 * These are raw values extracted from w:rPr.
 */
export interface ExtractedRunStyle {
  bold: boolean;
  italic: boolean;
  strike?: boolean;
  underline?: boolean;
  code?: boolean; // w:rFonts with monospace font
  subscript?: boolean;
  superscript?: boolean;
  allCaps?: boolean;
  smallCaps?: boolean;
  doubleStrike?: boolean;

  font?: string;
  sizePt?: number; // In points (not half-points)
  color?: string; // Hex without '#'
  highlight?: HighlightColor;
  characterSpacing?: number; // In twips, CAN BE NEGATIVE
  shadingFill?: string; // Hex without '#'
}

/**
 * A single text run extracted from DOCX.
 * Contains raw text and style, plus structural flags.
 */
export interface ExtractedRun {
  /** Raw text content (no markup) */
  text: string;

  /** Style properties */
  style: ExtractedRunStyle;

  /**
   * True if this run is followed by a hard break (w:br or w:cr).
   * The break is NOT included in `text` - it's a structural flag.
   */
  hardBreak: boolean;

  /**
   * True if this run represents a tab character (w:tab).
   * When true, `text` should be empty.
   */
  tab: boolean;
}

/**
 * Image extracted from a run (w:drawing or w:pict).
 */
export interface ExtractedImage {
  type: "image";
  /** Relationship ID for the image */
  rId: string;
  /** Alt text if available */
  altText?: string;
  /** Width in EMUs */
  widthEmu?: number;
  /** Height in EMUs */
  heightEmu?: number;
}

/**
 * Footnote reference extracted from a run.
 */
export interface ExtractedFootnoteRef {
  type: "footnote";
  id: string;
}

/**
 * A run-level element (text run, image, or footnote).
 */
export type ExtractedRunElement = ExtractedRun | ExtractedImage | ExtractedFootnoteRef;

/**
 * Hyperlink extracted from paragraph content.
 */
export interface ExtractedHyperlink {
  type: "hyperlink";
  /** External URL or undefined for internal links */
  url?: string;
  /** Internal anchor name for cross-references */
  anchor?: string;
  /** Runs within the hyperlink */
  runs: ExtractedRun[];
}

/**
 * A paragraph-level content element.
 */
export type ExtractedParagraphContent = ExtractedRunElement | ExtractedHyperlink;

/**
 * Numbering information for a list item.
 */
export interface ExtractedNumbering {
  numId: string;
  ilvl: number;
}

/**
 * A paragraph extracted from DOCX.
 */
export interface ExtractedParagraph {
  type: "paragraph";

  /** Content elements (runs, images, hyperlinks, footnotes) */
  content: ExtractedParagraphContent[];

  /** Paragraph style ID (e.g., "Heading1", "Normal") */
  styleId?: string;

  /** Numbering info if this is a list item */
  numbering?: ExtractedNumbering;

  /** Paragraph alignment */
  alignment?: "left" | "center" | "right" | "justify";

  /** Left indent in twips */
  indentLeftTwips?: number;

  /** Spacing before in twips */
  spacingBefore?: number;

  /** Spacing after in twips */
  spacingAfter?: number;

  /** Bookmark names (from w:bookmarkStart, excluding _ prefix) */
  bookmarks: string[];

  /** True if paragraph contains a page break */
  hasPageBreak: boolean;

  /** True if paragraph IS ONLY a page break (no other content) */
  isPageBreakOnly: boolean;
}

/**
 * Cell margins in twips.
 */
export interface ExtractedCellMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * A table cell extracted from DOCX.
 */
export interface ExtractedTableCell {
  /** Paragraphs within the cell */
  paragraphs: ExtractedParagraph[];

  /** Column span */
  colspan: number;

  /** Vertical merge status */
  vMerge: "restart" | "continue" | null;

  /** Computed row span (filled in during post-processing) */
  rowspan: number;

  /** True if this cell is covered by a rowspan from above */
  isCovered: boolean;

  /** Cell padding in twips */
  padding?: ExtractedCellMargins;

  /** Background color (hex without #) */
  background?: string;
}

/**
 * Row height specification.
 */
export interface ExtractedRowHeight {
  value: number; // In twips
  rule: "auto" | "atLeast" | "exact";
}

/**
 * A table row extracted from DOCX.
 */
export interface ExtractedTableRow {
  cells: ExtractedTableCell[];
  height?: ExtractedRowHeight;
  isHeader: boolean;
}

/**
 * A table extracted from DOCX.
 */
export interface ExtractedTable {
  type: "table";

  rows: ExtractedTableRow[];

  /** Column widths in twips */
  columnWidths?: number[];

  /** Table indent in twips */
  indent?: number;

  /** True if table has visible borders */
  hasBorders: boolean;
}

/**
 * A body-level element (paragraph or table).
 */
export type ExtractedBodyElement = ExtractedParagraph | ExtractedTable;

/**
 * Header/footer reference type.
 */
export type HeaderFooterType = "default" | "first" | "even";

/**
 * Header or footer content.
 */
export interface ExtractedHeaderFooter {
  type: HeaderFooterType;
  kind: "header" | "footer";
  content: ExtractedBodyElement[];
}

/**
 * Document layout information.
 */
export interface ExtractedLayout {
  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    header?: number;
    footer?: number;
  };
  landscape?: boolean;
}

/**
 * Document spacing defaults.
 */
export interface ExtractedSpacingDefaults {
  lineMultiplier?: number;
  beforeTwip?: number;
  afterTwip?: number;
  align?: "left" | "center" | "right" | "justify";
}

/**
 * Dominant style detected from document statistics.
 */
export interface ExtractedDominantStyle {
  font?: string;
  sizePt?: number;
}

/**
 * A complete document extracted from DOCX.
 */
export interface ExtractedDocument {
  /** Body content elements */
  body: ExtractedBodyElement[];

  /** Headers indexed by type */
  headers: Map<HeaderFooterType, ExtractedHeaderFooter>;

  /** Footers indexed by type */
  footers: Map<HeaderFooterType, ExtractedHeaderFooter>;

  /** Document layout */
  layout: ExtractedLayout;

  /** Spacing defaults from styles.xml */
  spacingDefaults?: ExtractedSpacingDefaults;

  /** Dominant style detected from body content */
  dominantStyle: ExtractedDominantStyle;

  /** Footnote definitions */
  footnotes: Map<string, ExtractedParagraph[]>;
}
