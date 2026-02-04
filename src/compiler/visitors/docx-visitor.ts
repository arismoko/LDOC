import {
  Paragraph,
  Table,
  Bookmark,
  PageBreak,
  AlignmentType,
  convertInchesToTwip,
  type IParagraphOptions,
} from "docx";

import { parseLengthToTwip } from "../parse";

import type {
  Node,
  NodeVisitor,
  HeaderNode,
  NumberedItemNode,
  BulletItemNode,
  ModifierNode,
  EmptyParagraphNode,
  ParagraphNode,
  TableNode,
  BlankNode,
  PageBreakNode,
  CommentNode,
  DocHeaderFooterNode,
  DefineNode,
  ColumnsRegionNode,
  InlineNode,
} from "../../parser/ast";

import type { CompilationContext } from "../context";
import { getHeaderStyle, getHeadingStyle, getHeadingLevel, getBodyStyle, type TextStyle } from "../styles";
import { getNumberingReference, getListTextIndentTwip } from "../numbering";
import { compileTable, compileBox, type TableCompilerContext } from "../table";
import { inlineText } from "../text";
import { compileInlineNodes } from "./inline-visitor";

export class DocxNodeVisitor implements NodeVisitor<(Paragraph | Table)[]> {
  constructor(
    private ctx: CompilationContext,
    private forcedBookmarks?: string[],
    private currentStyle: TextStyle = {},
    private currentAlignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT,
    private currentIndent?: number
  ) {}

  // Helper to wrap content in bookmarks
  private wrapWithBookmarks(children: any[], bookmarkIds?: string[]): any[] {
    if (!bookmarkIds || bookmarkIds.length === 0) return children;
    let wrapped = children;
    for (let i = bookmarkIds.length - 1; i >= 0; i--) {
      wrapped = [new Bookmark({ id: bookmarkIds[i]!, children: wrapped })];
    }
    return wrapped;
  }

  // Helper to create bookmark paragraph
  private makeBookmarkParagraph(
    bookmarkIds: string[],
    indentLeftTwip?: number,
    applySpacing?: (opts: IParagraphOptions) => void
  ): Paragraph {
    return this.ctx.bookmarkManager.makeBookmarkParagraph(
      bookmarkIds,
      indentLeftTwip,
      applySpacing
    );
  }

  // Create a TableCompilerContext adapter
  private getTableContext(): TableCompilerContext {
    return {
      compileInlineNodes: (nodes: InlineNode[], style?: TextStyle, scope?: string) => 
        compileInlineNodes(nodes, this.ctx, { ...this.currentStyle, ...style }, scope),
      
      makeBookmarkParagraph: (ids, indent) => 
        this.makeBookmarkParagraph(ids, indent),
      
      compileNode: (node, style, alignment, indent, forcedBookmarks) => {
        const v = new DocxNodeVisitor(
          this.ctx,
          forcedBookmarks,
          { ...this.currentStyle, ...style },
          alignment || this.currentAlignment,
          indent || this.currentIndent
        );
        return v.visit(node);
      }
    };
  }

  visitHeader(node: HeaderNode): (Paragraph | Table)[] {
    const level = getHeadingLevel(node.level);
    const headingStyle = getHeadingStyle(this.ctx.styleConfig, node.level as any);
    
    // Compile inline content
    const children = compileInlineNodes(
      node.content,
      this.ctx,
      { ...this.currentStyle, ...headingStyle, heading: node.level } as TextStyle,
      node.scope
    );

    const text = inlineText(node.content);
    const anchor = this.ctx.bookmarkManager.getBookmark(text);
    
    let wrappedChildren = children;
    if (this.forcedBookmarks) {
      wrappedChildren = this.wrapWithBookmarks(wrappedChildren, this.forcedBookmarks);
    }
    if (anchor) {
      wrappedChildren = this.wrapWithBookmarks(wrappedChildren, [anchor]);
    }

    const paragraph = new Paragraph({
      children: wrappedChildren,
      heading: level,
      alignment: this.currentAlignment,
      indent: this.currentIndent ? { left: this.currentIndent } : undefined,
      spacing: this.ctx.defaultSpacing,
    });
    
    return [paragraph];
  }

