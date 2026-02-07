/**
 * LDOC Parser v3
 *
 * Converts tokens to v3 CST.
 * Uses recursive descent parsing.
 */

import { TokenType, type Token } from "../types/tokens.ts";
import type {
  Document,
  Directive,
  StructuralBody,
  RawBody,
  ParagraphBlock,
  ListItemMarker,
  InlineDirective,
  LuaExpr,
  ParseResult,
} from "../types/cst.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error, warning, DiagnosticCode } from "../types/diagnostics.ts";
import { loc } from "../types/source-location.ts";
import { parseArgsObject, type ArgsObject, type ParseArgsResult } from "../shared/args.ts";
import { getDirectiveContract } from "../bind/contracts.ts";

/**
 * Current parsing context.
 */
interface ParseContext {
  tokens: Token[];
  pos: number;
  diagnostics: Diagnostic[];
  /** Original source text — needed for raw body extraction (Spec §7.2) */
  source: string;
  /** EOF-close recovery flag */
  incomplete?: boolean;
}

/**
 * Parse raw args string into structured ArgsObject.
 * Strips parens, wraps in braces for JSON5 parsing (Spec §6.1).
 * On failure: emits a diagnostic, returns empty object (Spec §6.4 recovery).
 */
function parseArgsToObject(argsRaw: string, location: ReturnType<typeof loc>, diagnostics: Diagnostic[]): ArgsObject {
  const inner = argsRaw.slice(1, -1); // strip parens
  const wrapped = `{${inner}}`;
  const result = parseArgsObject(wrapped, location);
  if (isArgsParseError(result)) {
    diagnostics.push(result.error);
    return {};
  }
  return result;
}

function isArgsParseError(result: ArgsObject | ParseArgsResult): result is ParseArgsResult {
  return "ok" in result && (result as ParseArgsResult).ok === false;
}

/**
 * Main parsing function.
 */
export function parseSource(tokens: Token[], source: string): ParseResult {
  const ctx: ParseContext = {
    tokens,
    pos: 0,
    diagnostics: [],
    source,
  };

  const cst = parseDocument(ctx);
  return {
    cst,
    diagnostics: ctx.diagnostics,
    incomplete: ctx.incomplete,
  };
}

/**
 * Get current token or return undefined at EOF.
 */
function peekToken(ctx: ParseContext): Token | undefined {
  if (ctx.pos < ctx.tokens.length) {
    return ctx.tokens[ctx.pos];
  }
  return undefined;
}

/**
 * Check if a token is whitespace-only TEXT (spaces, tabs, carriage returns).
 */
function isWhitespaceText(token: Token): boolean {
  return token.type === TokenType.TEXT && /^[\t \r]+$/.test(token.value);
}

/**
 * Skip whitespace-only TEXT tokens (Spec §5.1: whitespace between name, args, body MAY appear).
 */
function skipWhitespaceText(ctx: ParseContext): void {
  while (ctx.pos < ctx.tokens.length) {
    const token = peekToken(ctx);
    if (!token || !isWhitespaceText(token)) break;
    ctx.pos++;
  }
}

/**
 * Skip whitespace-only TEXT tokens only if followed by a directive delimiter.
 * Used in inline/paragraph context where whitespace is meaningful content —
 * we must not consume spaces that precede literal text.
 */
function skipWhitespaceBeforeDelimiter(ctx: ParseContext, ...delimiters: TokenType[]): void {
  const saved = ctx.pos;
  skipWhitespaceText(ctx);
  const next = peekToken(ctx);
  if (!next || !delimiters.includes(next.type)) {
    ctx.pos = saved; // restore — whitespace is content, not trivia
  }
}

/**
 * Shared dispatch loop for document-level and structural body contexts.
 * Parses children until `terminator` is consumed or EOF is reached.
 *
 * @param terminator - Token type that closes the block (e.g. RBRACE), or null for document level.
 * @returns The parsed children.
 */
