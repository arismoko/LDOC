import { TokenType } from "../lexer";
import type { DocumentNode, MetaNode, ImportNode, Node, ColumnsRegionNode, NumberingScheme } from "../ast";
import { type ParserContext, parseTextUntilNewline, parseRestOfLineRaw } from "./inline";
import { pushBlankLines, consumeEndBlockOrThrow, parseLengthToTwip, parseLiteral } from "../utils";
import { parseParagraph } from "./block";

function parseMetaBlock(ctx: ParserContext): Record<string, any> {
  const data: Record<string, any> = {};

  if (ctx.stream.check(TokenType.INDENT)) {
    ctx.stream.advance();

    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      if (ctx.stream.check(TokenType.END_BLOCK)) {
        consumeEndBlockOrThrow(ctx, "meta_block");
        break;
      }

      ctx.stream.skipNewlines();
      if (ctx.stream.check(TokenType.DEDENT)) break;
      if (ctx.stream.isAtEnd()) break;

      const lineText = parseTextUntilNewline(ctx);
      
      // If we got no text, avoid infinite loop
      if (!lineText) {
        if (!ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.DEDENT) && !ctx.stream.isAtEnd()) {
          ctx.stream.advance();
        }
        continue;
      }
      
      const colonIndex = lineText.indexOf(":");

      if (colonIndex > 0) {
        const key = lineText.slice(0, colonIndex).trim();
        const value = lineText.slice(colonIndex + 1).trim();
        if (!value) {
          // Look ahead for nested block
          const la = ctx.stream.lookaheadNewlinesThenIndent();
          if (la.indentAfter) {
            ctx.stream.consumeNewlines();
            data[key] = parseMetaBlock(ctx);
          } else {
            data[key] = "";
          }
        } else {
          data[key] = parseLiteral(value);
        }
      }

      ctx.stream.skipNewlines();
    }

    if (ctx.stream.check(TokenType.DEDENT)) {
      ctx.stream.advance();
    }
  }

  return data;
}

export function parseMeta(ctx: ParserContext): MetaNode {
  const token = ctx.stream.advance();
  ctx.stream.skipNewlines();

  const data: Record<string, any> = {};

  if (ctx.stream.check(TokenType.INDENT)) {
    ctx.stream.advance();

    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      if (ctx.stream.check(TokenType.END_BLOCK)) {
        consumeEndBlockOrThrow(ctx, "meta");
        break;
      }

      ctx.stream.skipNewlines();
      if (ctx.stream.check(TokenType.DEDENT)) break;
      if (ctx.stream.isAtEnd()) break;

      // Parse key: value pairs
      const lineText = parseTextUntilNewline(ctx);
      
      // If we got no text, we need to break to avoid infinite loop
      if (!lineText) {
        // Skip one token if we're stuck
        if (!ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.DEDENT) && !ctx.stream.isAtEnd()) {
          ctx.stream.advance();
        }
        continue;
      }
      
      const colonIndex = lineText.indexOf(":");

      if (colonIndex > 0) {
        const key = lineText.slice(0, colonIndex).trim();
        const value = lineText.slice(colonIndex + 1).trim();

        // Handle nested objects (simplified)
        if (!value) {
          // Nested block - look ahead for newlines then indent
          const la = ctx.stream.lookaheadNewlinesThenIndent();
          if (la.indentAfter) {
            ctx.stream.consumeNewlines();
            data[key] = parseMetaBlock(ctx);
          } else {
            // No nested block, treat as empty string
            data[key] = "";
          }
        } else {
          data[key] = parseLiteral(value);
        }
      }

      ctx.stream.skipNewlines();
    }

    if (ctx.stream.check(TokenType.DEDENT)) {
      ctx.stream.advance();
    }
  }

  return {
    type: "meta",
    line: token.line,
    column: token.column,
    data,
  };
}

export function parseImport(ctx: ParserContext): ImportNode {
  const token = ctx.stream.advance();
  ctx.stream.skipWhitespaceTokens();
  const path = parseTextUntilNewline(ctx);

  return {
    type: "import",
    line: token.line,
    column: token.column,
    path,
  };
}

