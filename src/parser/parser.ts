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

  parse(input: string): DocumentNode {
    const lexer = new Lexer(input);
    this.tokens = lexer.tokenize();
    this.pos = 0;
    this.definedTerms = new Set();

    return this.parseDocument();
  }

  private parseDocument(): DocumentNode {
    let title = "";
    let meta: MetaNode | undefined;
    const imports: ImportNode[] = [];
    const body: Node[] = [];

    // Skip leading newlines
    this.skipNewlines();

    // Parse @document if present
    if (this.check(TokenType.DOCUMENT)) {
      this.advance();
      this.skipWhitespaceTokens();
      title = this.parseTextUntilNewline();
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

    // Parse body
    while (!this.isAtEnd()) {
      this.skipNewlines();
      if (this.isAtEnd()) break;

      const node = this.parseNode();
      if (node) {
        body.push(node);
      }
    }

    return {
      type: "document",
      line: 1,
      column: 1,
      title,
      meta,
      imports,
      body,
    };
  }

  private parseNode(): Node | null {
    const token = this.peek();

    switch (token.type) {
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

    // Parse content on the same line
    const contentTokens: Token[] = [];
    while (!this.isAtEnd() && !this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF)) {
      contentTokens.push(this.advance());
    }
    this.skipNewlines();

    const content = this.tokensToInlineNodes(contentTokens);
    const children: Node[] = [];

    // Parse children if indented
    if (this.check(TokenType.INDENT)) {
      this.advance();
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        this.skipNewlines();
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

    // Parse content on the same line
    const contentTokens: Token[] = [];
    while (!this.isAtEnd() && !this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF)) {
      contentTokens.push(this.advance());
    }
    this.skipNewlines();

    const content = this.tokensToInlineNodes(contentTokens);
    const children: Node[] = [];

    // Parse children if indented
    if (this.check(TokenType.INDENT)) {
      this.advance();
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        this.skipNewlines();
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
      this.skipNewlines();

      // Indented block
      if (this.check(TokenType.INDENT)) {
        this.advance();
        while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
          this.skipNewlines();
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

    while (
      !this.isAtEnd() &&
      !this.check(TokenType.NEWLINE) &&
      !this.check(TokenType.EOF) &&
      !this.check(TokenType.INDENT) &&
      !this.check(TokenType.DEDENT)
    ) {
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
