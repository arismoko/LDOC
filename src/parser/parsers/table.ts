import { TokenType } from "../lexer";
import type { TableNode, TableRowNode } from "../ast";
import { type ParserContext, parseInlineContent } from "./inline";
import { consumeEndBlockOrThrow } from "../utils";

export function parseTable(ctx: ParserContext): TableNode {
  const token = ctx.stream.advance();
  const rows: TableRowNode[] = [];

  ctx.stream.skipNewlines();

  // Parse indented rows
  if (ctx.stream.check(TokenType.INDENT)) {
    ctx.stream.advance();

    let isFirst = true;
    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      if (ctx.stream.check(TokenType.END_BLOCK)) {
        consumeEndBlockOrThrow(ctx, "table");
        break;
      }

      ctx.stream.skipNewlines();
      if (ctx.stream.check(TokenType.DEDENT)) break;

      if (ctx.stream.check(TokenType.TABLE_ROW)) {
        const rowToken = ctx.stream.advance();
        const cells = JSON.parse(rowToken.value) as string[];

        rows.push({
          type: "table_row",
          line: rowToken.line,
          column: rowToken.column,
          cells: cells.map((cell) => parseInlineContent(cell)),
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
  }

  return {
    type: "table",
    line: token.line,
    column: token.column,
    rows,
  };
}
