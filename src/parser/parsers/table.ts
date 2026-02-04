import { TokenType } from "../lexer";
import type { TableNode, TableRowNode, TableCellNode } from "../ast";
import { type ParserContext, parseInlineContent } from "./inline";

interface RawCell {
  value: string;
  quoted: boolean;
}

export function parseTable(ctx: ParserContext): TableNode {
  const token = ctx.stream.advance();
  const rows: TableRowNode[] = [];

  ctx.stream.skipNewlines();

  // Parse indented rows
  if (ctx.stream.check(TokenType.INDENT)) {
    ctx.stream.advance();

    let isFirst = true;
    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      ctx.stream.skipNewlines();
      if (ctx.stream.check(TokenType.DEDENT)) break;

      if (ctx.stream.check(TokenType.TABLE_ROW)) {
        const rowToken = ctx.stream.advance();
        const rawCells = JSON.parse(rowToken.value) as RawCell[];

        const cells: TableCellNode[] = [];
        for (const rawCell of rawCells) {
          const val = rawCell.value;
          const isQuoted = rawCell.quoted;

          // Check for colspan marker (unquoted ">")
          if (!isQuoted && val === ">") {
            // Merge with previous cell - increment colspan
            const lastCell = cells[cells.length - 1];
            if (lastCell) {
              lastCell.colspan++;
            }
            // Don't add a new cell
            continue;
          }

          // Check for rowspan marker (unquoted "^")
          if (!isQuoted && val === "^") {
            // Create a cell that continues from above
            cells.push({
              type: "table_cell",
              line: rowToken.line,
              column: rowToken.column,
              content: [],
              colspan: 1,
              rowspan: 1,
              vMerge: "continue",
            });
            continue;
          }

          // Normal cell
          cells.push({
            type: "table_cell",
            line: rowToken.line,
            column: rowToken.column,
            content: parseInlineContent(val),
            colspan: 1,
            rowspan: 1,
          });
        }

        rows.push({
          type: "table_row",
          line: rowToken.line,
          column: rowToken.column,
          cells,
          isHeader: isFirst,
        });

        isFirst = false;
      } else {
        ctx.stream.advance(); // Skip unexpected tokens
      }
    }

    if (ctx.stream.check(TokenType.DEDENT)) {
      ctx.stream.advance();
    }

    // Optional @end after indented block
    // Only consume newlines if @end follows, otherwise leave them for body
    let hasEnd = false;
    const savedPos = ctx.stream.getPosition();
    while (ctx.stream.check(TokenType.NEWLINE)) {
      ctx.stream.advance();
    }
    if (ctx.stream.check(TokenType.END)) {
      ctx.stream.advance();
      hasEnd = true;
    } else {
      // No @end found, restore position to preserve blank lines
      ctx.stream.setPosition(savedPos);
    }

    // Post-process to set vMerge: "restart" on cells that have cells below with vMerge: "continue"
    resolveRowspans(rows);

    return {
      type: "table",
      line: token.line,
      column: token.column,
      rows,
      hasEnd,
    };
  }

  // Post-process to set vMerge: "restart" on cells that have cells below with vMerge: "continue"
  resolveRowspans(rows);

  return {
    type: "table",
    line: token.line,
    column: token.column,
    rows,
    hasEnd: false,
  };
}

/**
 * Post-process rows to resolve rowspans.
 * For each cell with vMerge: "continue", find the cell above it and mark it with vMerge: "restart".
 * This needs to account for colspans when calculating column indices.
 */
function resolveRowspans(rows: TableRowNode[]): void {
  // Build a grid that maps (rowIndex, colIndex) -> cell
  // This is needed because cells with colspan > 1 occupy multiple column positions
  const grid: (TableCellNode | null)[][] = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    if (!row) continue;
    
    const gridRow: (TableCellNode | null)[] = [];
    let colIdx = 0;
    
    for (const cell of row.cells) {
      // Add the cell at current position
      gridRow[colIdx] = cell;
      colIdx++;
      
      // For colspan > 1, add null placeholders
      for (let i = 1; i < cell.colspan; i++) {
        gridRow[colIdx] = null;
        colIdx++;
      }
    }
    
    grid.push(gridRow);
  }

  // Now iterate through the grid and resolve vMerge
  for (let rowIdx = 1; rowIdx < grid.length; rowIdx++) {
    const gridRow = grid[rowIdx];
    if (!gridRow) continue;
    
    for (let colIdx = 0; colIdx < gridRow.length; colIdx++) {
      const cell = gridRow[colIdx];
      if (!cell) continue;
      
      if (cell.vMerge === "continue") {
        // Find the cell above in the grid
        // Walk up to find the first non-continue cell
        let aboveRowIdx = rowIdx - 1;
        while (aboveRowIdx >= 0) {
          const aboveRow = grid[aboveRowIdx];
          if (!aboveRow) {
            aboveRowIdx--;
            continue;
          }
          
          const aboveCell = aboveRow[colIdx];
          if (!aboveCell) {
            aboveRowIdx--;
            continue;
          }
          
          if (aboveCell.vMerge === "continue") {
            // Keep looking up
            aboveRowIdx--;
            continue;
          }
          
          // Found the source cell - mark it as restart
          if (!aboveCell.vMerge) {
            aboveCell.vMerge = "restart";
          }
          break;
        }
      }
    }
  }
}
