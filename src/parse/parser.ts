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
import { error, DiagnosticCode } from "../types/diagnostics.ts";
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

    // Skip blank lines and comments (trivia)
    if (token.type === TokenType.BLANK_LINE || token.type === TokenType.COMMENT) {
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

  // Parse args if present
  const nextToken = peekToken(ctx);
  if (nextToken && nextToken.type === TokenType.LPAREN) {
    argsRaw = parseArgs(ctx);
  }

  // Parse body if present and it's a structural opener
  const bodyToken = peekToken(ctx);
  if (bodyToken && bodyToken.type === TokenType.LBRACE) {
    body = parseStructuralBody(ctx);
  }

  // If there's a paragraph block after (sugar form @name[...]), handle it
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

    argsText += token.value;
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
    if (token.type === TokenType.BLANK_LINE || token.type === TokenType.COMMENT) {
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
    body = parseStructuralBody(ctx);
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
 * Parse a paragraph block: [ ... ].
 */
function parseParagraphBlock(ctx: ParseContext): ParagraphBlock | null {
  const startToken = peekToken(ctx);
  if (!startToken || startToken.type !== TokenType.PARA_OPEN) return null;

  const startLoc = loc(startToken.line, startToken.column);
  ctx.pos++; // consume PARA_OPEN
  const inlines: any[] = [];

  // Normalize newlines: single newline → soft space, blank line(s) → hard breaks
  let consecutiveNewlines = 0;
  let textBuffer = "";

  while (ctx.pos < ctx.tokens.length) {
    const token = peekToken(ctx);
    if (!token) break;

    // Nested paragraph block
    if (token.type === TokenType.PARA_OPEN) {
      // Flush current text buffer
      if (textBuffer) {
        inlines.push({
          kind: "InlineText",
          loc: loc(token.line, token.column),
          text: textBuffer,
        });
        textBuffer = "";
      }

      // Recursively parse nested paragraph
      const nestedPara = parseParagraphBlock(ctx);
      if (nestedPara) {
        inlines.push(nestedPara);
      }

      consecutiveNewlines = 0;
      continue;
    }

    if (token.type === TokenType.PARA_CLOSE) {
      ctx.pos++; // consume PARA_CLOSE

      // Flush text buffer
      if (textBuffer) {
        inlines.push({
          kind: "InlineText",
          loc: loc(token.line, token.column),
          text: textBuffer,
        });
      }

      // Add hard breaks for consecutive newlines
      if (consecutiveNewlines >= 2) {
        for (let i = 0; i < consecutiveNewlines - 1; i++) {
          inlines.push({
            kind: "InlineHardBreak",
            loc: loc(token.line, token.column),
          });
        }
      }

      break;
    }

    // Handle text tokens
    if (token.type === TokenType.TEXT) {
      // Text after blank lines → add hard breaks
      if (consecutiveNewlines >= 2) {
        for (let i = 0; i < consecutiveNewlines - 1; i++) {
          inlines.push({
            kind: "InlineHardBreak",
            loc: loc(token.line, token.column),
          });
        }
        consecutiveNewlines = 0;
      }

      textBuffer += token.value;
      ctx.pos++;
      continue;
    }

    // Handle blank lines (newlines)
    if (token.type === TokenType.BLANK_LINE) {
      // End of current text
      if (textBuffer) {
        inlines.push({
          kind: "InlineText",
          loc: loc(token.line, token.column),
          text: textBuffer,
        });
        textBuffer = "";
      }

      // Count consecutive blank lines
      const nextToken = peekToken(ctx);
      let blankCount = 1;
      if (nextToken && nextToken.type === TokenType.BLANK_LINE) {
        ctx.pos++;
        blankCount++;
      }

      // Consecutive blank lines: >1 → hard break, 1 → treat as paragraph end (handled by whitespace)
      if (blankCount >= 2) {
        for (let i = 0; i < blankCount - 1; i++) {
          inlines.push({
            kind: "InlineHardBreak",
            loc: loc(token.line, token.column),
          });
        }
      }

      ctx.pos++;
      continue;
    }

    // Parse Lua expression
    if (token.type === TokenType.LUA_EXPR_OPEN) {
      // Flush any buffered text
      if (textBuffer) {
        inlines.push({
          kind: "InlineText",
          loc: loc(token.line, token.column),
          text: textBuffer,
        });
        textBuffer = "";
      }
      consecutiveNewlines = 0;

      const expr = parseLuaExpr(ctx);
      if (expr) inlines.push(expr);
      continue;
    }

    // Unknown token - skip
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
        loc: loc(startToken.line, startToken.column),
        text: textBuffer,
      });
    }

    // Add hard breaks for consecutive newlines
    if (consecutiveNewlines >= 2) {
      for (let i = 0; i < consecutiveNewlines - 1; i++) {
        inlines.push({
          kind: "InlineHardBreak",
          loc: loc(startToken.line, startToken.column),
        });
      }
    }
  }

  return {
    kind: "ParagraphBlock",
    loc: startLoc,
    inlines,
  };
}

/**
 * Parse a Lua expression: $(...).
 */
function parseLuaExpr(ctx: ParseContext): LuaExpr | null {
  const startToken = peekToken(ctx);
  if (!startToken || startToken.type !== TokenType.LUA_EXPR_OPEN) return null;

  const startLoc = loc(startToken.line, startToken.column);
  ctx.pos++; // consume LUA_EXPR_OPEN

  let expr = "";
  let depth = 1;
  ctx.pos++; // consume $(
  const openParen = startToken.value.length - 1;

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
