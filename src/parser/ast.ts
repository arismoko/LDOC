// AST Node types for Legal Document DSL

export type Node =
  | DocumentNode
  | DocHeaderFooterNode
  | DocLayoutNode
  | DocStylesNode
  | ColumnsRegionNode
  | AnchorNode
  | MetaNode
  | DefineNode
  | UseNode
  | IfNode
  | RepeatNode
  | ForeachNode
  | HeaderNode
  | NumberedItemNode
  | BulletItemNode
  | ModifierNode
  | EmptyParagraphNode
  | ParagraphNode
  | TableNode
  | TableRowNode
  | TextNode
  | VariableNode
  | CrossRefNode
  | DefinedTermNode
  | BlankNode
  | EmphasisNode
  | PageBreakNode
  | CommentNode
  | ImportNode
  ;

export interface BaseNode {
  type: string;
  line: number;
  column: number;
  // Used by template instantiation to scope anchors/refs.
  scope?: string;
}

export type NumberingScheme = "default" | "decimal";

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
}

export type DocLayoutKind = "margins" | "spacing" | "landscape" | "columns";

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
}

export interface AnchorNode extends BaseNode {
  type: "anchor";
  name: string;
}

export interface MetaNode extends BaseNode {
  type: "meta";
  data: Record<string, any>;
}

export interface ImportNode extends BaseNode {
  type: "import";
  path: string;
}

export interface DefineNode extends BaseNode {
  type: "define";
  name: string;
  // Params/template system is future work; MVP uses template only
  params: string[];
  optionalParams: Record<string, any>;
  template: Node[];
}

export interface UseNode extends BaseNode {
  type: "use";
  name: string;
  label?: string;
  args: Record<string, string>;
}

export interface IfNode extends BaseNode {
  type: "if";
  condition: string;
  thenBranch: Node[];
  elseBranch: Node[];
}

export interface RepeatNode extends BaseNode {
  type: "repeat";
  count: number;
  body: Node[];
}

export interface ForeachNode extends BaseNode {
  type: "foreach";
  item: string;
  // Path or identifier to iterate over (e.g. items, parties.signatories)
  iterable: string;
  body: Node[];
}

export interface HeaderNode extends BaseNode {
  type: "header";
  level: number; // 1-6
  content: InlineNode[];
}

export interface NumberedItemNode extends BaseNode {
  type: "numbered_item";
  level: number; // 1 = @, 2 = @@, etc.
  style: NumberingStyle;
  marker: string;
  content: InlineNode[];
  children: Node[];
}

export type NumberingStyle =
  | { type: "decimal"; start?: number }
  | { type: "decimal_sub"; pattern: string } // "1.1", "1.1.1"
  | { type: "alpha_lower"; start?: string }
  | { type: "alpha_upper"; start?: string }
  | { type: "roman_lower"; start?: string }
  | { type: "roman_upper"; start?: string }
  | { type: "auto" };

export interface BulletItemNode extends BaseNode {
  type: "bullet_item";
  level: number;
  content: InlineNode[];
  children: Node[];
}

