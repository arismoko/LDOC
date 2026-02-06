/**
 * LDOC Parser
 * 
 * Converts tokens to CST (Concrete Syntax Tree).
 * Uses recursive descent parsing.
 */

import { TokenType, type Token } from "../types/tokens.ts";
import type {
  CSTDocument,
  CSTNode,
  CSTDirective,
  CSTArgument,
  CSTValue,
  CSTParagraph,
  CSTHeader,
  CSTList,
  CSTListItem,
  CSTBlockquote,
  CSTHorizontalRule,
  CSTBlankLine,
  CSTInline,
  CSTText,
  CSTVariable,
  CSTEmphasis,
  CSTHardBreak,
  CSTFootnoteRef,
  CSTCrossRef,
  CSTLink,
  CSTImage,
  CSTDefinedTerm,
  CSTBlank,
  CSTFootnoteDef,
  ParseResult,
  CSTPositionalArg,
  CSTNamedArg,
  CSTStringLiteral,
  CSTNumberLiteral,
  CSTIdentifier,
  CSTExpression,
} from "../types/cst.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error, DiagnosticCode } from "../types/diagnostics.ts";
import { loc, span } from "../types/source-location.ts";

export class Parser {
  private tokens: Token[];
  private pos = 0;
  private diagnostics: Diagnostic[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ParseResult {
    const children: CSTNode[] = [];

    while (!this.isAtEnd()) {
      const node = this.parseNode();
      if (node) {
        children.push(node);
      }
    }

    const cst: CSTDocument = {
      type: "Document",
      children,
      loc: children.length > 0
        ? span(children[0]!.loc, children[children.length - 1]!.loc)
        : loc(1, 0),
    };

    return { cst, diagnostics: this.diagnostics };
  }

  private parseNode(): CSTNode | null {
    this.skipNewlines();
    if (this.isAtEnd()) return null;

    const token = this.peek();

    switch (token.type) {
      case TokenType.DIRECTIVE:
        return this.parseDirective();

      case TokenType.HEADER_MARKER:
        return this.parseHeader();

      case TokenType.BULLET:
        return this.parseList(false);

      case TokenType.NUMBERED:
        return this.parseList(true);

      case TokenType.NUMBERED_ITEM:
        return this.parseNumberedItemList();

      case TokenType.BLOCKQUOTE:
        return this.parseBlockquote();

      case TokenType.HORIZONTAL_RULE:
        return this.parseHorizontalRule();

      case TokenType.INDENT:
        // Skip stray indents
        this.advance();
        return null;

      case TokenType.DEDENT:
        // Let parent handle dedent
        return null;

      case TokenType.COMMENT:
        // Skip comments
        this.advance();
        return null;

      case TokenType.FOOTNOTE_DEF:
        return this.parseFootnoteDef();

      default:
        return this.parseParagraph();
    }
  }

  // ===========================================================================
  // Directives
  // ===========================================================================

  private parseDirective(): CSTDirective {
    const token = this.advance(); // DIRECTIVE token
    const startLoc = loc(token.line, token.column);
    
    const name = token.value;
    const args = this.parseArguments();
    
    // Check for body (indented block)
    let body: CSTNode[] | null = null;
    this.skipNewlines();
    
    if (this.check(TokenType.INDENT)) {
      this.advance(); // consume INDENT
      body = [];
      
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        const node = this.parseNode();
        if (node) {
          body.push(node);
        }
        this.skipNewlines();
      }
      
      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    const endLoc = this.previous();
    
    return {
      type: "Directive",
      name,
      arguments: args,
      body,
      loc: span(startLoc, loc(endLoc.line, endLoc.column)),
    };
  }

  private parseArguments(): CSTArgument[] {
    const args: CSTArgument[] = [];

    if (!this.check(TokenType.LPAREN)) {
      return args;
    }

    this.advance(); // (

    while (!this.isAtEnd() && !this.check(TokenType.RPAREN)) {
      const arg = this.parseArgument();
      if (arg) {
        args.push(arg);
      }

      if (this.check(TokenType.COMMA)) {
        this.advance();
      } else {
        break;
      }
    }

    if (this.check(TokenType.RPAREN)) {
      this.advance();
    }

    return args;
  }

  private parseArgument(): CSTArgument | null {
    const token = this.peek();
    const startLoc = loc(token.line, token.column);

    // Check for named argument: name: value or name = value
    if (this.check(TokenType.IDENTIFIER) || this.check(TokenType.TEXT)) {
      const nameToken = this.advance();
      
      if (this.check(TokenType.COLON) || this.check(TokenType.EQUALS)) {
        this.advance(); // : or =
        const value = this.parseValue();
        if (value) {
          return {
            type: "NamedArg",
            name: nameToken.value.trim(),
            value,
            loc: span(startLoc, value.loc),
          } as CSTNamedArg;
        }
      } else {
        // Positional - the name token IS the value
        return {
          type: "PositionalArg",
          value: {
            type: "Identifier",
            name: nameToken.value.trim(),
            loc: loc(nameToken.line, nameToken.column),
          } as CSTIdentifier,
          loc: startLoc,
        } as CSTPositionalArg;
      }
    }

    // Positional argument
    const value = this.parseValue();
    if (value) {
      return {
        type: "PositionalArg",
        value,
        loc: value.loc,
      } as CSTPositionalArg;
    }

    return null;
  }

  private parseValue(): CSTValue | null {
    const token = this.peek();

    if (this.check(TokenType.STRING)) {
      this.advance();
      return {
        type: "StringLiteral",
        value: token.value,
        raw: `"${token.value}"`,
        loc: loc(token.line, token.column),
      } as CSTStringLiteral;
    }

    if (this.check(TokenType.NUMBER)) {
      this.advance();
      return {
        type: "NumberLiteral",
        value: parseFloat(token.value),
        raw: token.value,
        loc: loc(token.line, token.column),
      } as CSTNumberLiteral;
    }

    if (this.check(TokenType.BOOLEAN)) {
      this.advance();
      return {
        type: "BooleanLiteral",
        value: token.value === "true",
        loc: loc(token.line, token.column),
      };
    }

    if (this.check(TokenType.VARIABLE)) {
      this.advance();
      return {
        type: "Expression",
        raw: token.value,
        loc: loc(token.line, token.column),
      } as CSTExpression;
    }

    if (this.check(TokenType.IDENTIFIER) || this.check(TokenType.TEXT)) {
      this.advance();
      return {
        type: "Identifier",
        name: token.value.trim(),
        loc: loc(token.line, token.column),
      } as CSTIdentifier;
    }

    return null;
  }

  // ===========================================================================
  // Block Elements
  // ===========================================================================

  private parseHeader(): CSTHeader {
    const marker = this.advance(); // HEADER_MARKER
    const level = marker.value.length as 1 | 2 | 3 | 4 | 5 | 6;
    
    const content = this.parseInlineContent();
    
    return {
      type: "Header",
      level,
      content,
      loc: span(
        loc(marker.line, marker.column),
        content.length > 0 
          ? content[content.length - 1]!.loc 
          : loc(marker.line, marker.column)
      ),
    };
  }

  private parseList(ordered: boolean): CSTList {
    const items: CSTListItem[] = [];
    const firstToken = this.peek();
    const startLoc = loc(firstToken.line, firstToken.column);

    while (
      !this.isAtEnd() &&
      (this.check(ordered ? TokenType.NUMBERED : TokenType.BULLET))
    ) {
      items.push(this.parseListItem(ordered));
      this.skipNewlines();
    }

    return {
      type: "List",
      ordered,
      items,
      loc: span(
        startLoc,
        items.length > 0 ? items[items.length - 1]!.loc : startLoc
      ),
    };
  }

  private parseListItem(ordered: boolean): CSTListItem {
    const marker = this.advance(); // BULLET or NUMBERED
    const startLoc = loc(marker.line, marker.column);
    
    const content = this.parseInlineContent();
    const children: CSTNode[] = [];

    // Check for nested content
    this.skipNewlines();
    if (this.check(TokenType.INDENT)) {
      this.advance();
      
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        const node = this.parseNode();
        if (node) {
          children.push(node);
        }
        this.skipNewlines();
      }
      
      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    return {
      type: "ListItem",
      marker: marker.value,
      content,
      children,
      loc: span(
        startLoc,
        children.length > 0 
          ? children[children.length - 1]!.loc
          : content.length > 0 
            ? content[content.length - 1]!.loc 
            : startLoc
      ),
    };
  }

  /**
   * Parse a numbered item list using @@ syntax.
   * NUMBERED_ITEM tokens have value "level|style" (e.g., "2|a" for @@a)
   */
  private parseNumberedItemList(): CSTList {
    const items: CSTListItem[] = [];
    const firstToken = this.peek();
    const startLoc = loc(firstToken.line, firstToken.column);

    while (!this.isAtEnd() && this.check(TokenType.NUMBERED_ITEM)) {
      const marker = this.advance();
      const itemLoc = loc(marker.line, marker.column);
      
      const content = this.parseInlineContent();
      const children: CSTNode[] = [];

      // Check for nested content
      this.skipNewlines();
      if (this.check(TokenType.INDENT)) {
        this.advance();
        
        while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
          const node = this.parseNode();
          if (node) {
            children.push(node);
          }
          this.skipNewlines();
        }
        
        if (this.check(TokenType.DEDENT)) {
          this.advance();
        }
      }

      items.push({
        type: "ListItem",
        marker: marker.value, // "level|style" encoded
        content,
        children,
        loc: span(
          itemLoc,
          children.length > 0 
            ? children[children.length - 1]!.loc
            : content.length > 0 
              ? content[content.length - 1]!.loc 
              : itemLoc
        ),
      });
      
      this.skipNewlines();
    }

    return {
      type: "List",
      ordered: true, // NUMBERED_ITEM is always ordered
      items,
      loc: span(
        startLoc,
        items.length > 0 ? items[items.length - 1]!.loc : startLoc
      ),
    };
  }

