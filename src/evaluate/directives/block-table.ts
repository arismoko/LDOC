/**
 * @table directive handler.
 */

import type { Directive } from "../../types/cst.ts";
import type { Table, TableCell, TableRow } from "../../types/document-ir.ts";
import type { BlockDirectiveHandler } from "../handler.ts";

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
  const rowNodes = node.body?.children.filter(
    (child): child is Directive => child.kind === "Directive" && child.name === "row",
  ) ?? [];
  const rows: TableRow[] = [];
  const rowColumnOwners: TableCell[][] = [];

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

    rows.push({
      type: "TableRow",
      cells,
      loc: rowNode.loc,
    });
    rowColumnOwners.push(columnOwners);
  }

  return {
    type: "Table",
    rows,
    loc: node.loc,
  };
}

export const handleTable: BlockDirectiveHandler = async (node) => {
  return [evaluateTableDirective(node)];
};
