import { TokenType, type Token } from "../lexer";
import type { HeaderNode, ParagraphNode, ModifierNode, PageBreakNode, CommentNode, Node, ModifierType, HorizontalRuleNode, BlockquoteNode, FootnoteDefinitionNode, ColumnBreakNode } from "../ast";
import { type ParserContext, parseInlineContent, tokensToInlineNodes, parseRestOfLineRaw } from "./inline";
import { pushBlankLines, parseLengthToTwip } from "../utils";

export function parseHorizontalRule(ctx: ParserContext): HorizontalRuleNode {
  const token = ctx.stream.advance();
  return {
    type: "horizontal_rule",
    line: token.line,
    column: token.column,
  };
}

export function parseBlockquote(ctx: ParserContext): BlockquoteNode {
  const content: Node[] = [];
  let forceNewParagraph = false;

  while (true) {
    // Consume >
    if (ctx.stream.check(TokenType.BLOCKQUOTE)) {
      ctx.stream.advance();
    }

    // Handle empty line within blockquote (just > followed by newline)
    if (ctx.stream.check(TokenType.NEWLINE)) {
      // This is a paragraph break inside the blockquote
      forceNewParagraph = true;
      // We don't consume the newline here, we let the lookahead logic handle it
      // or we consume it?
      // If we consume it, we might mess up the lookahead for the NEXT line.
      // Actually, let's look at the continuation logic below.
    } else {
      const node = ctx.parseNode();
      if (node) {
        const last = content[content.length - 1];
        // Merge paragraphs if they are adjacent (soft wrap) and not forced apart
        if (
          !forceNewParagraph &&
          last &&
          last.type === "paragraph" &&
          node.type === "paragraph"
        ) {
          // Check if last node is HardBreak
          const lastInline = last.content[last.content.length - 1];
          if (lastInline?.type !== "hard_break") {
            // Add space for soft wrap
            last.content.push({ type: "text", value: " ", line: 0, column: 0 });
          }
          last.content.push(...node.content);
        } else {
          content.push(node);
          forceNewParagraph = false;
        }
      }
    }

    // Check for continuation: Next line must start with >
    // We expect a NEWLINE, then BLOCKQUOTE
    if (ctx.stream.check(TokenType.NEWLINE)) {
      const next = ctx.stream.getTokenAt(ctx.stream.getPosition() + 1);
      if (next?.type === TokenType.BLOCKQUOTE) {
        ctx.stream.advance(); // Consume newline
        continue; // Continue loop to consume >
      }
    }

    // If we are here, the blockquote block has ended
    break;
  }

  // If we have no content (e.g. just >), add an empty paragraph?
  // Or just return empty content.

  return {
    type: "blockquote",
    line: 0, // We should capture the start line from the first token
    column: 0,
    content,
  };
}

export function parseFootnoteDefinition(ctx: ParserContext): FootnoteDefinitionNode {
  const token = ctx.stream.advance(); // FOOTNOTE_DEF
  const content: Node[] = [];

  // Parse content (similar to blockquote or list item)
  // Content can be on the same line or indented
  if (ctx.stream.check(TokenType.NEWLINE)) {
    const la = ctx.stream.lookaheadNewlinesThenIndent();
    if (la.indentAfter) {
      const start = ctx.stream.peek();
      const n = ctx.stream.consumeNewlines();
      pushBlankLines(content, start.line, start.column, n);
      
      ctx.stream.advance(); // INDENT
      while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
        if (ctx.stream.check(TokenType.NEWLINE)) {
          const start2 = ctx.stream.peek();
          const n2 = ctx.stream.consumeNewlines();
          pushBlankLines(content, start2.line, start2.column, n2);
          continue;
        }
        if (ctx.stream.check(TokenType.DEDENT)) break;
        
        const child = ctx.parseNode();
        if (child) content.push(child);
      }
      if (ctx.stream.check(TokenType.DEDENT)) ctx.stream.advance();
    }
  } else {
    // Same line content
    const para = parseParagraph(ctx);
    if (para) content.push(para);
  }

  return {
    type: "footnote_def",
    line: token.line,
    column: token.column,
    label: token.value,
    content,
  };
}

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
        
        // Don't add space if the previous token was a hard break
        const lastToken = contentTokens[contentTokens.length - 1];
        if (lastToken?.type !== TokenType.HARD_BREAK) {
          ctx.stream.softWrapIntoTokens(contentTokens, nl);
        }
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

      // Optional @end after indented block
      // Skip any newlines first
      while (ctx.stream.check(TokenType.NEWLINE)) {
        ctx.stream.advance();
      }
      // Consume @end if present (optional)
      if (ctx.stream.check(TokenType.END)) {
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

export function parseColumnBreak(ctx: ParserContext): ColumnBreakNode {
  const token = ctx.stream.advance();
  return {
    type: "column_break",
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