export function parseDocument(ctx: ParserContext, sourcePath?: string): DocumentNode {
  let document: Record<string, any> | undefined;
  let meta: MetaNode | undefined;
  let numberingScheme: NumberingScheme | undefined;
  const imports: ImportNode[] = [];
  const body: Node[] = [];

  // Skip leading newlines
  ctx.stream.skipNewlines();

  // Parse @document if present
  if (ctx.stream.check(TokenType.DOCUMENT)) {
    ctx.stream.advance();

    // Block settings:
    // @document
    //   title: ...
    //   short_title: ...
    //   numbering: ...
    const la = ctx.stream.lookaheadNewlinesThenIndent();
    if (la.indentAfter) {
      ctx.stream.consumeNewlines();
      document = parseMetaBlock(ctx);

      // Convenience: normalize dash-keys to underscore variants
      for (const [k, v] of Object.entries(document)) {
        if (k.includes("-")) {
          const u = k.replace(/-/g, "_");
          if (!(u in document)) (document as any)[u] = v;
        }
      }
    }

    // No legacy inline form
    if (!document && !ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
      const got = parseTextUntilNewline(ctx);
      throw new Error(`@document must be a block (indented key/value). Got inline content: ${got}`);
    }

    ctx.stream.skipNewlines();
  }

  // Parse preamble directives (allow comments/blank lines before them)
  while (!ctx.stream.isAtEnd()) {
    if (ctx.stream.check(TokenType.NEWLINE)) {
      ctx.stream.advance();
      continue;
    }

    if (ctx.stream.check(TokenType.COMMENT) || ctx.stream.check(TokenType.TODO)) {
      // Ignore preamble comments; they are not rendered anyway
      ctx.stream.advance();
      continue;
    }

    if (ctx.stream.check(TokenType.IMPORT)) {
      imports.push(parseImport(ctx));
      continue;
    }

    if (ctx.stream.check(TokenType.META)) {
      meta = parseMeta(ctx);
      continue;
    }

    break;
  }

  // Parse body (preserve blank lines as spacing)
  while (!ctx.stream.isAtEnd()) {
    if (ctx.stream.check(TokenType.NEWLINE)) {
      const start = ctx.stream.peek();
      const n = ctx.stream.consumeNewlines();
      pushBlankLines(body, start.line, start.column, n);
      continue;
    }

    const node = ctx.parseNode();
    if (node) {
      body.push(node);
    }
  }

  // Extract numberingScheme from @document block if present
  if (document?.numbering) {
    const schemeArg = String(document.numbering).toLowerCase();
    if (schemeArg !== "default" && schemeArg !== "decimal") {
      throw new Error(
        `@document numbering must be 'default' or 'decimal'. Got: ${schemeArg}`
      );
    }
    numberingScheme = schemeArg as NumberingScheme;
  }

  return {
    type: "document",
    line: 1,
    column: 1,
    document,
    meta,
    imports,
    sourcePath,
    numberingScheme,
    body,
  };
}