  visitNumberedItem(node: NumberedItemNode): (Paragraph | Table)[] {
    const level = node.level - 1; // 0-based
    const ref = getNumberingReference(
      node.style,
      level,
      this.ctx.numberingScheme,
      this.ctx.styleMemory
    );
    
    // Reset style memory for deeper levels
    for (const [memLevel] of this.ctx.styleMemory) {
      if (memLevel > level) {
        this.ctx.styleMemory.delete(memLevel);
      }
    }

    const children = compileInlineNodes(
      node.content,
      this.ctx,
      { ...this.currentStyle, ...getBodyStyle(this.ctx.styleConfig) },
      node.scope
    );

    // Wrap bookmarks
    let wrappedChildren = children;
    if (this.forcedBookmarks) {
      wrappedChildren = this.wrapWithBookmarks(wrappedChildren, this.forcedBookmarks);
    }
    
    const indentTwip = getListTextIndentTwip(level);
    // Combine with currentIndent if any? Usually list items override indent.
    
    const paragraph = new Paragraph({
      children: wrappedChildren,
      numbering: {
        reference: ref,
        level: level,
      },
      alignment: this.currentAlignment,
      spacing: this.ctx.defaultSpacing,
    });

    const results: (Paragraph | Table)[] = [paragraph];

    // Recurse children
    for (const child of node.children) {
      const visitor = new DocxNodeVisitor(
        this.ctx, 
        undefined, 
        this.currentStyle, 
        this.currentAlignment, 
        this.currentIndent
      );
      const childResults = visitor.visit(child);
      results.push(...childResults);
    }

    return results;
  }

  visitBulletItem(node: BulletItemNode): (Paragraph | Table)[] {
    const children = compileInlineNodes(
      node.content,
      this.ctx,
      { ...this.currentStyle, ...getBodyStyle(this.ctx.styleConfig) },
      node.scope
    );

    let wrappedChildren = children;
    if (this.forcedBookmarks) {
      wrappedChildren = this.wrapWithBookmarks(wrappedChildren, this.forcedBookmarks);
    }

    const paragraph = new Paragraph({
      children: wrappedChildren,
      bullet: {
        level: node.level - 1,
      },
      alignment: this.currentAlignment,
      spacing: this.ctx.defaultSpacing,
    });

    const results: (Paragraph | Table)[] = [paragraph];

    for (const child of node.children) {
      const visitor = new DocxNodeVisitor(
        this.ctx,
        undefined,
        this.currentStyle,
        this.currentAlignment,
        this.currentIndent
      );
      results.push(...visitor.visit(child));
    }

    return results;
  }

  visitParagraph(node: ParagraphNode): (Paragraph | Table)[] {
    const children = compileInlineNodes(
      node.content,
      this.ctx,
      { ...this.currentStyle, ...getBodyStyle(this.ctx.styleConfig) },
      node.scope
    );

    let wrappedChildren = children;
    if (this.forcedBookmarks) {
      wrappedChildren = this.wrapWithBookmarks(wrappedChildren, this.forcedBookmarks);
    }

    const paragraph = new Paragraph({
      children: wrappedChildren,
      alignment: this.currentAlignment,
      indent: this.currentIndent ? { left: this.currentIndent } : undefined,
      spacing: this.ctx.defaultSpacing,
    });

    return [paragraph];
  }

  visitModifier(node: ModifierNode): (Paragraph | Table)[] {
    if (node.modifier === "box") {
      return [compileBox(
        this.getTableContext(),
        node,
        this.currentStyle,
        this.currentAlignment,
        this.currentIndent,
        this.forcedBookmarks
      )];
    }

    let nextAlignment = this.currentAlignment;
    if (node.modifier === "center") nextAlignment = AlignmentType.CENTER;
    if (node.modifier === "right") nextAlignment = AlignmentType.RIGHT;
    if (node.modifier === "justify" as any) nextAlignment = AlignmentType.JUSTIFIED;
    
    // Handle indent/outdent modifiers
    let nextIndent = this.currentIndent;
    if (node.modifier === "indent") {
      if (node.length) {
        nextIndent = (nextIndent ?? 0) + parseLengthToTwip(node.length);
      } else {
        nextIndent = (nextIndent ?? 0) + convertInchesToTwip(0.5 * (node.count ?? 1));
      }
    }
    if (node.modifier === "outdent") {
      if (node.length) {
        nextIndent = Math.max(0, (nextIndent ?? 0) - parseLengthToTwip(node.length));
      } else {
        nextIndent = Math.max(0, (nextIndent ?? 0) - convertInchesToTwip(0.5 * (node.count ?? 1)));
      }
    }

    // Handle style modifiers
    let nextStyle = { ...this.currentStyle };
    if (node.modifier === "bold") nextStyle.bold = true;
    if (node.modifier === "italic") nextStyle.italics = true;
    if (node.modifier === "small") nextStyle.smallCaps = true;
    if (node.modifier === "caps") nextStyle.allCaps = true;

    // Handle heading modifiers (h1-h6)
    const headingMatch = node.modifier.match(/^h([1-6])$/);
    if (headingMatch) {
      nextStyle.heading = parseInt(headingMatch[1]!, 10) as 1 | 2 | 3 | 4 | 5 | 6;
    }

    const results: (Paragraph | Table)[] = [];
    
    // If we have forced bookmarks on the modifier itself, we pass them to the first child?
    // Or wrap the whole result?
    // The original code passed forcedBookmarks to the first child of the modifier content.
    // We can replicate that by passing it to the visitor for the first child.
    
    let bookmarksToPass = this.forcedBookmarks;

    for (const child of node.content) {
      const v = new DocxNodeVisitor(
        this.ctx,
        bookmarksToPass,
        nextStyle,
        nextAlignment,
        nextIndent
      );
      // Only pass bookmarks to the first child
      bookmarksToPass = undefined;
      
      results.push(...v.visit(child));
    }
    
    return results;
  }

