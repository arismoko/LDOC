import { TokenType, type Token } from "../lexer";
import type { HeaderNode, ParagraphNode, ModifierNode, PageBreakNode, CommentNode, Node, ModifierType, HorizontalRuleNode, BlockquoteNode, FootnoteDefinitionNode, ColumnBreakNode } from "../ast";
import { type ParserContext, parseInlineContent, tokensToInlineNodes, parseRestOfLineRaw } from "./inline";
import { pushBlankLines, parseLengthToTwip } from "../utils";
import { parseIndentedBlock } from "./helpers";

export function parseHorizontalRule(ctx: ParserContext): HorizontalRuleNode {
  const token = ctx.stream.advance();
  return {
    type: "horizontal_rule",
    line: token.line,
    column: token.column,
    endLine: token.endLine,
    endColumn: token.endColumn,
  };
}

export function parseBlockquote(ctx: ParserContext): BlockquoteNode {
  const content: Node[] = [];
  let forceNewParagraph = false;
  const startToken = ctx.stream.peek();
  let endToken = startToken;

  while (true) {
    // Consume >
    if (ctx.stream.check(TokenType.BLOCKQUOTE)) {
      endToken = ctx.stream.advance();
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
            last.content.push({ type: "text", value: " ", line: 0, column: 0, endLine: 0, endColumn: 0 });
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
    line: startToken.line,
    column: startToken.column,
    endLine: endToken.endLine,
    endColumn: endToken.endColumn,
    content,
  };
}

export function parseFootnoteDefinition(ctx: ParserContext): FootnoteDefinitionNode {
  const token = ctx.stream.advance(); // FOOTNOTE_DEF

  // Parse content (similar to blockquote or list item)
  // Content can be on same line or indented
  if (ctx.stream.check(TokenType.NEWLINE)) {
    const { content, hasEnd } = parseIndentedBlock(ctx, { required: false });
    const lastChild = content[content.length - 1];
    return {
      type: "footnote_def",
      line: token.line,
      column: token.column,
      endLine: lastChild?.endLine ?? token.endLine,
      endColumn: lastChild?.endColumn ?? token.endColumn,
      label: token.value,
      content,
      hasEnd,
    };
  } else {
    // Same line content
    const content: Node[] = [];
    const para = parseParagraph(ctx);
    if (para) content.push(para);
    return {
      type: "footnote_def",
      line: token.line,
      column: token.column,
      endLine: para?.endLine ?? token.endLine,
      endColumn: para?.endColumn ?? token.endColumn,
      label: token.value,
      content,
      hasEnd: false,
    };
  }
}

export function parseHeader(ctx: ParserContext): HeaderNode {
  const token = ctx.stream.advance();
  const level = token.level ?? 1;

  return {
    type: "header",
    line: token.line,
    column: token.column,
    endLine: token.endLine,
    endColumn: token.endColumn,
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

  const lastToken = contentTokens[contentTokens.length - 1];
  return {
    type: "paragraph",
    line: startToken.line,
    column: startToken.column,
    endLine: lastToken?.endLine ?? startToken.endLine,
    endColumn: lastToken?.endColumn ?? startToken.endColumn,
    content: tokensToInlineNodes(contentTokens, ctx.definedTerms),
  };
}

export function parseModifier(ctx: ParserContext): ModifierNode {
  const token = ctx.stream.advance();
  const modifier = token.value as ModifierType;

  let content: Node[] = [];
  let hasEnd = false;
  let endLine = token.endLine;
  let endColumn = token.endColumn;

  // Check if content is on same line or indented block
  if (ctx.stream.check(TokenType.NEWLINE)) {
    const { content: blockContent, hasEnd: blockHasEnd } = parseIndentedBlock(ctx, { required: false });
    content = blockContent;
    hasEnd = blockHasEnd;
    const lastChild = content[content.length - 1];
    if (lastChild) {
      endLine = lastChild.endLine ?? endLine;
      endColumn = lastChild.endColumn ?? endColumn;
    }
  } else {
    // Same line content - could be another modifier, header, or text
    if (ctx.stream.check(TokenType.MODIFIER)) {
      const nested = parseModifier(ctx);
      content.push(nested);
      endLine = nested.endLine ?? endLine;
      endColumn = nested.endColumn ?? endColumn;
    } else if (ctx.stream.check(TokenType.HEADER)) {
      const header = parseHeader(ctx);
      content.push(header);
      endLine = header.endLine ?? endLine;
      endColumn = header.endColumn ?? endColumn;
    } else {
      const para = parseParagraph(ctx);
      if (para) {
        content.push(para);
        endLine = para.endLine ?? endLine;
        endColumn = para.endColumn ?? endColumn;
      }
    }
  }

  return {
    type: "modifier",
    line: token.line,
    column: token.column,
    endLine,
    endColumn,
    modifier,
    count: token.count,
    length: token.length,
    attributes: token.attributes,
    content,
    hasEnd,
  };
}

export function parsePageBreak(ctx: ParserContext): PageBreakNode {
  const token = ctx.stream.advance();
  return {
    type: "page_break",
    line: token.line,
    column: token.column,
    endLine: token.endLine,
    endColumn: token.endColumn,
  };
}

export function parseColumnBreak(ctx: ParserContext): ColumnBreakNode {
  const token = ctx.stream.advance();
  return {
    type: "column_break",
    line: token.line,
    column: token.column,
    endLine: token.endLine,
    endColumn: token.endColumn,
  };
}

export function parseComment(ctx: ParserContext): CommentNode {
  const token = ctx.stream.advance();
  return {
    type: "comment",
    line: token.line,
    column: token.column,
    endLine: token.endLine,
    endColumn: token.endColumn,
    value: token.value,
    isTodo: token.type === TokenType.TODO,
  };
}

export function parseAnchor(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const startPos = ctx.stream.getPosition();
  let name = parseRestOfLineRaw(ctx);
  if (!name) {
    throw new Error(`@anchor requires a name at line ${token.line}, column ${token.column}`);
  }
  // Allow quoted names: @anchor "Section 5.2"
  if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
    name = name.slice(1, -1);
  }
  // Get end position from last consumed token
  const endPos = ctx.stream.getPosition();
  const endToken = endPos > startPos ? ctx.stream.getTokenAt(endPos - 1) : token;
  return {
    type: "anchor",
    name,
    line: token.line,
    column: token.column,
    endLine: endToken?.endLine ?? token.endLine,
    endColumn: endToken?.endColumn ?? token.endColumn,
  } as any;
}
