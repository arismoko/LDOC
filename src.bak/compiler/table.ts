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
  HeightRule,
  convertInchesToTwip,
  TableBorders,
} from "docx";

import type { TableNode, ModifierNode, InlineNode, Node, TableCellNode } from "../parser/ast";
import type { AlignmentType } from "docx";
import type { TextStyle } from "./styles";
import { parseLengthToTwipCompiler } from "./parse";

function parseHexColor(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, "");
  const m = s.match(/^#?([0-9A-Fa-f]{6})$/);
  if (!m) return null;
  return (m[1] ?? "").toUpperCase();
}

function parseScalarLengthTwip(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim().replace(/^"|"$/g, "");
  if (!s) return undefined;
  if (/\s/.test(s)) {
    throw new Error(`Expected a single length value, got: ${raw}`);
  }
  return parseLengthToTwipCompiler(s);
}

function parseHeightRule(raw: string | undefined): (typeof HeightRule)[keyof typeof HeightRule] | undefined {
  if (!raw) return undefined;
  const s = raw.trim().replace(/^"|"$/g, "");
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower === "auto") return HeightRule.AUTO;
  if (lower === "atleast") return HeightRule.ATLEAST;
  if (lower === "exact") return HeightRule.EXACT;
  throw new Error(`Unknown heightRule: ${raw}`);
}

/** Cell margins in twips (top, right, bottom, left) */
interface CellMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Parse padding value to cell margins.
 * Accepts:
 *  - single length: "0.08in" -> all sides
 *  - [v, h] list: "[6pt, 12pt]" -> vertical, horizontal
 *  - [t, r, b, l] list: "[1pt, 2pt, 3pt, 4pt]"
 *  - legacy whitespace-separated: "6pt 12pt" (for robustness)
 */
function parsePadding(raw: string | undefined): CellMargins | undefined {
  if (!raw) return undefined;
  let s = raw.trim().replace(/^"|"$/g, "");
  if (!s) return undefined;

  // Handle list syntax: [v, h] or [t, r, b, l]
  const listMatch = s.match(/^\[(.+)\]$/);
  if (listMatch) {
    const items = listMatch[1]!.split(",").map(x => x.trim()).filter(Boolean);
    if (items.length === 2) {
      // [vertical, horizontal]
      const v = parseLengthToTwipCompiler(items[0]!);
      const h = parseLengthToTwipCompiler(items[1]!);
      return { top: v, bottom: v, left: h, right: h };
    } else if (items.length === 4) {
      // [top, right, bottom, left]
      return {
        top: parseLengthToTwipCompiler(items[0]!),
        right: parseLengthToTwipCompiler(items[1]!),
        bottom: parseLengthToTwipCompiler(items[2]!),
        left: parseLengthToTwipCompiler(items[3]!),
      };
    }
    throw new Error(`padding list must have 2 or 4 items, got: ${raw}`);
  }

  // Handle legacy whitespace-separated form: "6pt 12pt" etc.
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    // single value -> all sides
    const val = parseLengthToTwipCompiler(parts[0]!);
    return { top: val, right: val, bottom: val, left: val };
  } else if (parts.length === 2) {
    // [v, h]
    const v = parseLengthToTwipCompiler(parts[0]!);
    const h = parseLengthToTwipCompiler(parts[1]!);
    return { top: v, bottom: v, left: h, right: h };
  } else if (parts.length === 4) {
    // [t, r, b, l]
    return {
      top: parseLengthToTwipCompiler(parts[0]!),
      right: parseLengthToTwipCompiler(parts[1]!),
      bottom: parseLengthToTwipCompiler(parts[2]!),
      left: parseLengthToTwipCompiler(parts[3]!),
    };
  }
  throw new Error(`Invalid padding format: ${raw}`);
}

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

  // Optional table-level default padding
  const tableDefaultPadding = parsePadding(node.attributes?.padding);

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
      };

      // Cell-level background
      const cellAttrs = cellNode.attributes;
      if (cellAttrs?.background) {
        const bgColor = parseHexColor(cellAttrs.background);
        if (bgColor) {
          cellOptions.shading = { type: ShadingType.CLEAR, fill: bgColor };
        }
      }

      // Cell-level padding overrides table default
      const cellPadding = parsePadding(cellAttrs?.padding);
      if (cellPadding) {
        cellOptions.margins = cellPadding;
      } else if (tableDefaultPadding) {
        cellOptions.margins = tableDefaultPadding;
      }

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

    // Build row options with height/heightRule from row attributes
    const rowOptions: any = {
      children: cells,
      tableHeader: isHeader,
    };

    const rowAttrs = row.attributes;
    if (rowAttrs?.height) {
      const heightTwip = parseScalarLengthTwip(rowAttrs.height);
      if (heightTwip !== undefined) {
        const rule = parseHeightRule(rowAttrs.heightRule) ?? HeightRule.ATLEAST;
        rowOptions.height = { value: heightTwip, rule };
      }
    }

    return new TableRow(rowOptions);
  });

  return new Table({
    rows,
    width: node.columnWidths 
      ? { size: node.columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA }
      : { size: 100, type: WidthType.PERCENTAGE },
    layout: node.columnWidths ? TableLayoutType.FIXED : TableLayoutType.AUTOFIT,
    columnWidths: node.columnWidths,
    indent: (() => {
      const attrIndent = parseScalarLengthTwip(node.attributes?.indent);
      const base = (indentLeftTwip ?? 0) + (attrIndent ?? 0);
      return base > 0 ? { size: base, type: WidthType.DXA } : undefined;
    })(),
    // Tables are borderless by default (common for layout tables in legal docs).
    // Use @table(border: true) attribute to enable borders.
    // Must explicitly use TableBorders.NONE to prevent Word from using default styles.
    borders: node.attributes?.border ? {
      top: tableBorder,
      bottom: tableBorder,
      left: tableBorder,
      right: tableBorder,
      insideHorizontal: tableBorder,
      insideVertical: tableBorder,
    } : TableBorders.NONE,
    margins: tableDefaultPadding ? {
      top: tableDefaultPadding.top,
      bottom: tableDefaultPadding.bottom,
      left: tableDefaultPadding.left,
      right: tableDefaultPadding.right,
    } : undefined,
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
