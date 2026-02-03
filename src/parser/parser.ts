// Parser for Legal Document DSL

import { Lexer, Token, TokenType } from "./lexer";
import {
  Node,
  DocumentNode,
  MetaNode,
  HeaderNode,
  NumberedItemNode,
  BulletItemNode,
  ModifierNode,
  ParagraphNode,
  TableNode,
  TableRowNode,
  InlineNode,
  TextNode,
  VariableNode,
  CrossRefNode,
  DefinedTermNode,
  BlankNode,
  EmphasisNode,
  PageBreakNode,
  CommentNode,
  ImportNode,
  NumberingStyle,
  ModifierType,
} from "./ast";

export class Parser {
  private tokens: Token[] = [];
  private pos: number = 0;
  private definedTerms: Set<string> = new Set();

  private isBlockStart(type: TokenType): boolean {
    return (
      type === TokenType.HEADER ||
      type === TokenType.NUMBERED_ITEM ||
      type === TokenType.BULLET ||
      type === TokenType.MODIFIER ||
      type === TokenType.TABLE ||
      type === TokenType.PAGEBREAK ||
      type === TokenType.DOC_HEADER ||
      type === TokenType.DOC_FOOTER ||
      type === TokenType.DOC_FIRSTPAGE ||
      type === TokenType.DOC_EVENPAGE ||
      type === TokenType.DOC_MARGINS ||
      type === TokenType.DOC_SPACING ||
      type === TokenType.DOC_LANDSCAPE ||
      type === TokenType.DOC_COLUMNS ||
      type === TokenType.DOC_ANCHOR ||
      type === TokenType.END_BLOCK ||
      type === TokenType.DOCUMENT ||
      type === TokenType.META ||
      type === TokenType.IMPORT ||
      type === TokenType.DEFINE ||
      type === TokenType.COMMENT ||
      type === TokenType.TODO
    );
  }