  /**
   * Parse a footnote definition [^label]: content
   */
  private parseFootnoteDef(): CSTFootnoteDef {
    const token = this.advance(); // FOOTNOTE_DEF
    const startLoc = loc(token.line, token.column);
    
    const content: CSTNode[] = [];
    
    // Parse inline content on same line
    const para = this.parseParagraph();
    if (para && para.content.length > 0) {
      content.push(para);
    }
    
    // Check for continued content (indented block)
    this.skipNewlines();
    if (this.check(TokenType.INDENT)) {
      this.advance();
      
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        const node = this.parseNode();
        if (node) {
          content.push(node);
        }
        this.skipNewlines();
      }
      
      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    return {
      type: "FootnoteDef",
      label: token.value,
      content,
      loc: span(
        startLoc,
        content.length > 0 ? content[content.length - 1]!.loc : startLoc
      ),
    };
  }

  private parseBlockquote(): CSTBlockquote {
    const token = this.advance(); // BLOCKQUOTE
    const startLoc = loc(token.line, token.column);
    
    // Parse the rest of the line as content
    const content: CSTNode[] = [];
    const paragraph = this.parseParagraph();
    if (paragraph && paragraph.content.length > 0) {
      content.push(paragraph);
    }

    return {
      type: "Blockquote",
      content,
      loc: span(
        startLoc,
        content.length > 0 ? content[content.length - 1]!.loc : startLoc
      ),
    };
  }

