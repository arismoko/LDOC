import type { BaseNode } from "./base";
import type { Node } from "./index";

export type NumberingScheme = "default" | "decimal";

export interface MetaNode extends BaseNode {
  type: "meta";
  data: Record<string, any>;
  /** Whether the source had an explicit @end */
  hasEnd?: boolean;
  /** Number of blank lines after content (before @end or block end) */
  trailingBlanks?: number;
}

export interface ImportNode extends BaseNode {
  type: "import";
  path: string;
}

export interface DocumentNode extends BaseNode {
  type: "document";
  // Document-level settings/metadata from @document block
  document?: Record<string, any>;
  meta?: MetaNode;
  imports: ImportNode[];
  sourcePath?: string;
  // Numbering scheme: 'default' or 'decimal', defaults to 'default'
  numberingScheme?: NumberingScheme;
  body: Node[];
}

export type DocHeaderFooterScope = "default" | "first" | "even";

export interface DocHeaderFooterNode extends BaseNode {
  type: "doc_header" | "doc_footer";
  scope: DocHeaderFooterScope;
  content: Node[];
  /** Whether the source had an explicit @end */
  hasEnd?: boolean;
}

export type DocLayoutKind = "columns"; // margins, spacing, landscape now in @document block

export interface DocLayoutNode extends BaseNode {
  type: "doc_layout";
  kind: DocLayoutKind;
  // Raw args as written on the directive line
  args: string;
}

export interface DocStylesNode extends BaseNode {
  type: "doc_styles";
  // Target: body, heading, heading1..heading6, header, footer
  target: string;
  // Raw args as written on the directive line (key=value pairs)
  args: string;
}

export interface ColumnsRegionNode extends BaseNode {
  type: "columns_region";
  columnCount: number;
  /** Gap between columns in twips */
  gapTwip: number;
  /** Whether to show separator line between columns */
  separator: boolean;
  children: Node[];
  /** Whether the source had an explicit @end */
  hasEnd?: boolean;
}

export interface AnchorNode extends BaseNode {
  type: "anchor";
  name: string;
}