export interface ModifierNode extends BaseNode {
  type: "modifier";
  modifier: ModifierType;
  count?: number;
  content: Node[];
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

export interface ParagraphNode extends BaseNode {
  type: "paragraph";
  content: InlineNode[];
}

export interface EmptyParagraphNode extends BaseNode {
  type: "empty_paragraph";
  // Number of consecutive blank lines to render
  count: number;
}

export interface TableNode extends BaseNode {
  type: "table";
  rows: TableRowNode[];
}

export interface TableRowNode extends BaseNode {
  type: "table_row";
  cells: InlineNode[][];
  isHeader: boolean;
}

// Inline nodes (can appear inside text)
export type InlineNode =
  | TextNode
  | VariableNode
  | CrossRefNode
  | DefinedTermNode
  | BlankNode
  | EmphasisNode;

export interface TextNode extends BaseNode {
  type: "text";
  value: string;
}

export interface VariableNode extends BaseNode {
  type: "variable";
  name: string;
  path: string[]; // For nested access like property.address
  filters: string[]; // For filters like | upper
}

export interface CrossRefNode extends BaseNode {
  type: "cross_ref";
  target: string;
}

export interface DefinedTermNode extends BaseNode {
  type: "defined_term";
  term: string;
  isDefinition: boolean; // First occurrence = definition
}

export interface BlankNode extends BaseNode {
  type: "blank";
  length: number; // Number of underscores
}

export interface EmphasisNode extends BaseNode {
  type: "emphasis";
  style: "bold" | "italic" | "bold_italic";
  content: InlineNode[];
}

export interface PageBreakNode extends BaseNode {
  type: "page_break";
}

export interface CommentNode extends BaseNode {
  type: "comment";
  value: string;
  isTodo: boolean;
}

// Helper to create nodes
export function createNode<T extends Node>(
  type: T["type"],
  line: number,
  column: number,
  props: Omit<T, "type" | "line" | "column">
): T {
  return { type, line, column, ...props } as T;
}

// Visitor pattern for AST traversal
export interface NodeVisitor<T = void> {
  visitDocument?(node: DocumentNode): T;
  visitDocHeaderFooter?(node: DocHeaderFooterNode): T;
  visitDocLayout?(node: DocLayoutNode): T;
  visitDocStyles?(node: DocStylesNode): T;
  visitColumnsRegion?(node: ColumnsRegionNode): T;
  visitAnchor?(node: AnchorNode): T;
  visitMeta?(node: MetaNode): T;
  visitImport?(node: ImportNode): T;
  visitDefine?(node: DefineNode): T;
  visitUse?(node: UseNode): T;
  visitIf?(node: IfNode): T;
  visitRepeat?(node: RepeatNode): T;
  visitForeach?(node: ForeachNode): T;
  visitHeader?(node: HeaderNode): T;
  visitNumberedItem?(node: NumberedItemNode): T;
  visitBulletItem?(node: BulletItemNode): T;
  visitModifier?(node: ModifierNode): T;
  visitParagraph?(node: ParagraphNode): T;
  visitEmptyParagraph?(node: EmptyParagraphNode): T;
  visitTable?(node: TableNode): T;
  visitTableRow?(node: TableRowNode): T;
  visitText?(node: TextNode): T;
  visitVariable?(node: VariableNode): T;
  visitCrossRef?(node: CrossRefNode): T;
  visitDefinedTerm?(node: DefinedTermNode): T;
  visitBlank?(node: BlankNode): T;
  visitEmphasis?(node: EmphasisNode): T;
  visitPageBreak?(node: PageBreakNode): T;
  visitComment?(node: CommentNode): T;
}

export function visit<T>(node: Node, visitor: NodeVisitor<T>): T | undefined {
  switch (node.type) {
    case "document":
      return visitor.visitDocument?.(node);
    case "doc_header":
    case "doc_footer":
      return visitor.visitDocHeaderFooter?.(node as DocHeaderFooterNode);
    case "doc_layout":
      return visitor.visitDocLayout?.(node as DocLayoutNode);
    case "doc_styles":
      return visitor.visitDocStyles?.(node as DocStylesNode);
    case "columns_region":
      return visitor.visitColumnsRegion?.(node as ColumnsRegionNode);
    case "anchor":
      return visitor.visitAnchor?.(node as AnchorNode);
    case "meta":
      return visitor.visitMeta?.(node);
    case "import":
      return visitor.visitImport?.(node);
    case "define":
      return visitor.visitDefine?.(node);
    case "use":
      return visitor.visitUse?.(node);
    case "if":
      return visitor.visitIf?.(node as IfNode);
    case "repeat":
      return visitor.visitRepeat?.(node as RepeatNode);
    case "foreach":
      return visitor.visitForeach?.(node as ForeachNode);
    case "header":
      return visitor.visitHeader?.(node);
    case "numbered_item":
      return visitor.visitNumberedItem?.(node);
    case "bullet_item":
      return visitor.visitBulletItem?.(node);
    case "modifier":
      return visitor.visitModifier?.(node);
    case "paragraph":
      return visitor.visitParagraph?.(node);
    case "empty_paragraph":
      return visitor.visitEmptyParagraph?.(node);
    case "table":
      return visitor.visitTable?.(node);
    case "table_row":
      return visitor.visitTableRow?.(node);
    case "text":
      return visitor.visitText?.(node);
    case "variable":
      return visitor.visitVariable?.(node);
    case "cross_ref":
      return visitor.visitCrossRef?.(node);
    case "defined_term":
      return visitor.visitDefinedTerm?.(node);
    case "blank":
      return visitor.visitBlank?.(node);
    case "emphasis":
      return visitor.visitEmphasis?.(node);
    case "page_break":
      return visitor.visitPageBreak?.(node);
    case "comment":
      return visitor.visitComment?.(node);
  }
}

export function walkTree(node: Node, callback: (node: Node) => void): void {
  callback(node);

  if ("content" in node && Array.isArray(node.content)) {
    for (const child of node.content) {
      walkTree(child as Node, callback);
    }
  }

  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      walkTree(child, callback);
    }
  }

  if ("body" in node && Array.isArray(node.body)) {
    for (const child of node.body) {
      walkTree(child, callback);
    }
  }

  if ("rows" in node && Array.isArray(node.rows)) {
    for (const row of node.rows) {
      walkTree(row, callback);
    }
  }
}