  private parseRestOfLineRaw(): string {
    let raw = "";
    while (!this.isAtEnd() && !this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF)) {
      raw += this.advance().value;
    }
    return raw.trim();
  }

  private consumeEndBlockOrThrow(context: string): boolean {
    if (!this.check(TokenType.END_BLOCK)) return false;

    const t = this.advance();
    // Eat the rest of the terminator line
    if (this.check(TokenType.NEWLINE)) this.advance();
    // Leave additional newlines for normal blank-line handling
    return true;
  }

  private makeSpaceToken(line: number, column: number): Token {
    return { type: TokenType.TEXT, value: " ", line, column, indent: 0 };
  }

  private softWrapIntoTokens(tokens: Token[], newlineToken: Token): void {
    // Avoid accumulating multiple spaces
    const last = tokens[tokens.length - 1];
    if (last?.type === TokenType.TEXT && last.value.endsWith(" ")) return;
    tokens.push(this.makeSpaceToken(newlineToken.line, newlineToken.column));
  }

  private consumeSoftWrappedLine(tokens: Token[]): void {
    // Consume one NEWLINE and then consume tokens on the next line until NEWLINE/EOF/INDENT/DEDENT.
    // If the NEWLINE starts a blank line (NEWLINE NEWLINE), do not consume.
    if (!this.check(TokenType.NEWLINE)) return;
    if (this.tokens[this.pos + 1]?.type === TokenType.NEWLINE) return;

    // If next token after newline is a block start or an indent/dedent, treat as paragraph boundary.
    const newlineTok = this.peek();
    const nextType = this.tokens[this.pos + 1]?.type;
    if (nextType === undefined) return;
    if (nextType === TokenType.INDENT || nextType === TokenType.DEDENT || this.isBlockStart(nextType)) {
      return;
    }

    // Consume newline, inject a space, then consume the following inline tokens.
    this.advance();
    this.softWrapIntoTokens(tokens, newlineTok);
    while (
      !this.isAtEnd() &&
      !this.check(TokenType.NEWLINE) &&
      !this.check(TokenType.EOF) &&
      !this.check(TokenType.INDENT) &&
      !this.check(TokenType.DEDENT)
    ) {
      // Stop if we hit a block start mid-line (shouldn't happen often, but safe)
      if (this.isBlockStart(this.peek().type)) break;
      tokens.push(this.advance());
    }
  }

  private consumeNewlines(): number {
    let count = 0;
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
      count++;
    }
    return count;
  }

  private lookaheadNewlinesThenIndent(): { newlines: number; indentAfter: boolean } {
    let i = this.pos;
    let n = 0;
    while (this.tokens[i]?.type === TokenType.NEWLINE) {
      i++;
      n++;
    }
    return { newlines: n, indentAfter: this.tokens[i]?.type === TokenType.INDENT };
  }

  private pushBlankLines(target: Node[], line: number, column: number, newlineCount: number): void {
    // 2+ newlines => 1+ blank lines (N newlines = N-1 blank lines)
    if (newlineCount >= 2) {
      target.push({
        type: "empty_paragraph",
        line,
        column,
        count: newlineCount - 1,
      } as any);
    }
  }

  parse(input: string): DocumentNode {
    const lexer = new Lexer(input);
    this.tokens = lexer.tokenize();
    this.pos = 0;
    this.definedTerms = new Set();

    return this.parseDocument();
  }

  private parseDocument(): DocumentNode {
    let document: Record<string, any> | undefined;
    let meta: MetaNode | undefined;
    const imports: ImportNode[] = [];
    const body: Node[] = [];

    // Skip leading newlines
    this.skipNewlines();

    // Parse @document if present
    if (this.check(TokenType.DOCUMENT)) {
      this.advance();

      // Block settings:
      // @document
      //   title: ...
      //   short_title: ...
      const la = this.lookaheadNewlinesThenIndent();
      if (la.indentAfter) {
        this.consumeNewlines();
        document = this.parseMetaBlock();

        // Convenience: normalize dash-keys to underscore variants
        for (const [k, v] of Object.entries(document)) {
          if (k.includes("-")) {
            const u = k.replace(/-/g, "_");
            if (!(u in document)) (document as any)[u] = v;
          }
        }
      }

      // No legacy inline form
      if (!document && !this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF)) {
        const got = this.parseTextUntilNewline();
        throw new Error(`@document must be a block (indented key/value). Got inline content: ${got}`);
      }

      this.skipNewlines();
    }

    // Parse imports and meta
    while (!this.isAtEnd()) {
      this.skipNewlines();

      if (this.check(TokenType.IMPORT)) {
        imports.push(this.parseImport());
      } else if (this.check(TokenType.META)) {
        meta = this.parseMeta();
      } else {
        break;
      }
    }

    // Parse body (preserve blank lines as spacing)
    while (!this.isAtEnd()) {
      if (this.check(TokenType.NEWLINE)) {
        const start = this.peek();
        const n = this.consumeNewlines();
        this.pushBlankLines(body, start.line, start.column, n);
        continue;
      }

      const node = this.parseNode();
      if (node) body.push(node);
    }

    return {
      type: "document",
      line: 1,
      column: 1,
      document,
      meta,
      imports,
      body,
    };
  }

  private parseNode(): Node | null {
    const token = this.peek();

    switch (token.type) {
      case TokenType.END_BLOCK:
        throw new Error(`Unmatched @; at line ${token.line}, column ${token.column}`);
      case TokenType.DOC_FIRSTPAGE:
        return this.parseDocHeaderFooterWithScope("first");

      case TokenType.DOC_EVENPAGE:
        return this.parseDocHeaderFooterWithScope("even");

      case TokenType.DOC_HEADER:
        return this.parseDocHeaderFooter("doc_header", "default");

      case TokenType.DOC_FOOTER:
        return this.parseDocHeaderFooter("doc_footer", "default");

      case TokenType.DOC_MARGINS:
        return this.parseDocLayout("margins");

      case TokenType.DOC_SPACING:
        return this.parseDocLayout("spacing");

      case TokenType.DOC_LANDSCAPE:
        return this.parseDocLayout("landscape");

      case TokenType.DOC_COLUMNS:
        return this.parseDocLayout("columns");

      case TokenType.DOC_ANCHOR:
        return this.parseAnchor();

      case TokenType.HEADER:
        return this.parseHeader();

      case TokenType.NUMBERED_ITEM:
        return this.parseNumberedItem();

      case TokenType.BULLET:
        return this.parseBulletItem();

      case TokenType.MODIFIER:
        return this.parseModifier();

      case TokenType.TABLE:
        return this.parseTable();

      case TokenType.PAGEBREAK:
        return this.parsePageBreak();

      case TokenType.COMMENT:
      case TokenType.TODO:
        return this.parseComment();

      case TokenType.NEWLINE:
        this.advance();
        return null;

      case TokenType.INDENT:
        this.advance();
        return null;

      case TokenType.DEDENT:
        this.advance();
        return null;

      case TokenType.EOF:
        return null;

      default:
        return this.parseParagraph();
    }
  }

  private parseAnchor(): Node {
    const token = this.advance();
    let name = this.parseRestOfLineRaw();
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

  private parseDocLayout(kind: "margins" | "spacing" | "landscape" | "columns"): Node {
    const token = this.advance();
    const args = this.parseRestOfLineRaw();
    return {
      type: "doc_layout",
      kind,
      args,
      line: token.line,
      column: token.column,
    } as any;
  }

  private parseDocHeaderFooterWithScope(scope: "first" | "even"): Node | null {
    // Expect: @firstpage @header ... or @evenpage @footer ...
    const prefix = this.advance();
    this.skipWhitespaceTokens();

    if (this.check(TokenType.DOC_HEADER)) {
      return this.parseDocHeaderFooter("doc_header", scope);
    }
    if (this.check(TokenType.DOC_FOOTER)) {
      return this.parseDocHeaderFooter("doc_footer", scope);
    }

    // No header/footer following; treat as no-op
    return null;
  }

  private parseDocHeaderFooter(
    type: "doc_header" | "doc_footer",
    scope: "default" | "first" | "even"
  ): Node {
    const token = this.advance();
    const content: Node[] = [];

    // Same-line content
    if (!this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF)) {
      const para = this.parseParagraph();
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
    const la = this.lookaheadNewlinesThenIndent();
    if (la.indentAfter) {
      // consume newline(s) up to indent
      const start = this.peek();
      const n = this.consumeNewlines();
      this.pushBlankLines(content, start.line, start.column, n);

      this.advance(); // INDENT
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        if (this.check(TokenType.END_BLOCK)) {
          this.consumeEndBlockOrThrow("doc_header_footer");
          break;
        }
        if (this.check(TokenType.NEWLINE)) {
          const start2 = this.peek();
          const n2 = this.consumeNewlines();
          this.pushBlankLines(content, start2.line, start2.column, n2);
          continue;
        }
        if (this.check(TokenType.DEDENT)) break;

        const child = this.parseNode();
        if (child) content.push(child);
      }
      if (this.check(TokenType.DEDENT)) this.advance();
    }

    return {
      type,
      scope,
      line: token.line,
      column: token.column,
      content,
    } as any;
  }

  private parseHeader(): HeaderNode {
    const token = this.advance();
    const level = token.level ?? 1;

    return {
      type: "header",
      line: token.line,
      column: token.column,
      level,
      content: this.parseInlineContent(token.value),
    };
  }

  private parseNumberedItem(): NumberedItemNode {
    const token = this.advance();
    const level = token.level ?? 1;
    const style = this.parseNumberingStyle(token.style ?? "");

    // Parse content on the same line; allow soft-wrapped lines until a blank line or block start.
    const contentTokens: Token[] = [];
    while (!this.isAtEnd() && !this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF)) {
      contentTokens.push(this.advance());
    }
    // Soft-wrap continuation lines into the same numbered paragraph.
    while (this.check(TokenType.NEWLINE)) {
      const before = this.pos;
      this.consumeSoftWrappedLine(contentTokens);
      if (this.pos === before) break;
    }

    let content = this.tokensToInlineNodes(contentTokens);
    const children: Node[] = [];

    // Parse children if indented; preserve blank lines inside the block.
    // If there is no indented block, leave NEWLINE tokens for the outer loop so
    // blank lines between this item and the next node are preserved at the document level.
    const la = this.lookaheadNewlinesThenIndent();
    if (la.indentAfter) {
      const start = this.peek();
      const n = this.consumeNewlines();
      this.pushBlankLines(children, start.line, start.column, n);

      // Now we're positioned at INDENT
      this.advance();
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        if (this.check(TokenType.END_BLOCK)) {
          this.consumeEndBlockOrThrow("numbered_item");
          break;
        }
        if (this.check(TokenType.NEWLINE)) {
          const start = this.peek();
          const n = this.consumeNewlines();
          this.pushBlankLines(children, start.line, start.column, n);
          continue;
        }
        if (this.check(TokenType.DEDENT)) break;

        const child = this.parseNode();
        if (child) {
          children.push(child);
        }
      }
      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    // If the numbered item has no inline content, and the first child is a paragraph,
    // treat that paragraph as the list item's content (avoids rendering an empty "1." line).
    if (content.length === 0) {
      const idx = children.findIndex((n) => n.type === "paragraph");
      if (idx !== -1) {
        const p = children[idx] as any;
        content = p.content ?? [];
        children.splice(idx, 1);
      }
    }

    return {
      type: "numbered_item",
      line: token.line,
      column: token.column,
      level,
      style,
      marker: token.marker ?? "",
      content,
      children,
    };
  }

  private parseBulletItem(): BulletItemNode {
    const token = this.advance();
    const level = token.level ?? 1;

    // Parse content on the same line; allow soft-wrapped lines until a blank line or block start.
    const contentTokens: Token[] = [];
    while (!this.isAtEnd() && !this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF)) {
      contentTokens.push(this.advance());
    }
    while (this.check(TokenType.NEWLINE)) {
      const before = this.pos;
      this.consumeSoftWrappedLine(contentTokens);
      if (this.pos === before) break;
    }

    let content = this.tokensToInlineNodes(contentTokens);
    const children: Node[] = [];

    // Parse children if indented; preserve blank lines inside the block.
    const la = this.lookaheadNewlinesThenIndent();
    if (la.indentAfter) {
      const start = this.peek();
      const n = this.consumeNewlines();
      this.pushBlankLines(children, start.line, start.column, n);

      // Now we're positioned at INDENT
      this.advance();
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        if (this.check(TokenType.END_BLOCK)) {
          this.consumeEndBlockOrThrow("bullet_item");
          break;
        }
        if (this.check(TokenType.NEWLINE)) {
          const start = this.peek();
          const n = this.consumeNewlines();
          this.pushBlankLines(children, start.line, start.column, n);
          continue;
        }
        if (this.check(TokenType.DEDENT)) break;

        const child = this.parseNode();
        if (child) {
          children.push(child);
        }
      }
      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    if (content.length === 0) {
      const idx = children.findIndex((n) => n.type === "paragraph");
      if (idx !== -1) {
        const p = children[idx] as any;
        content = p.content ?? [];
        children.splice(idx, 1);
      }
    }

    return {
      type: "bullet_item",
      line: token.line,
      column: token.column,
      level,
      content,
      children,
    };
  }

  private parseModifier(): ModifierNode {
    const token = this.advance();
    const modifier = token.value as ModifierType;

    const content: Node[] = [];

    // Check if content is on same line or indented block
    if (this.check(TokenType.NEWLINE)) {
      // Only consume newlines if an indented block follows.
      // Otherwise leave them for the outer loop to preserve blank lines between nodes.
      const la = this.lookaheadNewlinesThenIndent();
      if (la.indentAfter) {
        const start = this.peek();
        const n = this.consumeNewlines();
        this.pushBlankLines(content, start.line, start.column, n);

        // Now we're positioned at INDENT
        this.advance();
        while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
          if (this.check(TokenType.END_BLOCK)) {
            this.consumeEndBlockOrThrow("modifier");
            break;
          }
          if (this.check(TokenType.NEWLINE)) {
            const start = this.peek();
            const n = this.consumeNewlines();
            this.pushBlankLines(content, start.line, start.column, n);
            continue;
          }
          if (this.check(TokenType.DEDENT)) break;

          const child = this.parseNode();
          if (child) {
            content.push(child);
          }
        }
        if (this.check(TokenType.DEDENT)) {
          this.advance();
        }
      }
    } else {
      // Same line content - could be another modifier, header, or text
      if (this.check(TokenType.MODIFIER)) {
        const nested = this.parseModifier();
        content.push(nested);
      } else if (this.check(TokenType.HEADER)) {
        const header = this.parseHeader();
        content.push(header);
      } else {
        const para = this.parseParagraph();
        if (para) content.push(para);
      }
    }

    return {
      type: "modifier",
      line: token.line,
      column: token.column,
      modifier,
      count: token.count,
      content,
    };
  }

  private parseTable(): TableNode {
    const token = this.advance();
    const rows: TableRowNode[] = [];

    this.skipNewlines();

    // Parse indented rows
    if (this.check(TokenType.INDENT)) {
      this.advance();

      let isFirst = true;
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        if (this.check(TokenType.END_BLOCK)) {
          this.consumeEndBlockOrThrow("table");
          break;
        }

        this.skipNewlines();
        if (this.check(TokenType.DEDENT)) break;

        if (this.check(TokenType.TABLE_ROW)) {
          const rowToken = this.advance();
          const cells = JSON.parse(rowToken.value) as string[];

          rows.push({
            type: "table_row",
            line: rowToken.line,
            column: rowToken.column,
            cells: cells.map((cell) => this.parseInlineContent(cell)),
            isHeader: isFirst,
          });

          isFirst = false;
        } else {
          this.advance(); // Skip unexpected tokens
        }
      }

      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    return {
      type: "table",
      line: token.line,
      column: token.column,
      rows,
    };
  }

  private parsePageBreak(): PageBreakNode {
    const token = this.advance();
    return {
      type: "page_break",
      line: token.line,
      column: token.column,
    };
  }

  private parseComment(): CommentNode {
    const token = this.advance();
    return {
      type: "comment",
      line: token.line,
      column: token.column,
      value: token.value,
      isTodo: token.type === TokenType.TODO,
    };
  }

  private parseImport(): ImportNode {
    const token = this.advance();
    this.skipWhitespaceTokens();
    const path = this.parseTextUntilNewline();

    return {
      type: "import",
      line: token.line,
      column: token.column,
      path,
    };
  }

  private parseMeta(): MetaNode {
    const token = this.advance();
    this.skipNewlines();

    const data: Record<string, any> = {};

    if (this.check(TokenType.INDENT)) {
      this.advance();

      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        if (this.check(TokenType.END_BLOCK)) {
          this.consumeEndBlockOrThrow("meta");
          break;
        }

        this.skipNewlines();
        if (this.check(TokenType.DEDENT)) break;
        if (this.isAtEnd()) break;

        // Parse key: value pairs
        const lineText = this.parseTextUntilNewline();
        
        // If we got no text, we need to break to avoid infinite loop
        if (!lineText) {
          // Skip one token if we're stuck
          if (!this.check(TokenType.NEWLINE) && !this.check(TokenType.DEDENT) && !this.isAtEnd()) {
            this.advance();
          }
          continue;
        }
        
        const colonIndex = lineText.indexOf(":");

        if (colonIndex > 0) {
          const key = lineText.slice(0, colonIndex).trim();
          const value = lineText.slice(colonIndex + 1).trim();

          // Handle nested objects (simplified)
          if (!value) {
            // Nested block
            data[key] = this.parseMetaBlock();
          } else {
            data[key] = value;
          }
        }

        this.skipNewlines();
      }

      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    return {
      type: "meta",
      line: token.line,
      column: token.column,
      data,
    };
  }

  private parseMetaBlock(): Record<string, any> {
    const data: Record<string, any> = {};

    if (this.check(TokenType.INDENT)) {
      this.advance();

      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        if (this.check(TokenType.END_BLOCK)) {
          this.consumeEndBlockOrThrow("meta_block");
          break;
        }

        this.skipNewlines();
        if (this.check(TokenType.DEDENT)) break;
        if (this.isAtEnd()) break;

        const lineText = this.parseTextUntilNewline();
        
        // If we got no text, avoid infinite loop
        if (!lineText) {
          if (!this.check(TokenType.NEWLINE) && !this.check(TokenType.DEDENT) && !this.isAtEnd()) {
            this.advance();
          }
          continue;
        }
        
        const colonIndex = lineText.indexOf(":");

        if (colonIndex > 0) {
          const key = lineText.slice(0, colonIndex).trim();
          const value = lineText.slice(colonIndex + 1).trim();
          data[key] = value || this.parseMetaBlock();
        }

        this.skipNewlines();
      }

      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    return data;
  }

  private parseParagraph(): ParagraphNode | null {
    const startToken = this.peek();
    const contentTokens: Token[] = [];

    while (!this.isAtEnd()) {
      if (this.check(TokenType.EOF) || this.check(TokenType.INDENT) || this.check(TokenType.DEDENT)) {
        break;
      }

      if (this.check(TokenType.NEWLINE)) {
        // Blank line = paragraph break
        if (this.tokens[this.pos + 1]?.type === TokenType.NEWLINE) {
          break;
        }

        // Single newline: soft wrap if the next token continues inline content
        const nextType = this.tokens[this.pos + 1]?.type;
        if (
          nextType !== undefined &&
          nextType !== TokenType.INDENT &&
          nextType !== TokenType.DEDENT &&
          !this.isBlockStart(nextType)
        ) {
          const nl = this.peek();
          this.advance();
          this.softWrapIntoTokens(contentTokens, nl);
          continue;
        }

        // Otherwise paragraph break
        break;
      }

      if (this.isBlockStart(this.peek().type)) {
        break;
      }

      contentTokens.push(this.advance());
    }

    if (contentTokens.length === 0) {
      return null;
    }

    return {
      type: "paragraph",
      line: startToken.line,
      column: startToken.column,
      content: this.tokensToInlineNodes(contentTokens),
    };
  }

  private tokensToInlineNodes(tokens: Token[]): InlineNode[] {
    const nodes: InlineNode[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case TokenType.TEXT:
          nodes.push({
            type: "text",
            line: token.line,
            column: token.column,
            value: token.value,
          });
          break;

        case TokenType.VARIABLE:
          const parts = token.value.split("|").map((s) => s.trim());
          const namePart = parts[0];
          const filters = parts.slice(1);
          const path = namePart.split(".");

          nodes.push({
            type: "variable",
            line: token.line,
            column: token.column,
            name: namePart,
            path,
            filters,
          });
          break;

        case TokenType.CROSS_REF:
          nodes.push({
            type: "cross_ref",
            line: token.line,
            column: token.column,
            target: token.value,
          });
          break;

        case TokenType.DEFINED_TERM:
          const isDefinition = !this.definedTerms.has(token.value);
          if (isDefinition) {
            this.definedTerms.add(token.value);
          }

          nodes.push({
            type: "defined_term",
            line: token.line,
            column: token.column,
            term: token.value,
            isDefinition,
          });
          break;

        case TokenType.BLANK:
          nodes.push({
            type: "blank",
            line: token.line,
            column: token.column,
            length: token.value.length,
          });
          break;

        case TokenType.BOLD:
          nodes.push({
            type: "emphasis",
            line: token.line,
            column: token.column,
            style: "bold",
            content: this.parseInlineContent(token.value),
          });
          break;

        case TokenType.ITALIC:
          nodes.push({
            type: "emphasis",
            line: token.line,
            column: token.column,
            style: "italic",
            content: this.parseInlineContent(token.value),
          });
          break;

        case TokenType.BOLD_ITALIC:
          nodes.push({
            type: "emphasis",
            line: token.line,
            column: token.column,
            style: "bold_italic",
            content: this.parseInlineContent(token.value),
          });
          break;
      }
    }

    return nodes;
  }

  private parseInlineContent(text: string): InlineNode[] {
    // Simple inline parser for text that may contain {{vars}} and [[refs]]
    const nodes: InlineNode[] = [];
    let current = "";
    let i = 0;

    while (i < text.length) {
      // Variable
      if (text[i] === "{" && text[i + 1] === "{") {
        if (current) {
          nodes.push({ type: "text", line: 0, column: 0, value: current });
          current = "";
        }

        i += 2;
        let varName = "";
        while (i < text.length && !(text[i] === "}" && text[i + 1] === "}")) {
          varName += text[i];
          i++;
        }
        i += 2;

        const parts = varName.split("|").map((s) => s.trim());
        const namePart = parts[0];

        nodes.push({
          type: "variable",
          line: 0,
          column: 0,
          name: namePart,
          path: namePart.split("."),
          filters: parts.slice(1),
        });
        continue;
      }

      // Cross-reference
      if (text[i] === "[" && text[i + 1] === "[") {
        if (current) {
          nodes.push({ type: "text", line: 0, column: 0, value: current });
          current = "";
        }

        i += 2;
        let ref = "";
        while (i < text.length && !(text[i] === "]" && text[i + 1] === "]")) {
          ref += text[i];
          i++;
        }
        i += 2;

        nodes.push({
          type: "cross_ref",
          line: 0,
          column: 0,
          target: ref,
        });
        continue;
      }

      current += text[i];
      i++;
    }

    if (current) {
      nodes.push({ type: "text", line: 0, column: 0, value: current });
    }

    return nodes;
  }

  private parseNumberingStyle(style: string): NumberingStyle {
    if (!style) {
      return { type: "auto" };
    }

    // Decimal with dots: 1.1, 2.1.3
    if (/^\d+(\.\d+)+$/.test(style)) {
      return { type: "decimal_sub", pattern: style };
    }

    // Simple decimal: 1, 2, 3
    if (/^\d+$/.test(style)) {
      return { type: "decimal", start: parseInt(style) };
    }

    // Roman lower: i, ii, iii
    if (/^[ivx]+$/.test(style)) {
      return { type: "roman_lower", start: style };
    }

    // Roman upper: I, II, III
    if (/^[IVX]+$/.test(style)) {
      return { type: "roman_upper", start: style };
    }

    // Alpha lower: a, b, c
    if (/^[a-z]$/.test(style)) {
      return { type: "alpha_lower", start: style };
    }

    // Alpha upper: A, B, C
    if (/^[A-Z]$/.test(style)) {
      return { type: "alpha_upper", start: style };
    }

    return { type: "auto" };
  }

  private parseTextUntilNewline(): string {
    let text = "";
    while (!this.isAtEnd() && !this.check(TokenType.NEWLINE)) {
      text += this.advance().value;
    }
    return text.trim();
  }

  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }
  }

  private skipWhitespaceTokens(): void {
    while (this.check(TokenType.TEXT) && this.peek().value.trim() === "") {
      this.advance();
    }
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: "", line: 0, column: 0, indent: 0 };
  }

  private advance(): Token {
    const token = this.peek();
    this.pos++;
    return token;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }
}

// Export a convenience function
export function parse(input: string): DocumentNode {
  const parser = new Parser();
  return parser.parse(input);
}
