import { TokenType } from "../lexer";
import type { TableNode, TableRowNode, TableCellNode, Node } from "../ast";
import { type ParserContext, parseInlineContent } from "./inline";
import { parseParagraph } from "./block";
import { pushBlankLines } from "../utils";

interface RawCell {
  value: string;
  quoted: boolean;
}

export function parseTable(ctx: ParserContext): TableNode {
  const token = ctx.stream.advance();
  const rows: TableRowNode[] = [];
  let lastToken = token;

  // Check for attributes on the table token itself (if we add support for @table width=100%)
  const tableAttributes = token.attributes;

  ctx.stream.skipNewlines();

  // Parse indented rows
  if (ctx.stream.check(TokenType.INDENT)) {
    ctx.stream.advance();

    let isFirst = true;
    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      ctx.stream.skipNewlines();
      if (ctx.stream.check(TokenType.DEDENT)) break;

      // Legacy syntax: [cell, cell]
      if (ctx.stream.check(TokenType.TABLE_ROW)) {
        const rowToken = ctx.stream.advance();
        lastToken = rowToken;
        const rawCells = JSON.parse(rowToken.value) as RawCell[];

        const cells: TableCellNode[] = [];
        for (const rawCell of rawCells) {
          const val = rawCell.value;
          const isQuoted = rawCell.quoted;

          // Check for colspan marker (unquoted ">")
          if (!isQuoted && val === ">") {
            const lastCell = cells[cells.length - 1];
            if (lastCell) {
              lastCell.colspan++;
            }
            continue;
          }

          // Check for rowspan marker (unquoted "^")
          if (!isQuoted && val === "^") {
            cells.push({
              type: "table_cell",
              line: rowToken.line,
              column: rowToken.column,
              endLine: rowToken.endLine,
              endColumn: rowToken.endColumn,
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
            endLine: rowToken.endLine,
            endColumn: rowToken.endColumn,
            content: parseInlineContent(val).map(inline => ({ ...inline, type: "paragraph", content: [inline] } as any)), // Hack: wrap inline in paragraph-like structure or just use inline? 
            // Wait, TableCellNode.content is now Node[]. parseInlineContent returns InlineNode[].
            // We need to wrap them in a ParagraphNode if we want consistency with block content.
            // Or we can allow InlineNode in content? AST says Node[]. InlineNode is not Node (Node is Block).
            // So we MUST wrap in ParagraphNode.
            colspan: 1,
            rowspan: 1,
          });
        }
        
        // Fix up the content wrapping for legacy cells
        cells.forEach(cell => {
           if (cell.vMerge !== "continue") {
             // The content was parsed as InlineNode[], but we cast it to any above.
             // Let's fix it properly.
             const inlineContent = parseInlineContent(rawCells[cells.indexOf(cell)]!.value);
             cell.content = [{
               type: "paragraph",
               content: inlineContent,
               line: cell.line,
               column: cell.column,
               endLine: cell.endLine,
               endColumn: cell.endColumn,
             }];
           }
        });

        rows.push({
          type: "table_row",
          line: rowToken.line,
          column: rowToken.column,
          endLine: rowToken.endLine,
          endColumn: rowToken.endColumn,
          cells,
          isHeader: isFirst,
        });

        isFirst = false;
      } 
      // New syntax: @row
      else if (ctx.stream.check(TokenType.ROW)) {
        const rowToken = ctx.stream.advance();
        lastToken = rowToken;
        const rowAttributes = rowToken.attributes;
        
        const cells: TableCellNode[] = [];
        
        ctx.stream.skipNewlines();
        if (ctx.stream.check(TokenType.INDENT)) {
          ctx.stream.advance();
          
          while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
            ctx.stream.skipNewlines();
            if (ctx.stream.check(TokenType.DEDENT)) break;
            
            if (ctx.stream.check(TokenType.CELL)) {
              const cellToken = ctx.stream.advance();
              const cellAttributes = cellToken.attributes;
              let content: Node[] = [];
              
              // Check for inline content: @cell: content
              // The lexer produces [CELL, TEXT(": content")]
              if (ctx.stream.check(TokenType.TEXT)) {
                const textToken = ctx.stream.peek();
                if (textToken.value.startsWith(":")) {
                  ctx.stream.advance();
                  const text = textToken.value.substring(1).trim(); // Remove : and trim
                  if (text) {
                    content.push({
                      type: "paragraph",
                      content: parseInlineContent(text),
                      line: textToken.line,
                      column: textToken.column,
                      endLine: textToken.endLine,
                      endColumn: textToken.endColumn,
                    });
                  }
                }
              } 
              // Check for block content
              else if (ctx.stream.check(TokenType.NEWLINE)) {
                ctx.stream.skipNewlines();
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
          isHeader: isFirst, // First row is header by default? Or explicit?
          attributes: rowAttributes,
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

    return {
      type: "table",
      line: token.line,
      column: token.column,
      endLine: lastToken.endLine,
      endColumn: lastToken.endColumn,
      rows,
      hasEnd,
      attributes: tableAttributes,
    };
  }

  resolveRowspans(rows);

  return {
    type: "table",
    line: token.line,
    column: token.column,
    endLine: token.endLine,
    endColumn: token.endColumn,
    rows,
    hasEnd: false,
    attributes: tableAttributes,
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
