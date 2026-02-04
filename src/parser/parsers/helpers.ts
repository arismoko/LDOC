/**
 * Shared helpers for parsing indented blocks
 */

import { TokenType, type Token } from "../lexer";
import type { ParserContext } from "./inline";
import type { Node } from "../ast";
import { pushBlankLines } from "../utils";

export interface BlockResult {
  content: Node[];
  hasEnd: boolean;
  /** The last consumed token (DEDENT or @end), for tracking end position */
  endToken?: Token;
}

/**
 * Parse an indented block with optional @end.
 * Handles:
 * - Consuming INDENT/DEDENT
 * - Parsing child nodes
 * - Preserving blank lines
 * - Optional @end consumption with position restore if not found
 *
 * @param ctx Parser context
 * @param options.required If true, throws if no indent block follows
 * @param options.directiveName Name for error messages (e.g., "@repeat")
 * @returns Block content and whether @end was present
 */
export function parseIndentedBlock(
  ctx: ParserContext,
  options: { required?: boolean; directiveName?: string } = {}
): BlockResult {
  const content: Node[] = [];
  let hasEnd = false;
  let endToken: Token | undefined;

  const la = ctx.stream.lookaheadNewlinesThenIndent();
  if (!la.indentAfter) {
    if (options.required) {
      const token = ctx.stream.peek();
      throw new Error(
        `${options.directiveName ?? "Block"} must be followed by an indented block (line ${token.line})`
      );
    }
    return { content, hasEnd };
  }

  // Consume leading newlines, track blank lines
  const start = ctx.stream.peek();
  const n = ctx.stream.consumeNewlines();
  pushBlankLines(content, start.line, start.column, n);

  // Enter indented block
  if (!ctx.stream.check(TokenType.INDENT)) {
    if (options.required) {
      throw new Error(
        `${options.directiveName ?? "Block"} expected an indented block (line ${ctx.stream.peek().line})`
      );
    }
    return { content, hasEnd };
  }
  ctx.stream.advance(); // INDENT

  // Parse block contents
  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
    if (ctx.stream.check(TokenType.NEWLINE)) {
      const s = ctx.stream.peek();
      const nn = ctx.stream.consumeNewlines();
      pushBlankLines(content, s.line, s.column, nn);
      continue;
    }
    if (ctx.stream.check(TokenType.DEDENT)) break;

    const child = ctx.parseNode();
    if (child) content.push(child);
  }

  if (ctx.stream.check(TokenType.DEDENT)) {
    endToken = ctx.stream.advance();
  }

  // Optional @end - only consume newlines if @end follows
  const savedPos = ctx.stream.getPosition();
  while (ctx.stream.check(TokenType.NEWLINE)) {
    ctx.stream.advance();
  }
  if (ctx.stream.check(TokenType.END)) {
    endToken = ctx.stream.advance();
    hasEnd = true;
  } else {
    // No @end found, restore position to preserve blank lines
    ctx.stream.setPosition(savedPos);
  }

  return { content, hasEnd, endToken };
}

/**
 * Parse inline content on the same line (for modifiers that support both forms)
 */
export function parseSameLineContent(ctx: ParserContext): Node | null {
  // Import inline parsing
  const { parseParagraph } = require("./block");
  return parseParagraph(ctx);
}
