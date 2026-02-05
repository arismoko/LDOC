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
  VerticalMergeType,
  convertInchesToTwip,
} from "docx";

import type { TableNode, ModifierNode, InlineNode, Node, TableCellNode } from "../parser/ast";
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

  // Pre-process: convert rowspan to vMerge markers
  // Track which cells span into which rows
  // rowSpans[rowIdx][colIdx] = { remaining: N, sourceCell: cellNode } for cells that continue from above
  const numRows = node.rows.length;
  const rowSpans: Map<number, Map<number, { remaining: number; sourceRowIdx: number; sourceColIdx: number }>> = new Map();
  
  // Initialize
  for (let r = 0; r < numRows; r++) {
    rowSpans.set(r, new Map());
  }

  // First pass: mark rowspan starts
  for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
    const row = node.rows[rowIdx];
    if (!row) continue;
    let colIdx = 0;
    for (let cellIdx = 0; cellIdx < row.cells.length; cellIdx++) {
      // Skip columns that are occupied by rowspan from above
      while (rowSpans.get(rowIdx)?.has(colIdx)) {
        colIdx++;
      }
      
      const cell = row.cells[cellIdx];
      if (!cell) continue;
      
      const rspan = cell.rowspan || 1;
      const cspan = cell.colspan || 1;
      
      if (rspan > 1) {
        // Mark this cell as RESTART
        cell.vMerge = "restart";
        // Mark subsequent rows as CONTINUE
        for (let dr = 1; dr < rspan && rowIdx + dr < numRows; dr++) {
          for (let dc = 0; dc < cspan; dc++) {
            rowSpans.get(rowIdx + dr)?.set(colIdx + dc, { 
              remaining: rspan - dr, 
              sourceRowIdx: rowIdx, 
              sourceColIdx: colIdx + dc 
            });
          }
        }
      }
      
      colIdx += cspan;
    }
  }

  const rows = node.rows.map((row, rowIndex) => {
    const isHeader = row.isHeader;
    
    // Build cells, inserting continuation cells where needed
    const cells: TableCell[] = [];
    let colIdx = 0;
    let cellIdx = 0;
    
    // Determine max columns (approximate)
    const maxCols = Math.max(
      ...node.rows.map(r => r.cells.reduce((sum, c) => sum + (c.colspan || 1), 0))
    );
    
    while (colIdx < maxCols && (cellIdx < row.cells.length || rowSpans.get(rowIndex)?.has(colIdx))) {
      // Check if this column is occupied by a rowspan continuation
      const spanInfo = rowSpans.get(rowIndex)?.get(colIdx);
      
      if (spanInfo && cellIdx < row.cells.length) {
        // This column is taken by a rowspan continuation - insert a continuation cell
        const contCell = new TableCell({
          children: [new Paragraph({ spacing: { after: 0 } })],
          verticalAlign: VerticalAlign.TOP,
          verticalMerge: VerticalMergeType.CONTINUE,
        });
        cells.push(contCell);
        colIdx++;
        continue;
      }
      
      if (cellIdx >= row.cells.length) {
        // Check if there's a continuation cell needed
        if (spanInfo) {
          const contCell = new TableCell({
            children: [new Paragraph({ spacing: { after: 0 } })],
            verticalAlign: VerticalAlign.TOP,
            verticalMerge: VerticalMergeType.CONTINUE,
          });
          cells.push(contCell);
          colIdx++;
        }
        break;
      }
      
      const cellNode = row.cells[cellIdx];
      if (!cellNode) {
        cellIdx++;
        continue;
      }
      
      const cellChildren: (Paragraph | Table)[] = [];

      if (cellNode.content.length === 0) {
        cellChildren.push(new Paragraph({ spacing: { after: 0 } }));
      } else {
        cellNode.content.forEach((childNode, childIndex) => {
          let bookmarks: string[] | undefined = undefined;
          // Apply bookmarks only to the first paragraph of the first cell
          if (
            bookmarksForFirstRow &&
            bookmarksForFirstRow.length > 0 &&
            rowIndex === 0 &&
            cellIdx === 0 &&
            childIndex === 0
          ) {
            bookmarks = bookmarksForFirstRow;
            bookmarksForFirstRow = undefined;
          }

          cellChildren.push(...ctx.compileNode(
            childNode,
            isHeader ? { bold: true } : {},
            undefined,
            undefined,
            bookmarks
          ));
        });
      }

      // Build cell options
      const cellOptions: any = {
        children: cellChildren,
        verticalAlign: VerticalAlign.TOP,
        shading: isHeader
          ? { type: ShadingType.CLEAR, fill: "F2F2F2" }
          : undefined,
      };

      // Add colspan (columnSpan)
      if (cellNode.colspan > 1) {
        cellOptions.columnSpan = cellNode.colspan;
      }

      // Add vertical merge
      if (cellNode.vMerge === "restart") {
        cellOptions.verticalMerge = VerticalMergeType.RESTART;
      } else if (cellNode.vMerge === "continue") {
        cellOptions.verticalMerge = VerticalMergeType.CONTINUE;
      }

      cells.push(new TableCell(cellOptions));
      colIdx += cellNode.colspan || 1;
      cellIdx++;
    }

    return new TableRow({
      children: cells,
      tableHeader: isHeader,
    });
  });

  return new Table({
    rows,
    width: node.columnWidths 
      ? { size: node.columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA }
      : { size: 100, type: WidthType.PERCENTAGE },
    layout: node.columnWidths ? TableLayoutType.FIXED : TableLayoutType.AUTOFIT,
    columnWidths: node.columnWidths,
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
    layout: TableLayoutType.AUTOFIT,
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
