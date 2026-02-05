import { TokenType } from "../lexer";
import type { TableNode, TableRowNode, TableCellNode, Node } from "../ast";
import { type ParserContext } from "./inline";
import { parseParagraph } from "./block";
import { pushBlankLines, parseLengthToTwip } from "../utils";
import { parseDirectiveArgs } from "../args";

function argValueToString(val: any): string {
  if (!val) return "";
  switch (val.type) {
    case "string": return val.value;
    case "number": return String(val.value);
    case "boolean": return val.value ? "true" : "false";
    case "length": return val.raw;
    case "identifier": return val.name;
    case "expression": return val.raw;
    case "list":
      // Format list as "[item1, item2, ...]"
      const items = (val.items ?? []).map((item: any) => argValueToString(item));
      return `[${items.join(", ")}]`;
    default: return "";
  }
}

function argsToAttributes(args: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of args.named ?? []) {
    const s = argValueToString(v);
    if (s !== "") out[k] = s;
  }
  for (const flag of args.flags ?? []) {
    out[flag] = "true";
  }
  return out;
}

export function parseTable(ctx: ParserContext): TableNode {
  const token = ctx.stream.advance();
  const rows: TableRowNode[] = [];
  let lastToken = token;

  const tableArgs = parseDirectiveArgs(ctx.stream);
  const tableHeaderFlag = tableArgs.flags?.has("header") ?? false;
  let columnWidths: number[] | undefined;

  const v2Widths = tableArgs.named.get("widths");
  if (v2Widths && v2Widths.type === "list") {
    const twips: number[] = [];
    for (const item of v2Widths.items) {
      if (item.type !== "length") {
        throw new Error(`@table widths must be a list of lengths (line ${token.line})`);
      }
      twips.push(parseLengthToTwip(item.raw, token.line));
    }
    if (twips.length > 0) {
      columnWidths = twips;
    }
  }

  ctx.stream.skipNewlines();

  // Parse indented rows
  if (ctx.stream.check(TokenType.INDENT)) {
    ctx.stream.advance();

    let isFirst = true;
    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      ctx.stream.skipNewlines();
      if (ctx.stream.check(TokenType.DEDENT)) break;

      // v2 syntax: @row
      if (ctx.stream.check(TokenType.ROW)) {
        const rowToken = ctx.stream.advance();
        lastToken = rowToken;
        const rowArgs = parseDirectiveArgs(ctx.stream);
        const rowAttributes = {
          ...(rowToken.attributes ?? {}),
          ...argsToAttributes(rowArgs),
        };
        
        const cells: TableCellNode[] = [];
        
        ctx.stream.skipNewlines();
        if (ctx.stream.check(TokenType.INDENT)) {
          ctx.stream.advance();
          
          while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
            ctx.stream.skipNewlines();
            if (ctx.stream.check(TokenType.DEDENT)) break;
            
            if (ctx.stream.check(TokenType.CELL)) {
              const cellToken = ctx.stream.advance();
              const cellArgs = parseDirectiveArgs(ctx.stream);
              const cellAttributes = {
                ...(cellToken.attributes ?? {}),
                ...argsToAttributes(cellArgs),
              };
              let content: Node[] = [];

              // Same-line content (after optional ':', consumed by lexer)
              if (!ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
                const para = parseParagraph(ctx);
                if (para) {
                  content.push(para);
                }
              }
              // Block content
              else if (ctx.stream.check(TokenType.NEWLINE)) {
                const s = ctx.stream.peek();
                const nn = ctx.stream.consumeNewlines();
                pushBlankLines(content, s.line, s.column, nn);
                if (ctx.stream.check(TokenType.INDENT)) {
                  ctx.stream.advance();
                  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
                    if (ctx.stream.check(TokenType.NEWLINE)) {
                      const s = ctx.stream.peek();
                      const nn = ctx.stream.consumeNewlines();
                      pushBlankLines(content, s.line, s.column, nn);
                      continue;
                    }
                    if (ctx.stream.check(TokenType.DEDENT)) break;
                    
                    const node = ctx.parseNode();
                    if (node) content.push(node);
                  }
                  if (ctx.stream.check(TokenType.DEDENT)) ctx.stream.advance();
                }
              }

              // Parse attributes for colspan/rowspan
              let colspan = 1;
              let rowspan = 1;
              if (cellAttributes) {
                if (cellAttributes.colspan) colspan = parseInt(cellAttributes.colspan, 10) || 1;
                if (cellAttributes.rowspan) rowspan = parseInt(cellAttributes.rowspan, 10) || 1;
              }

              cells.push({
                type: "table_cell",
                line: cellToken.line,
                column: cellToken.column,
                endLine: cellToken.endLine,
                endColumn: cellToken.endColumn,
                content,
                colspan,
                rowspan,
                attributes: cellAttributes,
              });
            } else {
              // Unexpected token inside @row, skip
              ctx.stream.advance();
            }
          }
          
          if (ctx.stream.check(TokenType.DEDENT)) ctx.stream.advance();
        }

        rows.push({
          type: "table_row",
          line: rowToken.line,
          column: rowToken.column,
          endLine: rowToken.endLine,
          endColumn: rowToken.endColumn,
          cells,
          isHeader: (rowArgs.flags?.has("header") ?? false) || (tableHeaderFlag && isFirst),
          attributes: Object.keys(rowAttributes).length > 0 ? rowAttributes : undefined,
        });
        isFirst = false;
      }
      else {
        ctx.stream.advance(); // Skip unexpected tokens
      }
    }

    if (ctx.stream.check(TokenType.DEDENT)) {
      lastToken = ctx.stream.advance();
    }

    // Optional @end after indented block
    let hasEnd = false;
    const savedPos = ctx.stream.getPosition();
    while (ctx.stream.check(TokenType.NEWLINE)) {
      ctx.stream.advance();
    }
    if (ctx.stream.check(TokenType.END)) {
      lastToken = ctx.stream.advance();
      hasEnd = true;
    } else {
      ctx.stream.setPosition(savedPos);
    }

    resolveRowspans(rows);

    // Build table attributes (excluding widths which is handled specially)
    const tableAttributes = argsToAttributes(tableArgs);
    delete tableAttributes.widths; // widths is handled via columnWidths

    return {
      type: "table",
      line: token.line,
      column: token.column,
      endLine: lastToken.endLine,
      endColumn: lastToken.endColumn,
      rows,
      hasEnd,
      columnWidths,
      attributes: Object.keys(tableAttributes).length > 0 ? tableAttributes : undefined,
    };
  }

  resolveRowspans(rows);

  // Build table attributes (excluding widths which is handled specially)
  const tableAttributes = argsToAttributes(tableArgs);
  delete tableAttributes.widths; // widths is handled via columnWidths

  return {
    type: "table",
    line: token.line,
    column: token.column,
    endLine: token.endLine,
    endColumn: token.endColumn,
    rows,
    hasEnd: false,
    columnWidths,
    attributes: Object.keys(tableAttributes).length > 0 ? tableAttributes : undefined,
  };
}

