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
  ParagraphBlock,
  ListItemMarker,
  Table,
  TableRow,
  LayoutDirective,
  Pagebreak,
  Columns,
  Box,
  Align,
  Header,
  Footer,
  Include,
  InlineText,
  InlineDirective,
  LuaExpr,
  InlineHardBreak,
  Anchor,
  Def,
  Style,
  DocumentConfig,
  ParseResult,
} from "../types/cst.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error, warning, DiagnosticCode } from "../types/diagnostics.ts";
import { loc } from "../types/source-location.ts";

/**
 * Parser result combining CST and diagnostics.
 */
interface ParseResultInternal {
  cst: Document;
  diagnostics: Diagnostic[];
}

/**
 * Current parsing context.
 */
interface ParseContext {
  tokens: Token[];
  pos: number;
  diagnostics: Diagnostic[];
  /** EOF-close recovery flag */
  incomplete?: boolean;
}

/**
 * Main parsing function.
 */
export function parseSource(tokens: Token[]): ParseResult {
  const ctx: ParseContext = {
    tokens,
    pos: 0,
    diagnostics: [],
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
 * Get current token and advance.
 */
function advanceToken(ctx: ParseContext): Token | undefined {
  if (ctx.pos >= ctx.tokens.length) return undefined;
  const token = ctx.tokens[ctx.pos];
  ctx.pos++;
  return token;
}

/**
 * Parse a complete document (top-level blocks).
 */
function parseDocument(ctx: ParseContext): Document {
  const startLoc = loc(1, 1);
  const children: any[] = [];

  while (!ctx.incomplete && ctx.pos < ctx.tokens.length) {
    const token = peekToken(ctx);

    if (!token) break;

    // Skip blank lines, comments, and whitespace (trivia)
    if (token.type === TokenType.BLANK_LINE || token.type === TokenType.COMMENT || token.type === TokenType.TEXT) {
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
    if (token.type === TokenType.LIST_BULLET || token.type === TokenType.LIST_ORDERED || token.type === TokenType.LIST_CONTINUATION) {
      const item = parseListItemMarker(ctx);
      if (item) children.push(item);
      continue;
    }

    // Parse paragraph block (only at top level)
    if (token.type === TokenType.PARA_OPEN) {
      const para = parseParagraphBlock(ctx);
      if (para) children.push(para);
      continue;
    }

    // EOF — stop parsing
    if (token.type === TokenType.EOF) {
      break;
    }

    // Unknown token - emit error and continue
    ctx.diagnostics.push(
      error(
        DiagnosticCode.UNEXPECTED_TOKEN,
        `Unexpected token: ${token.type}`,
        loc(token.line, token.column)
      )
    );
    ctx.pos++;
  }

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
  let body: StructuralBody | undefined;

  // Parse args if present (no newline between directive name and args)
  const nextToken = peekToken(ctx);
  if (nextToken && nextToken.type === TokenType.LPAREN) {
    argsRaw = parseArgs(ctx);
  }

  // Parse body if present and it's a structural opener (no newline between)
  const bodyToken = peekToken(ctx);
  if (bodyToken && bodyToken.type === TokenType.LBRACE) {
    body = parseStructuralBody(ctx) ?? undefined;
  }

  // Sugar form @name[...]: only consume if there's NO newline between
  // the directive/args/body and the paragraph block
  const paraToken = peekToken(ctx);
  if (paraToken && paraToken.type === TokenType.PARA_OPEN) {
    const para = parseParagraphBlock(ctx);
    if (para) {
      return {
        kind: "Directive",
        loc: loc(startToken.line, startToken.column),
        name,
        argsRaw,
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
  const children: any[] = [];

  while (ctx.pos < ctx.tokens.length) {
    const token = peekToken(ctx);
    if (!token) break;

    if (token.type === TokenType.RBRACE) {
      ctx.pos++; // consume RBRACE
      break;
    }

    // Skip trivia
    if (token.type === TokenType.BLANK_LINE || token.type === TokenType.COMMENT || token.type === TokenType.TEXT) {
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
    if (token.type === TokenType.LIST_BULLET || token.type === TokenType.LIST_ORDERED || token.type === TokenType.LIST_CONTINUATION) {
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

    // EOF in structural body — handled by unterminated check below
    if (token.type === TokenType.EOF) {
      break;
    }

    // Unknown - skip
    ctx.pos++;
  }

  // Unterminated - EOF-close recovery
  if (ctx.pos >= ctx.tokens.length) {
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
 * Parse a list marker: @- or @# with optional body.
 */
function parseListItemMarker(ctx: ParseContext): ListItemMarker | null {
  const startToken = peekToken(ctx);
  if (!startToken) return null;

  const ordered = startToken.type === TokenType.LIST_ORDERED || startToken.type === TokenType.LIST_CONTINUATION;
  const depth = startToken.value.startsWith("@") ? startToken.value.length - 1 : 1;
  ctx.pos++;

  let argsRaw: string | undefined;
  let body: StructuralBody | undefined;

  // Parse args if present
  const nextToken = peekToken(ctx);
  if (nextToken && nextToken.type === TokenType.LPAREN) {
    argsRaw = parseArgs(ctx);
  }

  // Parse body if present and it's a structural opener
  const bodyToken = peekToken(ctx);
  if (bodyToken && bodyToken.type === TokenType.LBRACE) {
    body = parseStructuralBody(ctx) ?? undefined;
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
    case TokenType.NUMBER:
    case TokenType.PERIOD:
    case TokenType.COMMA:
    case TokenType.COLON:
    case TokenType.EQUALS:
    case TokenType.COMMENT: // comments are literal text in paragraph context (Spec §3.2)
    case TokenType.LPAREN:
    case TokenType.RPAREN:
    case TokenType.LBRACE:
    case TokenType.RBRACE:
    case TokenType.BOOLEAN:
    case TokenType.LENGTH:
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
      return `"${token.value}"`;
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
  let body: any[] | undefined;

  // Parse args if present
  const nextToken = peekToken(ctx);
  if (nextToken && nextToken.type === TokenType.LPAREN) {
    argsRaw = parseArgs(ctx);
  }

  // Parse inline body if present: { ... } in paragraph context → inline content
  const bodyToken = peekToken(ctx);
  if (bodyToken && bodyToken.type === TokenType.LBRACE) {
    ctx.pos++; // consume LBRACE
    body = [];
    let textBuffer = "";

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
