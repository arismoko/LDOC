// Table and Box compilation helpers for DOCX compiler

import {
  Paragraph,
  Table,
  TableRow,
  TableCell,
  Bookmark,
  BorderStyle,
  ShadingType,
  WidthType,
  TableLayoutType,
  VerticalAlign,
  convertInchesToTwip,
} from "docx";

import type { TableNode, ModifierNode, InlineNode, Node } from "../parser/ast";
import type { AlignmentType } from "docx";
import type { TextStyle } from "./styles";

/**
 * Context interface for table/box compilation.
 * Provides access to compiler methods needed for rendering.
 */
export interface TableCompilerContext {
  compileInlineNodes(nodes: InlineNode[], baseStyle?: TextStyle, scope?: string): any[];
  makeBookmarkParagraph(bookmarkIds: string[], indentLeftTwip?: number): Paragraph;
  compileNode(
    node: Node,
    style?: TextStyle,
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    indentLeftTwip?: number,
    forcedBookmarks?: string[]
  ): (Paragraph | Table)[];
}

/**
 * Default styling for @box modifier blocks.
 */
export const BOX_DEFAULTS = {
  border: {
    style: BorderStyle.SINGLE,
    // size is in eighths of a point; 8 = 1pt
    size: 8,
    color: "999999",
  },
  shading: {
    type: ShadingType.CLEAR,
    fill: "F5F5F5",
  },
  padding: {
    top: convertInchesToTwip(0.15),
    bottom: convertInchesToTwip(0.15),
    left: convertInchesToTwip(0.25),
    right: convertInchesToTwip(0.25),
  },
} as const;

/**
 * Compile a table node to a docx Table element.
 */
export function compileTable(
  ctx: TableCompilerContext,
  node: TableNode,
  forcedBookmarks?: string[],
  indentLeftTwip?: number
): Table {
  // Table styling defaults: legal grid with thin borders, light gray header, padding
  const tableBorder = {
    style: BorderStyle.SINGLE,
    size: 4, // 0.5pt (size is in eighths of a point)
    color: "000000",
  };

  const cellMargin = 120; // ~120 twips for padding

  let bookmarksForFirstRow = forcedBookmarks;

  const rows = node.rows.map((row, index) => {
    const isHeader = index === 0;
    const cells = row.cells.map((cellContent) => {
      let paragraphChildren: any[] = ctx.compileInlineNodes(
        cellContent,
        isHeader ? { bold: true } : {},
        (node as any).scope
      );
      if (bookmarksForFirstRow && bookmarksForFirstRow.length > 0 && index === 0) {
        for (let i = bookmarksForFirstRow.length - 1; i >= 0; i--) {
          paragraphChildren = [new Bookmark({ id: bookmarksForFirstRow[i]!, children: paragraphChildren })];
        }
        bookmarksForFirstRow = undefined;
      }
      return new TableCell({
        children: [
          new Paragraph({
            children: paragraphChildren,
          }),
        ],
        verticalAlign: VerticalAlign.TOP,
        shading: isHeader
          ? { type: ShadingType.CLEAR, fill: "F2F2F2" }
          : undefined,
      });
    });

    return new TableRow({
      children: cells,
      tableHeader: isHeader,
    });
  });

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
    indent: indentLeftTwip ? { size: indentLeftTwip, type: WidthType.DXA } : undefined,
    borders: {
      top: tableBorder,
      bottom: tableBorder,
      left: tableBorder,
      right: tableBorder,
      insideHorizontal: tableBorder,
      insideVertical: tableBorder,
    },
    margins: {
      top: cellMargin,
      bottom: cellMargin,
      left: cellMargin,
      right: cellMargin,
    },
  });
}

/**
 * Compile a @box modifier block to a docx Table element (styled as a box).
 */
export function compileBox(
  ctx: TableCompilerContext,
  node: ModifierNode,
  style: TextStyle,
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
  indentLeftTwip?: number,
  forcedBookmarks?: string[]
): Table {
  const children: (Paragraph | Table)[] = [];
  if (forcedBookmarks && forcedBookmarks.length > 0) {
    children.push(ctx.makeBookmarkParagraph(forcedBookmarks));
  }
  for (const child of node.content) {
    children.push(...ctx.compileNode(child, style, alignment, indentLeftTwip));
  }

  if (children.length === 0) {
    children.push(new Paragraph({}));
  }

  const border = {
    style: BOX_DEFAULTS.border.style,
    size: BOX_DEFAULTS.border.size,
    color: BOX_DEFAULTS.border.color,
  };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    indent: indentLeftTwip ? { size: indentLeftTwip, type: WidthType.DXA } : undefined,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            children,
            shading: BOX_DEFAULTS.shading,
            margins: BOX_DEFAULTS.padding,
            borders: {
              top: border,
              bottom: border,
              left: border,
              right: border,
            },
          }),
        ],
      }),
    ],
  });
}