  private parseHorizontalRule(): CSTHorizontalRule {
    const token = this.advance();
    return {
      type: "HorizontalRule",
      loc: loc(token.line, token.column, token.endLine, token.endColumn),
    };
  }

  private parseParagraph(): CSTParagraph {
    const content = this.parseInlineContent();
    
    if (content.length === 0) {
      const token = this.peek();
      return {
        type: "Paragraph",
        content: [],
        loc: loc(token.line, token.column),
      };
    }

    return {
      type: "Paragraph",
      content,
      loc: span(content[0]!.loc, content[content.length - 1]!.loc),
    };
  }

  // ===========================================================================
  // Inline Content
  // ===========================================================================

  private parseInlineContent(): CSTInline[] {
    const inlines: CSTInline[] = [];

    while (!this.isAtEnd() && !this.isBlockEnd()) {
      const inline = this.parseInline();
      if (inline) {
        inlines.push(inline);
      }
    }

    return inlines;
  }

  private parseInline(): CSTInline | null {
    const token = this.peek();

    switch (token.type) {
      case TokenType.TEXT:
        this.advance();
        return {
          type: "Text",
          value: token.value,
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        } as CSTText;

      case TokenType.VARIABLE:
        this.advance();
        return {
          type: "Variable",
          expression: token.value,
          loc: loc(token.line, token.column),
        } as CSTVariable;

      case TokenType.BOLD_MARKER:
        return this.parseEmphasis("bold");

      case TokenType.ITALIC_MARKER:
        return this.parseEmphasis("italic");

      case TokenType.STRIKE_MARKER:
        return this.parseEmphasis("strikethrough");

      case TokenType.HIGHLIGHT_MARKER:
        return this.parseEmphasis("highlight");

      case TokenType.CODE_MARKER:
        this.advance();
        return {
          type: "Emphasis",
          kind: "code",
          content: [{ type: "Text", value: token.value, loc: loc(token.line, token.column) } as CSTText],
          loc: loc(token.line, token.column),
        } as CSTEmphasis;

      case TokenType.HARD_BREAK:
        this.advance();
        return {
          type: "HardBreak",
          loc: loc(token.line, token.column),
        } as CSTHardBreak;

      case TokenType.FOOTNOTE_REF:
        this.advance();
        return {
          type: "FootnoteRef",
          label: token.value,
          loc: loc(token.line, token.column),
        } as CSTFootnoteRef;

      case TokenType.CROSS_REF:
        this.advance();
        return {
          type: "CrossRef",
          target: token.value,
          loc: loc(token.line, token.column),
        } as CSTCrossRef;

      case TokenType.LINK: {
        this.advance();
        // Value is "text|url"
        const pipeIdx = token.value.indexOf("|");
        const text = pipeIdx >= 0 ? token.value.slice(0, pipeIdx) : token.value;
        const url = pipeIdx >= 0 ? token.value.slice(pipeIdx + 1) : "";
        return {
          type: "Link",
          text: [{ type: "Text", value: text, loc: loc(token.line, token.column) } as CSTText],
          url,
          loc: loc(token.line, token.column),
        } as CSTLink;
      }

      case TokenType.IMAGE: {
        this.advance();
        // Value is "alt|src"
        const pipeIdx = token.value.indexOf("|");
        const alt = pipeIdx >= 0 ? token.value.slice(0, pipeIdx) : token.value;
        const src = pipeIdx >= 0 ? token.value.slice(pipeIdx + 1) : "";
        return {
          type: "Image",
          alt,
          src,
          loc: loc(token.line, token.column),
        } as CSTImage;
      }

      case TokenType.DIRECTIVE:
        // Inline directive
        return this.parseInlineDirective();

      case TokenType.STRING:
        // In inline context, STRING is a defined term
        this.advance();
        return {
          type: "DefinedTerm",
          term: token.value,
          loc: loc(token.line, token.column),
        } as CSTDefinedTerm;

      case TokenType.BLANK:
        this.advance();
        return {
          type: "Blank",
          width: token.value.length,
          loc: loc(token.line, token.column),
        } as CSTBlank;

      default:
        // Skip unknown inline tokens
        this.advance();
        return null;
    }
  }

