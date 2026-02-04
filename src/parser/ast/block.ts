import type { BaseNode } from "./base";
import type { InlineNode } from "./inline";
import type { Node } from "./index";

export interface HeaderNode extends BaseNode {
  type: "header";
  level: number; // 1-6
  content: InlineNode[];
}

export type NumberingStyle =
  | { type: "decimal"; start?: number }
  | { type: "decimal_sub"; pattern: string } // "1.1", "1.1.1"
  | { type: "alpha_lower"; start?: string }
  | { type: "alpha_upper"; start?: string }
  | { type: "roman_lower"; start?: string }
  | { type: "roman_upper"; start?: string }
  | { type: "auto" };

export interface NumberedItemNode extends BaseNode {
  type: "numbered_item";
  level: number; // 1 = @, 2 = @@, etc.
  style: NumberingStyle;
  marker: string;
  content: InlineNode[];
  children: Node[];
}

export interface BulletItemNode extends BaseNode {
  type: "bullet_item";
  level: number;
  content: InlineNode[];
  children: Node[];
}

export type ModifierType =
  | "center"
  | "right"
  | "indent"
  | "outdent"
  | "box"
  | "bold"
  | "italic"
  | "small"
  | "caps"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6";

export interface ModifierNode extends BaseNode {
  type: "modifier";
  modifier: ModifierType;
  count?: number;
  length?: string;
  content: Node[];
}

export interface ParagraphNode extends BaseNode {
  type: "paragraph";
  content: InlineNode[];
}

export interface EmptyParagraphNode extends BaseNode {
  type: "empty_paragraph";
  // Number of consecutive blank lines to render
  count: number;
}

export interface TableRowNode extends BaseNode {
  type: "table_row";
  cells: InlineNode[][];
  isHeader: boolean;
}

export interface TableNode extends BaseNode {
  type: "table";
  rows: TableRowNode[];
}

export interface PageBreakNode extends BaseNode {
  type: "page_break";
}

export interface CommentNode extends BaseNode {
  type: "comment";
  value: string;
  isTodo: boolean;
}
