import { TokenType } from "../lexer";
import type { DocumentNode, MetaNode, ImportNode, Node, ColumnsRegionNode, NumberingScheme } from "../ast";
import { type ParserContext, parseTextUntilNewline } from "./inline";
import { pushBlankLines, parseLiteral } from "../utils";
import { parseParagraph } from "./block";
import { parseIndentedBlock } from "./helpers";
import { extractLength, parseDirectiveArgs } from "../args";

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
  let lastToken = token;

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
      lastToken = ctx.stream.advance();
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
      lastToken = ctx.stream.advance();
      hasEnd = true;
    } else {
      // No @end found, restore position to preserve blank lines
      ctx.stream.setPosition(savedPos);
    }

    return {
      type: "meta",
      line: token.line,
      column: token.column,
      endLine: lastToken.endLine,
      endColumn: lastToken.endColumn,
      data,
      hasEnd,
      trailingBlanks,
    };
  }

  return {
    type: "meta",
    line: token.line,
    column: token.column,
    endLine: token.endLine,
    endColumn: token.endColumn,
    data,
    hasEnd: false,
    trailingBlanks: 0,
  };
}

export function parseImport(ctx: ParserContext): ImportNode {
  const token = ctx.stream.advance();
  const args = parseDirectiveArgs(ctx.stream);
  let path = "";
  if (args.positional.length > 0 || args.named.size > 0) {
    const v = args.positional[0];
    if (v?.type === "string") path = v.value;
    else if (v?.type === "identifier") path = v.name;
    else if (v?.type === "expression") path = v.raw;
    else {
      throw new Error(`@import requires a path string (line ${token.line})`);
    }
  } else {
    throw new Error(`@import requires v2 syntax: @import(path) (line ${token.line})`);
  }

  return {
    type: "import",
    line: token.line,
    column: token.column,
    endLine: token.endLine,
    endColumn: token.endColumn,
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

  // Determine end position from the last body node or fallback to start
  let endLine = 1;
  let endColumn = 1;
  if (body.length > 0) {
    const lastNode = body[body.length - 1]!;
    endLine = lastNode.endLine ?? lastNode.line;
    endColumn = lastNode.endColumn ?? lastNode.column;
  }

  return {
    type: "document",
    line: 1,
    column: 1,
    endLine,
    endColumn,
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
    // Determine end position from content or token
    let endLine = token.endLine;
    let endColumn = token.endColumn;
    if (content.length > 0) {
      const lastNode = content[content.length - 1]!;
      endLine = lastNode.endLine ?? lastNode.line;
      endColumn = lastNode.endColumn ?? lastNode.column;
    }
    // leave trailing newlines to outer loop
    return {
      type,
      scope,
      line: token.line,
      column: token.column,
      endLine,
      endColumn,
      content,
      hasEnd: false,
    } as any;
  }

  // Indented block content
  const { content, hasEnd, endToken } = parseIndentedBlock(ctx, { required: false });

  // Determine end position
  let endLine = token.endLine;
  let endColumn = token.endColumn;
  if (endToken) {
    endLine = endToken.endLine;
    endColumn = endToken.endColumn;
  } else if (content.length > 0) {
    const lastNode = content[content.length - 1]!;
    endLine = lastNode.endLine ?? lastNode.line;
    endColumn = lastNode.endColumn ?? lastNode.column;
  }

  return {
    type,
    scope,
    line: token.line,
    column: token.column,
    endLine,
    endColumn,
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

export function parseColumnsRegion(ctx: ParserContext): ColumnsRegionNode {
  const token = ctx.stream.advance();

  // NOTE: Nested @columns regions are allowed.
  // Top-level columns use Section Breaks (native Word columns).
  // Nested columns are rendered as Tables with invisible borders.

  const v2 = parseDirectiveArgs(ctx.stream);

  // Parse args: v2 syntax only - @columns(<N>, gap: <length>, separator)
  if (v2.positional.length === 0 && v2.named.size === 0) {
    throw new Error(`@columns requires v2 syntax: @columns(count, gap: length, separator) (line ${token.line})`);
  }
  const countVal = v2.positional[0];
  if (!countVal || countVal.type !== "number" || !Number.isInteger(countVal.value)) {
    throw new Error(`@columns requires an integer column count (line ${token.line})`);
  }
  const columnCount = countVal.value;
  if (columnCount < 1 || columnCount > 10) {
    throw new Error(`@columns count must be between 1 and 10 (line ${token.line}). Got: ${columnCount}`);
  }
  const gapTwip = extractLength(v2, "gap", 720);
  const separator = v2.flags.has("separator");
  const parsed = { columnCount, gapTwip, separator };

  let children: Node[] = [];
  let hasEnd = false;
  let lastToken = token;

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
      if (result.endToken) {
        lastToken = result.endToken;
      } else if (children.length > 0) {
        // Use last child's end position
        const lastChild = children[children.length - 1]!;
        if (lastChild.endLine !== undefined && lastChild.endColumn !== undefined) {
          lastToken = { ...token, endLine: lastChild.endLine, endColumn: lastChild.endColumn };
        }
      }
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
        lastToken = ctx.stream.advance();
        hasEnd = true;
      } else if (children.length > 0) {
        // Use last child's end position
        const lastChild = children[children.length - 1]!;
        if (lastChild.endLine !== undefined && lastChild.endColumn !== undefined) {
          lastToken = { ...token, endLine: lastChild.endLine, endColumn: lastChild.endColumn };
        }
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
    endLine: lastToken.endLine,
    endColumn: lastToken.endColumn,
    hasEnd,
  };
}
