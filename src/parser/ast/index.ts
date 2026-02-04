import type {
  DocumentNode,
  DocHeaderFooterNode,
  DocLayoutNode,
  DocStylesNode,
  ColumnsRegionNode,
  AnchorNode,
  MetaNode,
  ImportNode,
} from "./structure";
import type {
  DefineNode,
  UseNode,
  IfNode,
  RepeatNode,
  ForeachNode,
  SetNode,
} from "./control";
import type {
  HeaderNode,
  NumberedItemNode,
  BulletItemNode,
  ModifierNode,
  EmptyParagraphNode,
  ParagraphNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  PageBreakNode,
  CommentNode,
  BlockquoteNode,
  HorizontalRuleNode,
  FootnoteDefinitionNode,
  ColumnBreakNode,
} from "./block";

import type {
  TextNode,
  VariableNode,
  CrossRefNode,
  DefinedTermNode,
  BlankNode,
  EmphasisNode,
  LinkNode,
  ImageNode,
  StrikethroughNode,
  InlineCodeNode,
  FootnoteReferenceNode,
  InlineStyleNode,
} from "./inline";

export * from "./base";
export * from "./inline";
export * from "./block";
export * from "./structure";
export * from "./control";

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
  | SetNode
  | HeaderNode
  | BlockquoteNode
  | HorizontalRuleNode
  | FootnoteDefinitionNode
  | NumberedItemNode
  | BulletItemNode
  | ModifierNode
  | EmptyParagraphNode
  | ParagraphNode
  | TableNode
  | TableRowNode
  | TableCellNode
  | TextNode
  | LinkNode
  | ImageNode
  | StrikethroughNode
  | InlineCodeNode
  | FootnoteReferenceNode
  | VariableNode
  | CrossRefNode
  | DefinedTermNode
  | BlankNode
  | EmphasisNode
  | PageBreakNode
  | CommentNode
  | ColumnBreakNode
  | InlineStyleNode
  | ImportNode;

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
  visitSet?(node: SetNode): T;
  visitHeader?(node: HeaderNode): T;
  visitBlockquote?(node: BlockquoteNode): T;
  visitHorizontalRule?(node: HorizontalRuleNode): T;
  visitFootnoteDefinition?(node: FootnoteDefinitionNode): T;
  visitNumberedItem?(node: NumberedItemNode): T;
  visitBulletItem?(node: BulletItemNode): T;
  visitModifier?(node: ModifierNode): T;
  visitParagraph?(node: ParagraphNode): T;
  visitEmptyParagraph?(node: EmptyParagraphNode): T;
  visitTable?(node: TableNode): T;
  visitTableRow?(node: TableRowNode): T;
  visitText?(node: TextNode): T;
  visitLink?(node: LinkNode): T;
  visitImage?(node: ImageNode): T;
  visitStrikethrough?(node: StrikethroughNode): T;
  visitInlineCode?(node: InlineCodeNode): T;
  visitFootnoteReference?(node: FootnoteReferenceNode): T;
  visitVariable?(node: VariableNode): T;
  visitCrossRef?(node: CrossRefNode): T;
  visitDefinedTerm?(node: DefinedTermNode): T;
  visitBlank?(node: BlankNode): T;
  visitEmphasis?(node: EmphasisNode): T;
  visitPageBreak?(node: PageBreakNode): T;
  visitColumnBreak?(node: ColumnBreakNode): T;
  visitComment?(node: CommentNode): T;
  visitInlineStyle?(node: InlineStyleNode): T;
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
    case "set":
      return visitor.visitSet?.(node as SetNode);
    case "header":
      return visitor.visitHeader?.(node);
    case "blockquote":
      return visitor.visitBlockquote?.(node);
    case "horizontal_rule":
      return visitor.visitHorizontalRule?.(node);
    case "footnote_def":
      return visitor.visitFootnoteDefinition?.(node);
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
    case "link":
      return visitor.visitLink?.(node);
    case "image":
      return visitor.visitImage?.(node);
    case "strikethrough":
      return visitor.visitStrikethrough?.(node);
    case "inline_code":
      return visitor.visitInlineCode?.(node);
    case "footnote_ref":
      return visitor.visitFootnoteReference?.(node);
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
    case "column_break":
      return visitor.visitColumnBreak?.(node);
    case "comment":
      return visitor.visitComment?.(node);
    case "inline_style":
      return visitor.visitInlineStyle?.(node);
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