  private parseEmphasis(kind: CSTEmphasis["kind"]): CSTEmphasis {
    const start = this.advance(); // opening marker
    const content: CSTInline[] = [];
    const startLoc = loc(start.line, start.column);

    // Parse until matching close or end of line
    while (!this.isAtEnd() && !this.isBlockEnd()) {
      const token = this.peek();
      
      // Check for closing marker
      if (
        (kind === "bold" && token.type === TokenType.BOLD_MARKER) ||
        (kind === "italic" && token.type === TokenType.ITALIC_MARKER) ||
        (kind === "strikethrough" && token.type === TokenType.STRIKE_MARKER) ||
        (kind === "highlight" && token.type === TokenType.HIGHLIGHT_MARKER)
      ) {
        this.advance(); // consume closing marker
        break;
      }

      const inline = this.parseInline();
      if (inline) {
        content.push(inline);
      }
    }

    return {
      type: "Emphasis",
      kind,
      content,
      loc: span(startLoc, content.length > 0 ? content[content.length - 1]!.loc : startLoc),
    };
  }

  private parseInlineDirective(): CSTInline | null {
    const directive = this.parseDirective();
    
    // Convert to inline directive if it's inline-compatible
    if (directive.name === "br") {
      return { type: "HardBreak", loc: directive.loc } as CSTHardBreak;
    }
    
    if (directive.name === "tab") {
      return { type: "Tab", loc: directive.loc };
    }

    // For now, return as text
    return {
      type: "Text",
      value: `@${directive.name}`,
      loc: directive.loc,
    } as CSTText;
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(offset = 0): Token {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1]!;
    }
    return this.tokens[idx]!;
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.pos - 1)]!;
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.previous();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }
  }

  private isBlockEnd(): boolean {
    const type = this.peek().type;
    return (
      type === TokenType.NEWLINE ||
      type === TokenType.EOF ||
      type === TokenType.DEDENT ||
      type === TokenType.INDENT
    );
  }
}

/**
 * Parse LDOC tokens into CST.
 */
export function parse(tokens: Token[]): ParseResult {
  return new Parser(tokens).parse();
}
