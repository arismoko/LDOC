/**
 * DOCX Table Emission
 * 
 * Converts Document IR Table nodes to docx Table objects.
 */

import {
  Table,
  TableRow,
  TableCell,
  Paragraph,
  WidthType,
  BorderStyle,
  TableLayoutType,
} from "docx";
import type { TableVerticalAlign } from "docx";

import type {
  Table as TableNode,
  TableRow as TableRowNode,
  TableCell as TableCellNode,
} from "../../types/document-ir.ts";
import type { EmitContext, DocxBlock } from "./nodes.ts";
import { emitBlocks } from "./nodes.ts";

// =============================================================================
// Table Emission
// =============================================================================

/**
 * Emit a Table IR node to docx Table.
 */
export function emitTable(node: TableNode, ctx: EmitContext): Table {
  const rows = node.rows.map((row) => emitTableRow(row, node, ctx));
  
  return new Table({
    rows,
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    layout: TableLayoutType.AUTOFIT,
    columnWidths: node.columnWidths,
  });
}

/**
 * Emit a TableRow IR node to docx TableRow.
 */
function emitTableRow(node: TableRowNode, table: TableNode, ctx: EmitContext): TableRow {
  const emittedCells = node.cells.map((cell) => emitTableCell(cell, table, ctx));
  const cells = emittedCells.length > 0 ? emittedCells : [new TableCell({ children: [new Paragraph({})] })];
  
  return new TableRow({
    children: cells,
    tableHeader: node.isHeader,
    cantSplit: node.cantSplit,
  });
}

/**
 * Emit a TableCell IR node to docx TableCell.
 */
function emitTableCell(node: TableCellNode, table: TableNode, ctx: EmitContext): TableCell {
  // Emit cell content blocks
  const children = emitBlocks(node.content, ctx) as (Paragraph | Table)[];
  
  // Ensure at least one paragraph in cell
  const content = children.length > 0 ? children : [new Paragraph({})];

  // Use table-level cellPadding if specified, otherwise defaults
  const pad = table.cellPadding;
  const margins = pad !== undefined
    ? { top: pad, bottom: pad, left: pad, right: pad }
    : { top: 50, bottom: 50, left: 100, right: 100 };
  
  return new TableCell({
    children: content,
    columnSpan: node.colspan,
    rowSpan: node.rowspan,
    verticalAlign: toVerticalAlign(node.verticalAlign),
    margins,
  });
}

/**
 * Convert vertical alignment to docx TableVerticalAlign string.
 */
function toVerticalAlign(
  align: TableCellNode["verticalAlign"]
): TableVerticalAlign {
  switch (align) {
    case "top": return "top";
    case "center": return "center";
    case "bottom": return "bottom";
    default: return "top";
  }
}