function parseDocHeaderFooter(
  ctx: ParserContext,
  type: "doc_header" | "doc_footer",
  scope: "default" | "first" | "even"
): Node {
  const token = ctx.stream.advance();
  const content: Node[] = [];

  // Same-line content
  if (!ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
    const para = parseParagraph(ctx);
    if (para) content.push(para);
    // leave trailing newlines to outer loop
    return {
      type,
      scope,
      line: token.line,
      column: token.column,
      content,
    } as any;
  }

  // Indented block content
  const la = ctx.stream.lookaheadNewlinesThenIndent();
  if (la.indentAfter) {
    // consume newline(s) up to indent
    const start = ctx.stream.peek();
    const n = ctx.stream.consumeNewlines();
    pushBlankLines(content, start.line, start.column, n);

    ctx.stream.advance(); // INDENT
    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      if (ctx.stream.check(TokenType.END_BLOCK)) {
        consumeEndBlockOrThrow(ctx, "doc_header_footer");
        break;
      }
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

  return {
    type,
    scope,
    line: token.line,
    column: token.column,
    content,
  } as any;
}

export function parseDocHeaderFooterWithScope(ctx: ParserContext, scope: "first" | "even"): Node | null {
  // Expect: @firstpage @header ... or @evenpage @footer ...
  const prefix = ctx.stream.advance();
  ctx.stream.skipWhitespaceTokens();

  if (ctx.stream.check(TokenType.DOC_HEADER)) {
    return parseDocHeaderFooter(ctx, "doc_header", scope);
  }
  if (ctx.stream.check(TokenType.DOC_FOOTER)) {
    return parseDocHeaderFooter(ctx, "doc_footer", scope);
  }

  // No header/footer following; treat as no-op
  return null;
}

export function parseDocHeaderFooterDefault(ctx: ParserContext, type: "doc_header" | "doc_footer"): Node {
  return parseDocHeaderFooter(ctx, type, "default");
}

function parseColumnsArgs(
  args: string,
  line: number,
  column: number
): { columnCount: number; gapTwip: number; separator: boolean } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`@columns requires a column count, e.g. @columns 2 (line ${line})`);
  }

  // First part should be the column count
  const countStr = parts[0]!;
  const columnCount = parseInt(countStr, 10);
  if (!Number.isFinite(columnCount) || columnCount < 1 || columnCount > 10) {
    throw new Error(`@columns count must be between 1 and 10 (line ${line}). Got: ${countStr}`);
  }

  // Default gap: 0.5in = 720 twips
  let gapTwip = 720;
  let separator = false;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.startsWith("gap=")) {
      const gapValue = part.slice(4);
      gapTwip = parseLengthToTwip(gapValue, line);
    } else if (part === "separator") {
      separator = true;
    } else {
      throw new Error(`Unknown @columns option: ${part} (line ${line})`);
    }
  }

  return { columnCount, gapTwip, separator };
}

export function parseColumnsRegion(ctx: ParserContext): ColumnsRegionNode {
  const token = ctx.stream.advance();
  const args = parseRestOfLineRaw(ctx);

  // Check for nested columns region
  if (ctx.insideColumnsRegion) {
    throw new Error(`Nested @columns regions are not allowed (line ${token.line}, column ${token.column})`);
  }

  // Parse args: @columns <N> [gap=<len>] [separator]
  const parsed = parseColumnsArgs(args, token.line, token.column);

  const children: Node[] = [];

  // Mark that we're inside a columns region
  const wasInside = ctx.insideColumnsRegion;
  ctx.insideColumnsRegion = true;

  try {
    // Look ahead to see if there's an indented block
    const la = ctx.stream.lookaheadNewlinesThenIndent();
    if (la.indentAfter) {
      // Consume newline(s) up to indent
      const start = ctx.stream.peek();
      const n = ctx.stream.consumeNewlines();
      pushBlankLines(children, start.line, start.column, n);

      // Consume INDENT
      ctx.stream.advance();

      // Parse children until DEDENT or END_BLOCK
      while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
        if (ctx.stream.check(TokenType.END_BLOCK)) {
          consumeEndBlockOrThrow(ctx, "columns");
          break;
        }

        if (ctx.stream.check(TokenType.NEWLINE)) {
          const start2 = ctx.stream.peek();
          const n2 = ctx.stream.consumeNewlines();
          pushBlankLines(children, start2.line, start2.column, n2);
          continue;
        }

        if (ctx.stream.check(TokenType.DEDENT)) break;

        const child = ctx.parseNode();
        if (child) children.push(child);
      }

      if (ctx.stream.check(TokenType.DEDENT)) ctx.stream.advance();
    } else {
      // No indented block; parse until @;
      // Consume any newlines first
      ctx.stream.skipNewlines();

      while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.END_BLOCK)) {
        if (ctx.stream.check(TokenType.NEWLINE)) {
          const start = ctx.stream.peek();
          const n = ctx.stream.consumeNewlines();
          pushBlankLines(children, start.line, start.column, n);
          continue;
        }

        const child = ctx.parseNode();
        if (child) children.push(child);
      }

      if (!ctx.stream.check(TokenType.END_BLOCK)) {
        throw new Error(`@columns region must end with @; (line ${token.line})`);
      }
      consumeEndBlockOrThrow(ctx, "columns");
    }
  } finally {
    ctx.insideColumnsRegion = wasInside;
  }

  return {
    type: "columns_region",
    columnCount: parsed.columnCount,
    gapTwip: parsed.gapTwip,
    separator: parsed.separator,
    children,
    line: token.line,
    column: token.column,
  };
}
