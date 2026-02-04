import { TokenType } from "../lexer";
import type { DocumentNode, MetaNode, ImportNode, Node, ColumnsRegionNode, NumberingScheme } from "../ast";
import { type ParserContext, parseTextUntilNewline, parseRestOfLineRaw } from "./inline";
import { pushBlankLines, parseLengthToTwip, parseLiteral } from "../utils";
import { parseParagraph } from "./block";
import { parseIndentedBlock } from "./helpers";

function parseMetaBlock(ctx: ParserContext): Record<string, any> {
  const data: Record<string, any> = {};

  if (ctx.stream.check(TokenType.INDENT)) {
    ctx.stream.advance();

    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
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
  let trailingBlanks = 0;

  if (ctx.stream.check(TokenType.INDENT)) {
    ctx.stream.advance();

    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      // Count newlines - first one is line terminator, rest are blank lines
      let nlCount = 0;
      while (ctx.stream.check(TokenType.NEWLINE)) {
        ctx.stream.advance();
        nlCount++;
      }
      if (ctx.stream.check(TokenType.DEDENT)) {
        // These newlines were trailing - record as blank lines (minus the line terminator)
        trailingBlanks = Math.max(0, nlCount - 1);
        break;
      }
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
    }

    if (ctx.stream.check(TokenType.DEDENT)) {
      ctx.stream.advance();
    }

    // Optional @end after indented block
    // Only consume newlines if @end follows, otherwise leave them for body
    let hasEnd = false;
    const savedPos = ctx.stream.getPosition();
    let nlCount = 0;
    while (ctx.stream.check(TokenType.NEWLINE)) {
      ctx.stream.advance();
      nlCount++;
    }
    if (ctx.stream.check(TokenType.END)) {
      ctx.stream.advance();
      hasEnd = true;
    } else {
      // No @end found, restore position to preserve blank lines
      ctx.stream.setPosition(savedPos);
    }

    return {
      type: "meta",
      line: token.line,
      column: token.column,
      data,
      hasEnd,
      trailingBlanks,
    };
  }

  return {
    type: "meta",
    line: token.line,
    column: token.column,
    data,
    hasEnd: false,
    trailingBlanks: 0,
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
  // But stop consuming newlines once we hit non-preamble content
  while (!ctx.stream.isAtEnd()) {
    // Skip newlines between preamble items, but peek ahead to see if more preamble follows
    if (ctx.stream.check(TokenType.NEWLINE)) {
      // Look ahead past newlines to see what's next
      let offset = 0;
      const basePos = ctx.stream.getPosition();
      while (ctx.stream.getTokenAt(basePos + offset)?.type === TokenType.NEWLINE) {
        offset++;
      }
      const nextType = ctx.stream.getTokenAt(basePos + offset)?.type;
      
      // Only consume newlines if more preamble items follow
      if (nextType === TokenType.IMPORT || nextType === TokenType.META || 
          nextType === TokenType.COMMENT || nextType === TokenType.TODO) {
        ctx.stream.advance();
        continue;
      }
      // Otherwise, leave newlines for body to preserve as blank lines
      break;
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

  // Same-line content
  if (!ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
    const content: Node[] = [];
    const para = parseParagraph(ctx);
    if (para) content.push(para);
    // leave trailing newlines to outer loop
    return {
      type,
      scope,
      line: token.line,
      column: token.column,
      content,
      hasEnd: false,
    } as any;
  }

  // Indented block content
  const { content, hasEnd } = parseIndentedBlock(ctx, { required: false });

  return {
    type,
    scope,
    line: token.line,
    column: token.column,
    content,
    hasEnd,
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

  // NOTE: Nested @columns regions are allowed.
  // Top-level columns use Section Breaks (native Word columns).
  // Nested columns are rendered as Tables with invisible borders.

  // Parse args: @columns <N> [gap=<len>] [separator]
  const parsed = parseColumnsArgs(args, token.line, token.column);

  let children: Node[] = [];
  let hasEnd = false;

  // Mark that we're inside a columns region
  const wasInside = ctx.insideColumnsRegion;
  ctx.insideColumnsRegion = true;

  try {
    // Look ahead to see if there's an indented block
    const la = ctx.stream.lookaheadNewlinesThenIndent();
    if (la.indentAfter) {
      // Use helper for indented block
      const result = parseIndentedBlock(ctx, { required: false, directiveName: "@columns" });
      children = result.content;
      hasEnd = result.hasEnd;
    } else {
      // No indented block; parse until @end
      // Consume any newlines first
      ctx.stream.skipNewlines();

      while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.END)) {
        if (ctx.stream.check(TokenType.NEWLINE)) {
          const start = ctx.stream.peek();
          const n = ctx.stream.consumeNewlines();
          pushBlankLines(children, start.line, start.column, n);
          continue;
        }

        const child = ctx.parseNode();
        if (child) children.push(child);
      }

      // Optional @end
      if (ctx.stream.check(TokenType.END)) {
        ctx.stream.advance();
        hasEnd = true;
      }
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
    hasEnd,
  };
}