function resolveRowspans(rows: TableRowNode[]): void {
  const grid: (TableCellNode | null)[][] = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    if (!row) continue;
    
    const gridRow: (TableCellNode | null)[] = [];
    let colIdx = 0;
    
    // Fill in spots taken by rowspans from above
    // (This logic is incomplete in the original code too, it only handled vMerge marking)
    // But for resolving vMerge "continue", we need to know which cell is above.
    
    // Actually, the original logic was:
    // 1. Build grid based on current row cells + colspans.
    // 2. Iterate grid to find "continue" cells and link them to "restart".
    // It didn't account for rowspans pushing cells to the right in subsequent rows (standard HTML table model).
    // DOCX vMerge is column-based (vertical merge within a column), so it doesn't push cells.
    // So the grid logic assumes a fixed grid where each row has cells aligned by column index.
    
    for (const cell of row.cells) {
      gridRow[colIdx] = cell;
      colIdx++;
      for (let i = 1; i < cell.colspan; i++) {
        gridRow[colIdx] = null;
        colIdx++;
      }
    }
    grid.push(gridRow);
  }

  for (let rowIdx = 1; rowIdx < grid.length; rowIdx++) {
    const gridRow = grid[rowIdx];
    if (!gridRow) continue;
    
    for (let colIdx = 0; colIdx < gridRow.length; colIdx++) {
      const cell = gridRow[colIdx];
      if (!cell) continue;
      
      // If we have explicit rowspan > 1 in a cell, we might want to mark subsequent cells as continue?
      // Or does the decompiler emit vMerge="continue" cells?
      // The decompiler emits "^" which becomes vMerge="continue".
      // In the new syntax, we might use @cell rowspan=2.
      // If we use rowspan=2, we don't emit a cell in the next row.
      // But DOCX needs a cell with vMerge="continue".
      // So the COMPILER needs to generate the phantom cell.
      // The PARSER just builds the AST.
      
      // However, for legacy "^" syntax, we set vMerge="continue".
      // We need to resolve "restart" for the cell above.
      
      if (cell.vMerge === "continue") {
        let aboveRowIdx = rowIdx - 1;
        while (aboveRowIdx >= 0) {
          const aboveRow = grid[aboveRowIdx];
          if (!aboveRow) { aboveRowIdx--; continue; }
          const aboveCell = aboveRow[colIdx];
          if (!aboveCell) { aboveRowIdx--; continue; }
          
          if (aboveCell.vMerge === "continue") {
            aboveRowIdx--;
            continue;
          }
          
          if (!aboveCell.vMerge) {
            aboveCell.vMerge = "restart";
          }
          break;
        }
      }
    }
  }
}
