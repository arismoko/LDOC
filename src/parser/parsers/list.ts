import { TokenType, type Token } from "../lexer";
import type { NumberedItemNode, BulletItemNode, NumberingStyle, Node } from "../ast";
import { type ParserContext, tokensToInlineNodes } from "./inline";
import { pushBlankLines, consumeEndBlockOrThrow } from "../utils";

export function parseNumberingStyle(style: string): NumberingStyle {
  if (!style) {
    return { type: "auto" };
  }

  // Decimal with dots: 1.1, 2.1.3
  if (/^\d+(\.\d+)+$/.test(style)) {
    return { type: "decimal_sub", pattern: style };
  }

  // Simple decimal: 1, 2, 3
  if (/^\d+$/.test(style)) {
    return { type: "decimal", start: parseInt(style) };
  }

  // Roman lower: i, ii, iii
  if (/^[ivx]+$/.test(style)) {
    return { type: "roman_lower", start: style };
  }

  // Roman upper: I, II, III
  if (/^[IVX]+$/.test(style)) {
    return { type: "roman_upper", start: style };
  }

  // Alpha lower: a, b, c
  if (/^[a-z]$/.test(style)) {
    return { type: "alpha_lower", start: style };
  }

  // Alpha upper: A, B, C
  if (/^[A-Z]$/.test(style)) {
    return { type: "alpha_upper", start: style };
  }

  return { type: "auto" };
}

export function parseNumberedItem(ctx: ParserContext): NumberedItemNode {
  const token = ctx.stream.advance();
  const level = token.level ?? 1;
  const style = parseNumberingStyle(token.style ?? "");

  // Parse content on the same line; allow soft-wrapped lines until a blank line or block start.
  const contentTokens: Token[] = [];
  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
    contentTokens.push(ctx.stream.advance());
  }
  // Soft-wrap continuation lines into the same numbered paragraph.
  while (ctx.stream.check(TokenType.NEWLINE)) {
    const before = ctx.stream.getPosition();
    ctx.stream.consumeSoftWrappedLine(contentTokens);
    if (ctx.stream.getPosition() === before) break;
  }

  let content = tokensToInlineNodes(contentTokens, ctx.definedTerms);
  const children: Node[] = [];

  // Parse children if indented; preserve blank lines inside the block.
  const la = ctx.stream.lookaheadNewlinesThenIndent();
  if (la.indentAfter) {
    const start = ctx.stream.peek();
    const n = ctx.stream.consumeNewlines();
    pushBlankLines(children, start.line, start.column, n);

    // Now we're positioned at INDENT
    ctx.stream.advance();
    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      if (ctx.stream.check(TokenType.END_BLOCK)) {
        consumeEndBlockOrThrow(ctx, "numbered_item");
        break;
      }
      if (ctx.stream.check(TokenType.NEWLINE)) {
        const start = ctx.stream.peek();
        const n = ctx.stream.consumeNewlines();
        pushBlankLines(children, start.line, start.column, n);
        continue;
      }
      if (ctx.stream.check(TokenType.DEDENT)) break;

      const child = ctx.parseNode();
      if (child) {
        children.push(child);
      }
    }
    if (ctx.stream.check(TokenType.DEDENT)) {
      ctx.stream.advance();
    }
  }

  // If the numbered item has no inline content, and the first child is a paragraph,
  // treat that paragraph as the list item's content (avoids rendering an empty "1." line).
  if (content.length === 0) {
    const idx = children.findIndex((n) => n.type === "paragraph");
    if (idx !== -1) {
      const p = children[idx] as any;
      content = p.content ?? [];
      children.splice(idx, 1);
    }
  }

  return {
    type: "numbered_item",
    line: token.line,
    column: token.column,
    level,
    style,
    marker: token.marker ?? "",
    content,
    children,
  };
}

export function parseBulletItem(ctx: ParserContext): BulletItemNode {
  const token = ctx.stream.advance();
  const level = token.level ?? 1;

  // Parse content on the same line; allow soft-wrapped lines until a blank line or block start.
  const contentTokens: Token[] = [];
  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
    contentTokens.push(ctx.stream.advance());
  }
  while (ctx.stream.check(TokenType.NEWLINE)) {
    const before = ctx.stream.getPosition();
    ctx.stream.consumeSoftWrappedLine(contentTokens);
    if (ctx.stream.getPosition() === before) break;
  }

  let content = tokensToInlineNodes(contentTokens, ctx.definedTerms);
  const children: Node[] = [];

  // Parse children if indented; preserve blank lines inside the block.
  const la = ctx.stream.lookaheadNewlinesThenIndent();
  if (la.indentAfter) {
    const start = ctx.stream.peek();
    const n = ctx.stream.consumeNewlines();
    pushBlankLines(children, start.line, start.column, n);

    // Now we're positioned at INDENT
    ctx.stream.advance();
    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      if (ctx.stream.check(TokenType.END_BLOCK)) {
        consumeEndBlockOrThrow(ctx, "bullet_item");
        break;
      }
      if (ctx.stream.check(TokenType.NEWLINE)) {
        const start = ctx.stream.peek();
        const n = ctx.stream.consumeNewlines();
        pushBlankLines(children, start.line, start.column, n);
        continue;
      }
      if (ctx.stream.check(TokenType.DEDENT)) break;

      const child = ctx.parseNode();
      if (child) {
        children.push(child);
      }
    }
    if (ctx.stream.check(TokenType.DEDENT)) {
      ctx.stream.advance();
    }
  }

  if (content.length === 0) {
    const idx = children.findIndex((n) => n.type === "paragraph");
    if (idx !== -1) {
      const p = children[idx] as any;
      content = p.content ?? [];
      children.splice(idx, 1);
    }
  }

  return {
    type: "bullet_item",
    line: token.line,
    column: token.column,
    level,
    content,
    children,
  };
}