function parseStructuralChildren(ctx: ParseContext, terminator: TokenType | null): any[] {
  const children: any[] = [];

  while (!ctx.incomplete && ctx.pos < ctx.tokens.length) {
    const token = peekToken(ctx);
    if (!token) break;

    // Terminator — consume and stop
    if (terminator !== null && token.type === terminator) {
      ctx.pos++;
      break;
    }

    // Skip whitespace-only trivia (blank lines, comments, indentation)
    if (token.type === TokenType.BLANK_LINE || token.type === TokenType.COMMENT) {
      ctx.pos++;
      continue;
    }

    // Whitespace-only TEXT is trivia (indentation); other text-like tokens are user error
    if (token.type === TokenType.TEXT && isWhitespaceText(token)) {
      ctx.pos++;
      continue;
    }
    if (isTextLikeToken(token.type)) {
      // Non-whitespace text at structural level — silently dropped without this diagnostic
      ctx.diagnostics.push(
        warning(
          DiagnosticCode.UNEXPECTED_TOKEN,
          `Text content must be inside a paragraph block [...]. Found: "${token.value}"`,
          loc(token.line, token.column)
        )
      );
      ctx.pos++;
      continue;
    }

    // Parse directive
    if (token.type === TokenType.DIRECTIVE) {
      const directive = parseDirective(ctx);
      if (directive) children.push(directive);
      continue;
    }

    // Parse list marker
    if (token.type === TokenType.LIST_BULLET || token.type === TokenType.LIST_ORDERED) {
      const item = parseListItemMarker(ctx);
      if (item) children.push(item);
      continue;
    }

    // Parse paragraph block
    if (token.type === TokenType.PARA_OPEN) {
      const para = parseParagraphBlock(ctx);
      if (para) children.push(para);
      continue;
    }

    // EOF — stop parsing (structural body will detect unterminated below)
    if (token.type === TokenType.EOF) {
      break;
    }

    // Unknown token — emit error and skip
    ctx.diagnostics.push(
      error(
        DiagnosticCode.UNEXPECTED_TOKEN,
        `Unexpected token: ${token.type}`,
        loc(token.line, token.column)
      )
    );
    ctx.pos++;
  }

  return children;
}

/**
 * Parse a complete document (top-level blocks).
 */
function parseDocument(ctx: ParseContext): Document {
  const startLoc = loc(1, 1);
  const children = parseStructuralChildren(ctx, null);

  return {
    kind: "Document",
    loc: startLoc,
    children,
  };
}

/**
 * Parse a directive: @name or @name(args) or @name{ body }.
 */
function parseDirective(ctx: ParseContext): Directive | null {
  const startToken = peekToken(ctx);
  if (!startToken) return null;

  if (startToken.type !== TokenType.DIRECTIVE) return null;
  const name = startToken.value;
  ctx.pos++;

  let argsRaw: string | undefined;
  let args: ArgsObject | undefined;
  let body: StructuralBody | RawBody | undefined;

  // Skip whitespace between name and args/body (Spec §5.1)
  skipWhitespaceText(ctx);

  // Parse args if present
  const nextToken = peekToken(ctx);
  if (nextToken && nextToken.type === TokenType.LPAREN) {
    argsRaw = parseArgs(ctx);
    args = parseArgsToObject(argsRaw, loc(startToken.line, startToken.column), ctx.diagnostics);
    skipWhitespaceText(ctx);
  }

  // Parse body if present and it's a structural opener
  const bodyToken = peekToken(ctx);
  if (bodyToken && bodyToken.type === TokenType.LBRACE) {
    // Check if this directive uses raw body syntax (e.g. @lua — Spec §7.2)
    const contract = getDirectiveContract(name);
    if (contract?.bodySyntax === "raw") {
      const rawBody = parseRawBody(ctx, contract.rawFormat ?? "lua");
      return {
        kind: "Directive",
        loc: loc(startToken.line, startToken.column),
        name,
        argsRaw,
        args,
        body: rawBody ?? undefined,
      };
    }
    body = parseStructuralBody(ctx) ?? undefined;
    skipWhitespaceText(ctx);
  }

  // Sugar form @name[...]
  const paraToken = peekToken(ctx);
  if (paraToken && paraToken.type === TokenType.PARA_OPEN) {
    const para = parseParagraphBlock(ctx);
    if (para) {
      return {
        kind: "Directive",
        loc: loc(startToken.line, startToken.column),
        name,
        argsRaw,
        args,
        body: {
          kind: "StructuralBody",
          loc: loc(startToken.line, startToken.column),
          children: [para],
        },
      };
    }
  }

  return {
    kind: "Directive",
    loc: loc(startToken.line, startToken.column),
    name,
    argsRaw,
    args,
    body,
  };
}

