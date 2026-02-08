/**
 * @table directive handler.
 */

import type { Directive } from "../../types/cst.ts";
import type { Table, TableCell, TableRow } from "../../types/document-ir.ts";
import type { BlockDirectiveHandler } from "../handler.ts";
import { parseLengthToTwips } from "../../shared/units.ts";
import type { Diagnostic } from "../../types/diagnostics.ts";

function toCellText(value: unknown, diagnostics: Diagnostic[], loc: Directive["loc"]): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  // Unsupported types: objects, arrays, null, undefined
  diagnostics.push({
    severity: "warning",
    code: "E012",
    message: `Unsupported cell value type: ${value === null ? "null" : typeof value}. Expected string, number, or boolean.`,
    location: loc ?? { line: 1, column: 0, endLine: 1, endColumn: 0 },
  });
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

function evaluateTableDirective(node: Directive, diagnostics: Diagnostic[]): Table {
  const tableArgs = node.args ?? {};
  const bodyChildren = node.body?.kind === "StructuralBody" ? node.body.children : [];

  // Warn on non-@row children (silently dropping user content is P1)
  const rowNodes: Directive[] = [];
  for (const child of bodyChildren) {
    if (child.kind === "Directive" && child.name === "row") {
      rowNodes.push(child);
    } else {
      diagnostics.push({
        severity: "warning",
        code: "E010",
        message: `@table only accepts @row children; ignoring ${child.kind === "Directive" ? `@${child.name}` : child.kind}`,
        location: child.loc ?? { line: 1, column: 0, endLine: 1, endColumn: 0 },
      });
    }
  }
  const rows: TableRow[] = [];
  const rowColumnOwners: TableCell[][] = [];

  // Parse table-level args
  let headerRows: number | undefined;
  if (typeof tableArgs.headerRows === "number") {
    if (Number.isInteger(tableArgs.headerRows) && tableArgs.headerRows >= 0) {
      headerRows = tableArgs.headerRows;
    } else {
      diagnostics.push({
        severity: "warning",
        code: "E013",
        message: `Invalid headerRows value: ${tableArgs.headerRows}. Must be a non-negative integer.`,
        location: node.loc ?? { line: 1, column: 0, endLine: 1, endColumn: 0 },
      });
    }
  } else if (tableArgs.headerRows !== undefined) {
    diagnostics.push({
      severity: "warning",
      code: "E016",
      message: `headerRows must be a number, got ${typeof tableArgs.headerRows}; ignored.`,
      location: node.loc ?? { line: 1, column: 0, endLine: 1, endColumn: 0 },
    });
  }
  let cellPadding: number | undefined;
  if (typeof tableArgs.cellPadding === "string" || typeof tableArgs.cellPadding === "number") {
    try {
      cellPadding = parseLengthToTwips(tableArgs.cellPadding);
    } catch {
      diagnostics.push({
        severity: "warning",
        code: "E011",
        message: `Invalid cellPadding value: "${tableArgs.cellPadding}". Use units like "0.1in", "6pt".`,
        location: node.loc ?? { line: 1, column: 0, endLine: 1, endColumn: 0 },
      });
    }
  } else if (tableArgs.cellPadding !== undefined) {
    diagnostics.push({
      severity: "warning",
      code: "E017",
      message: `cellPadding must be a string or number, got ${typeof tableArgs.cellPadding}; ignored.`,
      location: node.loc ?? { line: 1, column: 0, endLine: 1, endColumn: 0 },
    });
  }

  for (const rowNode of rowNodes) {
    const args = rowNode.args ?? {};
    const values = Array.isArray(args.cells) ? args.cells : [];
    if (args.cells !== undefined && !Array.isArray(args.cells)) {
      diagnostics.push({
        severity: "warning",
        code: "E018",
        message: `@row cells must be an array, got ${typeof args.cells}; row will be empty.`,
        location: rowNode.loc ?? { line: 1, column: 0, endLine: 1, endColumn: 0 },
      });
    }
    const cells: TableCell[] = [];
    const columnOwners: TableCell[] = [];
    let column = 0;

    for (const rawValue of values) {
      const cellValue = toCellText(rawValue, diagnostics, rowNode.loc);

      if (cellValue === ">") {
        const leftCell = columnOwners[column - 1];
        if (leftCell) {
          leftCell.colspan = (leftCell.colspan ?? 1) + 1;
          columnOwners[column] = leftCell;
        } else {
          diagnostics.push({
            severity: "warning",
            code: "E014",
            message: `Merge marker ">" at column 0 has no left cell to merge with; ignored.`,
            location: rowNode.loc ?? { line: 1, column: 0, endLine: 1, endColumn: 0 },
          });
        }
        column += 1;
        continue;
      }

      if (cellValue === "^") {
        const aboveCell = rowColumnOwners[rowColumnOwners.length - 1]?.[column];
        if (aboveCell) {
          aboveCell.rowspan = (aboveCell.rowspan ?? 1) + 1;
        } else {
          diagnostics.push({
            severity: "warning",
            code: "E015",
            message: `Merge marker "^" in first row has no above cell to merge with; ignored.`,
            location: rowNode.loc ?? { line: 1, column: 0, endLine: 1, endColumn: 0 },
          });
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

export const handleTable: BlockDirectiveHandler = async (node, ctx) => {
  return [evaluateTableDirective(node, ctx.diagnostics)];
};
