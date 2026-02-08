/**
 * @table directive handler.
 */

import type { Directive } from "../../types/cst.ts";
import type { Table, TableCell, TableRow } from "../../types/document-ir.ts";
import type { BlockDirectiveHandler } from "../handler.ts";
import { parseLengthToTwips } from "../../shared/units.ts";

function toCellText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function createTextCell(value: string, loc: Directive["loc"]): TableCell {
  return {
    type: "TableCell",
    content: [{
      type: "Paragraph",
      content: value.length > 0 ? [{ type: "Text", value, loc }] : [],
      loc,
    }],
    loc,
  };
}

function evaluateTableDirective(node: Directive): Table {
  const tableArgs = node.args ?? {};
  const rowNodes = (node.body?.kind === "StructuralBody" ? node.body.children : []).filter(
    (child): child is Directive => child.kind === "Directive" && child.name === "row",
  );
  const rows: TableRow[] = [];
  const rowColumnOwners: TableCell[][] = [];

  // Parse table-level args
  const headerRows = typeof tableArgs.headerRows === "number" ? tableArgs.headerRows : undefined;
  const cellPadding = typeof tableArgs.cellPadding === "string" || typeof tableArgs.cellPadding === "number"
    ? parseLengthToTwips(tableArgs.cellPadding, { lenient: true })
    : undefined;

  for (const rowNode of rowNodes) {
    const args = rowNode.args ?? {};
    const values = Array.isArray(args.cells) ? args.cells : [];
    const cells: TableCell[] = [];
    const columnOwners: TableCell[] = [];
    let column = 0;

    for (const rawValue of values) {
      const cellValue = toCellText(rawValue);

      if (cellValue === ">") {
        const leftCell = columnOwners[column - 1];
        if (leftCell) {
          leftCell.colspan = (leftCell.colspan ?? 1) + 1;
          columnOwners[column] = leftCell;
        }
        column += 1;
        continue;
      }

      if (cellValue === "^") {
        const aboveCell = rowColumnOwners[rowColumnOwners.length - 1]?.[column];
        if (aboveCell) {
          aboveCell.rowspan = (aboveCell.rowspan ?? 1) + 1;
        }
        column += 1;
        continue;
      }

      const cell = createTextCell(cellValue, rowNode.loc);
      cells.push(cell);
      columnOwners[column] = cell;
      column += 1;
    }

    const cantSplit = args.cantSplit === true ? true : undefined;

    rows.push({
      type: "TableRow",
      cells,
      cantSplit,
      loc: rowNode.loc,
    });
    rowColumnOwners.push(columnOwners);
  }

  // Auto-mark header rows based on headerRows arg
  if (headerRows !== undefined && headerRows > 0) {
    for (let i = 0; i < Math.min(headerRows, rows.length); i++) {
      rows[i]!.isHeader = true;
    }
  }

  return {
    type: "Table",
    rows,
    headerRows,
    cellPadding,
    loc: node.loc,
  };
}

export const handleTable: BlockDirectiveHandler = async (node) => {
  return [evaluateTableDirective(node)];
};