/**
 * Parse directive arguments: (...) until matching RPAREN.
 */
function parseArgs(ctx: ParseContext): string {
  const startToken = peekToken(ctx);
  if (!startToken) return "";

  const startLoc = loc(startToken.line, startToken.column);
  let argsText = "(";
  let depth = 1;
  ctx.pos++; // consume LPAREN

  while (depth > 0 && ctx.pos < ctx.tokens.length) {
    const token = peekToken(ctx);
    if (!token) break;

    if (token.type === TokenType.LPAREN) depth++;
    else if (token.type === TokenType.RPAREN) {
      depth--;
      if (depth === 0) {
        ctx.pos++; // consume RPAREN
        argsText += ")";
        return argsText;
      }
    }

    argsText += tokenTextValue(token);
    ctx.pos++;
  }

  // Unterminated - EOF-close recovery
  ctx.incomplete = true;
  ctx.diagnostics.push(
    error(
      DiagnosticCode.UNCLOSED_DELIMITER,
      `Unterminated directive arguments at line ${startLoc.line}`,
      startLoc
    )
  );

  return argsText + ")";
}

/**
 * Parse a structural body: { ... }.
 */
function parseStructuralBody(ctx: ParseContext): StructuralBody | null {
  const startToken = peekToken(ctx);
  if (!startToken || startToken.type !== TokenType.LBRACE) return null;

  const startLoc = loc(startToken.line, startToken.column);
  ctx.pos++; // consume LBRACE

  const posBefore = ctx.pos;
  const children = parseStructuralChildren(ctx, TokenType.RBRACE);

  // Unterminated — parseStructuralChildren stopped without consuming RBRACE.
  // This happens when EOF is reached before finding the closing brace.
  // Detect by checking if the token just before current pos is NOT RBRACE.
  const prevToken = ctx.pos > posBefore ? ctx.tokens[ctx.pos - 1] : undefined;
  if (!prevToken || prevToken.type !== TokenType.RBRACE) {
    ctx.incomplete = true;
    ctx.diagnostics.push(
      error(
        DiagnosticCode.UNCLOSED_DELIMITER,
        `Unterminated structural body at line ${startLoc.line}`,
        startLoc
      )
    );
  }

  return {
    kind: "StructuralBody",
    loc: startLoc,
    children,
  };
}

/**
 * Convert (line, column) to absolute source offset.
 * Lines are 1-based, columns are 0-based (matching lexer convention).
 */
function sourceOffset(source: string, line: number, column: number): number {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < source.length) {
    if (source[offset] === "\n") {
      currentLine++;
    }
    offset++;
  }
  return offset + column;
}

/**
 * Parse a raw body for directives like @lua (Spec §7.2).
 *
 * Scans the source text with balanced brace counting that respects
 * Lua strings (single, double, long brackets) and comments (line, long).
 * This ensures nested {} in Lua tables/code don't prematurely end the block.
 *
 * After extracting the raw text, advances ctx.pos past all tokens that
 * fall within the raw body range.
 */
