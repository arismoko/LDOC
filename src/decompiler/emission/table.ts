/**
 * Table Emission
 *
 * Converts ExtractedTable to LDOC @table syntax:
 * - @table(widths: [...], indent: Xpt, border: true)
 * - @row(header)
 * - @cell(colspan: N, rowspan: M, padding: [...], background: "#..."): content
 * - Block cells with nested content
 */

import type {
  ExtractedTable,
  ExtractedTableRow,
  ExtractedTableCell,
  ExtractedCellMargins,
} from "../extraction/types";
import type { EmissionContext } from "./types";
import { indentContext, tableContext } from "./types";
import { emitInlineContent } from "./inline";
import { formatTwipsAsInches, formatTwipsAsPt } from "../../shared/units";

/**
 * Format padding as compact string.
 */
function formatPadding(margins: ExtractedCellMargins): string | undefined {
  const { top = 0, right = 0, bottom = 0, left = 0 } = margins;

  if (top === 0 && right === 0 && bottom === 0 && left === 0) {
    return undefined;
  }

  if (top === bottom && left === right && top === left) {
    // All equal
    return formatTwipsAsPt(top);
  }

  if (top === bottom && left === right) {
    // [vertical, horizontal]
    return `[${formatTwipsAsPt(top)}, ${formatTwipsAsPt(left)}]`;
  }

  // [top, right, bottom, left]
  return `[${formatTwipsAsPt(top)}, ${formatTwipsAsPt(right)}, ${formatTwipsAsPt(bottom)}, ${formatTwipsAsPt(left)}]`;
}

/**
 * Check if a cell is simple (single paragraph, no special formatting).
 */
function isSimpleCell(cell: ExtractedTableCell): boolean {
  if (cell.paragraphs.length !== 1) return false;
  if (cell.padding) return false;
  if (cell.background) return false;

  const para = cell.paragraphs[0]!;
  if (para.alignment && para.alignment !== "left") return false;
  if (para.numbering) return false;
  if (para.indentLeftTwips && para.indentLeftTwips > 0) return false;

  return true;
}

/**
 * Strip bold markdown from header cells (headers imply bold).
 */
function stripHeaderBold(text: string): string {
  const match = text.match(/^\*\*(.+)\*\*$/);
  return match ? match[1]! : text;
}

/**
 * Emit a cell's content.
 */
function emitCellContent(
  cell: ExtractedTableCell,
  ctx: EmissionContext,
  isHeader: boolean,
): string {
  if (cell.paragraphs.length === 0) {
    return "";
  }

  if (cell.paragraphs.length === 1) {
    const content = emitInlineContent(cell.paragraphs[0]!.content, ctx);
    return isHeader ? stripHeaderBold(content) : content;
  }

  // Multi-paragraph: join with hard breaks
  const parts: string[] = [];
  for (const para of cell.paragraphs) {
    const content = emitInlineContent(para.content, ctx);
    parts.push(isHeader ? stripHeaderBold(content) : content);
  }
  return parts.join("  \n");
}

/**
 * Emit a single cell.
 */
function emitCell(
  cell: ExtractedTableCell,
  ctx: EmissionContext,
  isHeader: boolean,
): string[] {
  const lines: string[] = [];

  // Build cell attributes
  const attrParts: string[] = [];
  if (cell.colspan > 1) attrParts.push(`colspan: ${cell.colspan}`);
  if (cell.rowspan > 1) attrParts.push(`rowspan: ${cell.rowspan}`);

  if (cell.padding) {
    const paddingStr = formatPadding(cell.padding);
    if (paddingStr) {
      attrParts.push(`padding: ${paddingStr}`);
    }
  }

  if (cell.background) {
    attrParts.push(`background: "#${cell.background}"`);
  }

  const attrs = attrParts.length > 0 ? `(${attrParts.join(", ")})` : "";
  const content = emitCellContent(cell, ctx, isHeader);
  const isMultiline = content.includes("\n");

  // Simple single-line cell
  if (isSimpleCell(cell) && !isMultiline && content.length < 80) {
    lines.push(`${ctx.indent}@cell${attrs}: ${content}`);
    return lines;
  }

  // Block form cell
  lines.push(`${ctx.indent}@cell${attrs}`);
  const childCtx = indentContext(ctx);

  // Emit each paragraph, with blank lines between them (paragraph separators)
  for (let i = 0; i < cell.paragraphs.length; i++) {
    const para = cell.paragraphs[i]!;
    const isEmpty =
      para.content.length === 0 ||
      para.content.every(
        (c) => "text" in c && c.text.trim() === "" && !c.hardBreak && !c.tab
      );

    if (isEmpty) {
      // Empty paragraph — emit blank line for paragraph separator
      // plus an indented empty line (creates EMPTY_PARAGRAPH token)
      if (i > 0) {
        lines.push("");
      }
      lines.push(`${childCtx.indent}`);
    } else {
      // Non-empty paragraph — separate from previous with blank line
      if (i > 0) {
        lines.push("");
      }
      const paraContent = emitInlineContent(para.content, ctx);
      for (const line of paraContent.split("\n")) {
        lines.push(`${childCtx.indent}${line}`);
      }
    }
  }

  return lines;
}

/**
 * Emit a table row.
 */
function emitRow(row: ExtractedTableRow, ctx: EmissionContext): string[] {
  const lines: string[] = [];

  // Build row attributes
  const attrParts: string[] = [];
  if (row.isHeader) attrParts.push("header");
  if (row.height) {
    attrParts.push(`height: ${formatTwipsAsPt(row.height.value)}`);
    attrParts.push(`heightRule: ${row.height.rule}`);
  }

  const attrs = attrParts.length > 0 ? `(${attrParts.join(", ")})` : "";
  lines.push(`${ctx.indent}@row${attrs}`);

  const cellCtx = indentContext(ctx);
  for (const cell of row.cells) {
    if (cell.isCovered) continue; // Skip cells merged by rowspan
    lines.push(...emitCell(cell, cellCtx, row.isHeader));
  }

  return lines;
}

/**
 * Emit a table.
 */
export function emitTable(table: ExtractedTable, ctx: EmissionContext): string[] {
  const lines: string[] = [];

  // Build table attributes
  const attrParts: string[] = [];
  if (table.columnWidths && table.columnWidths.length > 0) {
    const widthStrs = table.columnWidths.map((w) => formatTwipsAsInches(w));
    attrParts.push(`widths: [${widthStrs.join(", ")}]`);
  }
  if (table.indent !== undefined && table.indent !== 0) {
    attrParts.push(`indent: ${formatTwipsAsPt(table.indent)}`);
  }
  if (table.hasBorders) {
    attrParts.push("border: true");
  }

  const attrs = attrParts.length > 0 ? `(${attrParts.join(", ")})` : "";
  lines.push(`${ctx.indent}@table${attrs}`);

  const tableCtx = tableContext(indentContext(ctx));
  for (const row of table.rows) {
    lines.push(...emitRow(row, tableCtx));
  }

  return lines;
}
