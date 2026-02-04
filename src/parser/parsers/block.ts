import { TokenType, type Token } from "../lexer";
import type { HeaderNode, ParagraphNode, ModifierNode, PageBreakNode, CommentNode, Node, ModifierType } from "../ast";
import { type ParserContext, parseInlineContent, tokensToInlineNodes, parseRestOfLineRaw } from "./inline";
import { pushBlankLines, consumeEndBlockOrThrow, parseLengthToTwip } from "../utils";

export function parseHeader(ctx: ParserContext): HeaderNode {
  const token = ctx.stream.advance();
  const level = token.level ?? 1;

  return {
    type: "header",
    line: token.line,
    column: token.column,
    level,
    content: parseInlineContent(token.value),
  };
}

export function parseParagraph(ctx: ParserContext): ParagraphNode | null {
  const startToken = ctx.stream.peek();
  const contentTokens: Token[] = [];

  while (!ctx.stream.isAtEnd()) {
    if (ctx.stream.check(TokenType.EOF) || ctx.stream.check(TokenType.INDENT) || ctx.stream.check(TokenType.DEDENT)) {
      break;
    }

    if (ctx.stream.check(TokenType.NEWLINE)) {
      // Blank line = paragraph break
      if (ctx.stream.getTokenAt(ctx.stream.getPosition() + 1)?.type === TokenType.NEWLINE) {
        break;
      }

      // Single newline: soft wrap if the next token continues inline content
      const nextType = ctx.stream.getTokenAt(ctx.stream.getPosition() + 1)?.type;
      if (
        nextType !== undefined &&
        nextType !== TokenType.INDENT &&
        nextType !== TokenType.DEDENT &&
        !ctx.stream.isBlockStart(nextType)
      ) {
        const nl = ctx.stream.peek();
        ctx.stream.advance();
        ctx.stream.softWrapIntoTokens(contentTokens, nl);
        continue;
      }

      // Otherwise paragraph break
      break;
    }

    if (ctx.stream.isBlockStart(ctx.stream.peek().type)) {
      break;
    }

    contentTokens.push(ctx.stream.advance());
  }

  // Trim leading whitespace from the first token (fixes spacing after modifiers)
  const firstToken = contentTokens[0];
  if (firstToken && firstToken.type === TokenType.TEXT) {
    // Create a copy to avoid mutating the stream token directly
    const first = { ...firstToken };
    first.value = first.value.trimStart();
    if (first.value === "") {
      contentTokens.shift();
    } else {
      contentTokens[0] = first;
    }
  }

  if (contentTokens.length === 0) {
    return null;
  }

  return {
    type: "paragraph",
    line: startToken.line,
    column: startToken.column,
    content: tokensToInlineNodes(contentTokens, ctx.definedTerms),
  };
}

export function parseModifier(ctx: ParserContext): ModifierNode {
  const token = ctx.stream.advance();
  const modifier = token.value as ModifierType;

  const content: Node[] = [];

  // Check if content is on same line or indented block
  if (ctx.stream.check(TokenType.NEWLINE)) {
    // Only consume newlines if an indented block follows.
    // Otherwise leave them for the outer loop to preserve blank lines between nodes.
    const la = ctx.stream.lookaheadNewlinesThenIndent();
    if (la.indentAfter) {
      const start = ctx.stream.peek();
      const n = ctx.stream.consumeNewlines();
      pushBlankLines(content, start.line, start.column, n);

      // Now we're positioned at INDENT
      ctx.stream.advance();
      while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
        if (ctx.stream.check(TokenType.END_BLOCK)) {
          consumeEndBlockOrThrow(ctx, "modifier");
          break;
        }
        if (ctx.stream.check(TokenType.NEWLINE)) {
          const start = ctx.stream.peek();
          const n = ctx.stream.consumeNewlines();
          pushBlankLines(content, start.line, start.column, n);
          continue;
        }
        if (ctx.stream.check(TokenType.DEDENT)) break;

        const child = ctx.parseNode();
        if (child) {
          content.push(child);
        }
      }
      if (ctx.stream.check(TokenType.DEDENT)) {
        ctx.stream.advance();
      }
    }
  } else {
    // Same line content - could be another modifier, header, or text
    if (ctx.stream.check(TokenType.MODIFIER)) {
      const nested = parseModifier(ctx);
      content.push(nested);
    } else if (ctx.stream.check(TokenType.HEADER)) {
      const header = parseHeader(ctx);
      content.push(header);
    } else {
      const para = parseParagraph(ctx);
      if (para) content.push(para);
    }
  }

  return {
    type: "modifier",
    line: token.line,
    column: token.column,
    modifier,
    count: token.count,
    length: token.length,
    content,
  };
}

export function parsePageBreak(ctx: ParserContext): PageBreakNode {
  const token = ctx.stream.advance();
  return {
    type: "page_break",
    line: token.line,
    column: token.column,
  };
}

export function parseComment(ctx: ParserContext): CommentNode {
  const token = ctx.stream.advance();
  return {
    type: "comment",
    line: token.line,
    column: token.column,
    value: token.value,
    isTodo: token.type === TokenType.TODO,
  };
}

export function parseAnchor(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  let name = parseRestOfLineRaw(ctx);
  if (!name) {
    throw new Error(`@anchor requires a name at line ${token.line}, column ${token.column}`);
  }
  // Allow quoted names: @anchor "Section 5.2"
  if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
    name = name.slice(1, -1);
  }
  return {
    type: "anchor",
    name,
    line: token.line,
    column: token.column,
  } as any;
}