  visitTable(node: TableNode): (Paragraph | Table)[] {
    return [compileTable(
      this.getTableContext(),
      node,
      this.forcedBookmarks,
      this.currentIndent
    )];
  }

  visitEmptyParagraph(node: EmptyParagraphNode): (Paragraph | Table)[] {
    if (this.forcedBookmarks && this.forcedBookmarks.length > 0) {
      const first = this.makeBookmarkParagraph(
        this.forcedBookmarks,
        this.currentIndent,
        (opts) => { if (this.ctx.defaultSpacing) (opts as any).spacing = this.ctx.defaultSpacing; }
      );
      const rest = Array.from({ length: Math.max(0, node.count) }, () =>
        new Paragraph({ spacing: this.ctx.defaultSpacing })
      );
      return [first, ...rest];
    }
    return Array.from({ length: Math.max(0, node.count) }, () =>
      new Paragraph({ spacing: this.ctx.defaultSpacing })
    );
  }

  visitBlank(node: BlankNode): (Paragraph | Table)[] {
    return [new Paragraph({ text: "", spacing: this.ctx.defaultSpacing })];
  }

  visitPageBreak(node: PageBreakNode): (Paragraph | Table)[] {
    const pb = new Paragraph({ children: [new PageBreak()] });
    if (this.forcedBookmarks && this.forcedBookmarks.length > 0) {
      return [
        this.makeBookmarkParagraph(
          this.forcedBookmarks,
          this.currentIndent,
          (opts) => { if (this.ctx.defaultSpacing) (opts as any).spacing = this.ctx.defaultSpacing; }
        ),
        pb,
      ];
    }
    return [pb];
  }

  visitComment(node: CommentNode): (Paragraph | Table)[] {
    return [];
  }

  visitDocHeaderFooter(node: DocHeaderFooterNode): (Paragraph | Table)[] {
    throw new Error(`Misplaced @${node.type === "doc_header" ? "header" : "footer"}. Must be at top level.`);
  }

  visitDefine(node: DefineNode): (Paragraph | Table)[] {
    throw new Error(`Misplaced @define. Must be at top level.`);
  }

  visitColumnsRegion(node: ColumnsRegionNode): (Paragraph | Table)[] {
    throw new Error(`Misplaced @columns. Must be at top level.`);
  }

  visit(node: Node): (Paragraph | Table)[] {
    switch (node.type) {
      case "header": return this.visitHeader(node);
      case "numbered_item": return this.visitNumberedItem(node);
      case "bullet_item": return this.visitBulletItem(node);
      case "paragraph": return this.visitParagraph(node);
      case "modifier": return this.visitModifier(node);
      case "table": return this.visitTable(node);
      case "empty_paragraph": return this.visitEmptyParagraph(node);
      case "blank": return this.visitBlank(node);
      case "page_break": return this.visitPageBreak(node);
      case "comment": return this.visitComment(node);
      case "doc_header": return this.visitDocHeaderFooter(node);
      case "doc_footer": return this.visitDocHeaderFooter(node);
      case "define": return this.visitDefine(node);
      case "columns_region": return this.visitColumnsRegion(node);
      default:
        console.warn(`Unknown node type: ${(node as any).type}`);
        return [];
    }
  }
}