function parseRawBody(ctx: ParseContext, format: "lua"): RawBody | null {
  const startToken = peekToken(ctx);
  if (!startToken || startToken.type !== TokenType.LBRACE) return null;

  const startLoc = loc(startToken.line, startToken.column);
  const source = ctx.source;

  // Find the absolute offset of the opening brace in source
  const openOffset = sourceOffset(source, startToken.line, startToken.column);

  // Scan source from after the opening brace with Lua-aware balanced brace counting
  let depth = 1;
  let i = openOffset + 1; // skip the opening {
  const len = source.length;

  while (i < len && depth > 0) {
    const ch = source[i]!;

    // Lua single-line comment: -- (may start long comment --[[ or --[=[ )
    if (ch === "-" && i + 1 < len && source[i + 1] === "-") {
      i += 2;
      // Check for long comment: --[=*[
      const longLevel = scanLongBracketOpen(source, i);
      if (longLevel >= 0) {
        i = skipLongString(source, i, longLevel);
      } else {
        // Single-line comment: skip to end of line
        while (i < len && source[i] !== "\n") i++;
      }
      continue;
    }

    // Lua long string: [=*[
    if (ch === "[") {
      const longLevel = scanLongBracketOpen(source, i);
      if (longLevel >= 0) {
        i = skipLongString(source, i, longLevel);
        continue;
      }
    }

    // Lua single-quoted string
    if (ch === "'") {
      i = skipLuaShortString(source, i, "'");
      continue;
    }

    // Lua double-quoted string
    if (ch === '"') {
      i = skipLuaShortString(source, i, '"');
      continue;
    }

    // Brace counting (only in code context)
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }

    if (ch === "}") {
      depth--;
      if (depth === 0) {
        // Found the matching close brace
        const rawText = source.slice(openOffset + 1, i);

        // Advance ctx.pos past all tokens within this range
        ctx.pos++; // skip the opening LBRACE token
        while (ctx.pos < ctx.tokens.length) {
          const tok = ctx.tokens[ctx.pos]!;
          // Stop when we reach the closing RBRACE at offset i
          if (tok.type === TokenType.RBRACE) {
            const tokOffset = sourceOffset(source, tok.line, tok.column);
            if (tokOffset >= i) {
              ctx.pos++; // consume the closing RBRACE token
              break;
            }
          }
          ctx.pos++;
        }

        return {
          kind: "RawBody",
          format,
          text: rawText,
          loc: startLoc,
        };
      }
      i++;
      continue;
    }

    i++;
  }

  // Unterminated — EOF-close recovery
  ctx.pos++; // skip the opening LBRACE token
  // Advance past all remaining tokens
  while (ctx.pos < ctx.tokens.length) {
    const tok = ctx.tokens[ctx.pos]!;
    if (tok.type === TokenType.EOF) break;
    ctx.pos++;
  }

  ctx.incomplete = true;
  ctx.diagnostics.push(
    error(
      DiagnosticCode.UNCLOSED_DELIMITER,
      `Unterminated raw body at line ${startLoc.line}`,
      startLoc
    )
  );

  return {
    kind: "RawBody",
    format,
    text: source.slice(openOffset + 1),
    loc: startLoc,
  };
}

/**
 * Check if source at position `i` starts a Lua long bracket opening: [=*[
 * Returns the level (number of = signs, 0 for [[) or -1 if not a long bracket.
 */
function scanLongBracketOpen(source: string, i: number): number {
  if (i >= source.length || source[i] !== "[") return -1;
  let j = i + 1;
  let level = 0;
  while (j < source.length && source[j] === "=") {
    level++;
    j++;
  }
  if (j < source.length && source[j] === "[") {
    return level;
  }
  return -1;
}

/**
 * Skip past a Lua long string/comment body.
 * `i` points to the opening `[` of `[=*[`.
 * Returns position after the closing `]=*]`.
 */
function skipLongString(source: string, i: number, level: number): number {
  // Skip past the opening [=*[
  i += 2 + level; // [ + =*level + [
  const closer = "]" + "=".repeat(level) + "]";
  const end = source.indexOf(closer, i);
  if (end === -1) return source.length; // unterminated — skip to EOF
  return end + closer.length;
}

/**
 * Skip past a Lua short string (single or double quoted).
 * `i` points to the opening quote.
 * Returns position after the closing quote.
 */
function skipLuaShortString(source: string, i: number, quote: string): number {
  i++; // skip opening quote
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2; // skip escape sequence
      continue;
    }
    if (source[i] === quote) {
      return i + 1; // skip closing quote
    }
    if (source[i] === "\n") {
      // Lua short strings don't span lines (unless escaped with \)
      return i; // unterminated — stop at newline
    }
    i++;
  }
  return i; // unterminated — hit EOF
}

/**
 * Parse a list marker: @- or @# with optional body.
 */
function parseListItemMarker(ctx: ParseContext): ListItemMarker | null {
  const startToken = peekToken(ctx);
  if (!startToken) return null;

  const ordered = startToken.type === TokenType.LIST_ORDERED;
  const depth = startToken.value.startsWith("@") ? startToken.value.length - 1 : 1;
  ctx.pos++;

  let argsRaw: string | undefined;
  let args: ArgsObject | undefined;
  let body: StructuralBody | undefined;

  // Skip whitespace between marker and args/body (Spec §5.1)
  skipWhitespaceText(ctx);

  // Parse args if present
  const nextToken = peekToken(ctx);
  if (nextToken && nextToken.type === TokenType.LPAREN) {
    argsRaw = parseArgs(ctx);
    args = parseArgsToObject(argsRaw, loc(startToken.line, startToken.column), ctx.diagnostics);
    skipWhitespaceText(ctx);
  }

  // Parse body if present and it's a structural opener
  const bodyToken = peekToken(ctx);
  if (bodyToken && bodyToken.type === TokenType.LBRACE) {
    body = parseStructuralBody(ctx) ?? undefined;
    skipWhitespaceText(ctx);
  }

  // Sugar form: @#[...] or @-[...] (Spec §11.4)
  const paraToken = peekToken(ctx);
  if (paraToken && paraToken.type === TokenType.PARA_OPEN) {
    const para = parseParagraphBlock(ctx);
    if (para) {
      body = {
        kind: "StructuralBody",
        loc: loc(startToken.line, startToken.column),
        children: [para],
      };
    }
  }

  return {
    kind: "ListItemMarker",
    loc: loc(startToken.line, startToken.column),
    ordered,
    depth,
    argsRaw,
    args,
    body,
  };
}

/**
 * Check if a token type is "text-like" in paragraph context.
 * In paragraph context, most tokens that aren't structural delimiters
 * or special constructs should be treated as plain text content.
 */
function isTextLikeToken(type: TokenType): boolean {
  switch (type) {
    case TokenType.TEXT:
    case TokenType.IDENTIFIER:
    case TokenType.STRING:
    case TokenType.PERIOD:
    case TokenType.COMMA:
    case TokenType.COLON:
    case TokenType.EQUALS:
    case TokenType.COMMENT: // comments are literal text in paragraph context (Spec §3.2)
    case TokenType.LPAREN:
    case TokenType.RPAREN:
    case TokenType.LBRACE:
    case TokenType.RBRACE:
      return true;
    default:
      return false;
  }
}

/**
 * Get the original text representation of a token for use in paragraph context.
 * Some tokens (like STRING) need their delimiters restored.
 */
function tokenTextValue(token: Token): string {
  switch (token.type) {
    case TokenType.STRING:
      return `${token.quote ?? '"'}${token.value}${token.quote ?? '"'}`;
    case TokenType.COMMENT:
      return `//${token.value}`;
    default:
      return token.value;
  }
}

/**
 * Parse a paragraph block: [ ... ].
 */
function parseParagraphBlock(ctx: ParseContext): ParagraphBlock | null {
  const startToken = peekToken(ctx);
  if (!startToken || startToken.type !== TokenType.PARA_OPEN) return null;

  const startLoc = loc(startToken.line, startToken.column);
  ctx.pos++; // consume PARA_OPEN
  const inlines: any[] = [];

  // Normalize newlines: single newline → soft space, blank line(s) → hard breaks
  let textBuffer = "";

  while (ctx.pos < ctx.tokens.length) {
    const token = peekToken(ctx);
    if (!token) break;

    // Nested paragraph block — Spec §4.2: "Paragraph blocks MUST NOT be nested."
    // Emit a diagnostic and treat `[` as literal text.
    if (token.type === TokenType.PARA_OPEN) {
      ctx.diagnostics.push(
        warning(
          DiagnosticCode.UNEXPECTED_TOKEN,
          `Nested paragraph blocks are not allowed (Spec §4.2). Treating '[' as literal text.`,
          loc(token.line, token.column)
        )
      );
      textBuffer += "[";
      ctx.pos++;
      continue;
    }

    if (token.type === TokenType.PARA_CLOSE) {
      ctx.pos++; // consume PARA_CLOSE

      // Flush text buffer
      if (textBuffer) {
        inlines.push({
          kind: "InlineText",
          loc: startLoc,
          text: textBuffer,
        });
      }

      break;
    }

    // Handle blank lines (newlines) — Spec §4.3
    if (token.type === TokenType.BLANK_LINE) {
      // Count consecutive blank lines
      let blankCount = 0;
      while (ctx.pos < ctx.tokens.length && peekToken(ctx)?.type === TokenType.BLANK_LINE) {
        blankCount++;
        ctx.pos++;
      }

      // Check if we hit PARA_CLOSE or EOF — trailing newlines are trimmed (Spec §4.3)
      const nextToken = peekToken(ctx);
      if (!nextToken || nextToken.type === TokenType.PARA_CLOSE) {
        // Trailing newlines — trim them (don't add anything)
        continue;
      }

      // Check if textBuffer is empty (leading newlines) — also trim
      if (!textBuffer && inlines.length === 0) {
        continue;
      }

      if (blankCount >= 2) {
        // N >= 2 consecutive newlines → N-1 hard breaks
        // Flush text first
        if (textBuffer) {
          inlines.push({
            kind: "InlineText",
            loc: startLoc,
            text: textBuffer,
          });
          textBuffer = "";
        }

        for (let i = 0; i < blankCount - 1; i++) {
          inlines.push({
            kind: "InlineHardBreak",
            loc: loc(token.line, token.column),
          });
        }
      } else {
        // Single newline → soft wrap → space
        textBuffer += " ";
      }

      continue;
    }

    // Parse Lua expression
    if (token.type === TokenType.LUA_EXPR_OPEN) {
      // Flush any buffered text
      if (textBuffer) {
        inlines.push({
          kind: "InlineText",
          loc: startLoc,
          text: textBuffer,
        });
        textBuffer = "";
      }

      const expr = parseLuaExpr(ctx);
      if (expr) inlines.push(expr);
      continue;
    }

    // Handle inline directives (Spec §5.3 — in paragraph context, @name{...} is inline)
    if (token.type === TokenType.DIRECTIVE) {
      // Flush any buffered text
      if (textBuffer) {
        inlines.push({
          kind: "InlineText",
          loc: startLoc,
          text: textBuffer,
        });
        textBuffer = "";
      }

      const inlineDir = parseInlineDirective(ctx);
      if (inlineDir) inlines.push(inlineDir);
      continue;
    }

    // All other tokens are text content in paragraph context
    if (isTextLikeToken(token.type)) {
      textBuffer += tokenTextValue(token);
      ctx.pos++;
      continue;
    }

    // Truly unknown token in paragraph — consume as text to avoid infinite loop
    textBuffer += token.value;
    ctx.pos++;
  }

  // Unterminated - EOF-close recovery
  if (ctx.pos >= ctx.tokens.length) {
    ctx.incomplete = true;
    ctx.diagnostics.push(
      error(
        DiagnosticCode.UNCLOSED_DELIMITER,
        `Unterminated paragraph block at line ${startLoc.line}`,
        startLoc
      )
    );

    // Flush remaining text
    if (textBuffer) {
      inlines.push({
        kind: "InlineText",
        loc: startLoc,
        text: textBuffer,
      });
    }
  }

  return {
    kind: "ParagraphBlock",
    loc: startLoc,
    inlines,
  };
}

/**
 * Parse an inline directive inside paragraph context.
 * e.g. @style(r: { bold: true }){important text}
 */
function parseInlineDirective(ctx: ParseContext): InlineDirective | null {
  const startToken = peekToken(ctx);
  if (!startToken || startToken.type !== TokenType.DIRECTIVE) return null;

  const name = startToken.value;
  const startLoc = loc(startToken.line, startToken.column);
  ctx.pos++; // consume DIRECTIVE

  let argsRaw: string | undefined;
  let args: ArgsObject | undefined;
  let body: any[] | undefined;

  // Skip whitespace between name and args/body only if followed by a delimiter (Spec §5.1).
  // In paragraph context, whitespace is literal content — don't consume it blindly.
  skipWhitespaceBeforeDelimiter(ctx, TokenType.LPAREN, TokenType.LBRACE);

  // Parse args if present
  const nextToken = peekToken(ctx);
  if (nextToken && nextToken.type === TokenType.LPAREN) {
    argsRaw = parseArgs(ctx);
    args = parseArgsToObject(argsRaw, startLoc, ctx.diagnostics);
    skipWhitespaceBeforeDelimiter(ctx, TokenType.LBRACE);
  }

  // Parse inline body if present: { ... } in paragraph context → inline content
  const bodyToken = peekToken(ctx);
  if (bodyToken && bodyToken.type === TokenType.LBRACE) {
    ctx.pos++; // consume LBRACE
    body = [];
    let textBuffer = "";
    let bodyClosed = false;

    while (ctx.pos < ctx.tokens.length) {
      const token = peekToken(ctx);
      if (!token) break;

      if (token.type === TokenType.RBRACE) {
        // Flush text buffer
        if (textBuffer) {
          body.push({
            kind: "InlineText",
            loc: loc(token.line, token.column),
            text: textBuffer,
          });
        }
        ctx.pos++; // consume RBRACE
        bodyClosed = true;
        break;
      }

      if (token.type === TokenType.LUA_EXPR_OPEN) {
        if (textBuffer) {
          body.push({
            kind: "InlineText",
            loc: startLoc,
            text: textBuffer,
          });
          textBuffer = "";
        }
        const expr = parseLuaExpr(ctx);
        if (expr) body.push(expr);
        continue;
      }

      if (token.type === TokenType.DIRECTIVE) {
        if (textBuffer) {
          body.push({
            kind: "InlineText",
            loc: startLoc,
            text: textBuffer,
          });
          textBuffer = "";
        }
        const nested = parseInlineDirective(ctx);
        if (nested) body.push(nested);
        continue;
      }

      if (isTextLikeToken(token.type)) {
        textBuffer += tokenTextValue(token);
        ctx.pos++;
        continue;
      }

      // Default: consume as text
      textBuffer += token.value;
      ctx.pos++;
    }

    // EOF-close recovery: loop exited without consuming RBRACE
    if (!bodyClosed) {
      if (textBuffer) {
        body.push({
          kind: "InlineText",
          loc: startLoc,
          text: textBuffer,
        });
      }
      ctx.incomplete = true;
      ctx.diagnostics.push(
        error(
          DiagnosticCode.UNCLOSED_DELIMITER,
          `Unterminated inline directive body at line ${startLoc.line}`,
          startLoc
        )
      );
    }
  }

  // Sugar form: @name[...] in paragraph context (Spec §5.5)
  const paraToken = peekToken(ctx);
  if (paraToken && paraToken.type === TokenType.PARA_OPEN) {
    const para = parseParagraphBlock(ctx);
    if (para) {
      // Inline directive with paragraph sugar — inline the paragraph's inlines as body
      body = para.inlines;
    }
  }

  return {
    kind: "InlineDirective",
    loc: startLoc,
    name,
    argsRaw,
    args,
    body,
  };
}

/**
 * Parse a Lua expression: $(...).
 */
function parseLuaExpr(ctx: ParseContext): LuaExpr | null {
  const startToken = peekToken(ctx);
  if (!startToken || startToken.type !== TokenType.LUA_EXPR_OPEN) return null;

  const startLoc = loc(startToken.line, startToken.column);
  ctx.pos++; // consume LUA_EXPR_OPEN (the `$(` token)

  let expr = "";
  let depth = 1;

  while (depth > 0 && ctx.pos < ctx.tokens.length) {
    const token = peekToken(ctx);
    if (!token) break;

    if (token.type === TokenType.LPAREN) depth++;
    else if (token.type === TokenType.RPAREN) {
      depth--;
      if (depth === 0) {
        ctx.pos++; // consume RPAREN
        return {
          kind: "LuaExpr",
          loc: startLoc,
          expr,
        };
      }
    }

    expr += token.value;
    ctx.pos++;
  }

  // Unterminated - EOF-close recovery
  ctx.incomplete = true;
  ctx.diagnostics.push(
    error(
      DiagnosticCode.UNCLOSED_DELIMITER,
      `Unterminated Lua expression at line ${startLoc.line}`,
      startLoc
    )
  );

  return {
    kind: "LuaExpr",
    loc: startLoc,
    expr,
  };
}
