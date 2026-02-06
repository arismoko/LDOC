/**
 * LDOC Lexer v3
 *
 * Produces tokens from LDOC source text.
 * Design goals:
 * - Keep lexer "dumb" - minimal semantic knowledge
 * - Handle v3 structural syntax only
 * - Pass complex parsing to the parser
 */

import { TokenType, type Token, token } from "../types/tokens.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error, DiagnosticCode } from "../types/diagnostics.ts";
import { loc } from "../types/source-location.ts";

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

export class Lexer {
  private input: string;
  private pos = 0;
  private line = 1;
  private column = 0;
  private tokens: Token[] = [];
  private diagnostics: Diagnostic[] = [];

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): LexResult {
    while (!this.isAtEnd()) {
      this.scanToken();
    }

    this.emit(TokenType.EOF, "");
    
    return {
      tokens: this.tokens,
      diagnostics: this.diagnostics,
    };
  }

  private scanToken(): void {
    const char = this.peek();

    // Newline
    if (char === "\n") {
      this.advance();
      this.line++;
      this.column = 0;
      // Emit BLANK_LINE at end of file for blank line detection
      if (this.isAtEnd()) {
        this.emit(TokenType.BLANK_LINE, "");
      }
      return;
    }

    // Spaces and tabs
    if (char === " " || char === "\t") {
      const wsStart = this.line;
      const wsCol = this.column;
      let ws = "";
      while (!this.isAtEnd() && (this.peek() === " " || this.peek() === "\t")) {
        ws += this.advance();
      }
      this.tokens.push(token(TokenType.TEXT, ws, wsStart, wsCol, this.line, this.column));
      return;
    }

    // Paragraph block open
    if (char === "[") {
      this.emit(TokenType.PARA_OPEN, "[");
      this.advance();
      return;
    }

    // Paragraph block close
    if (char === "]") {
      this.emit(TokenType.PARA_CLOSE, "]");
      this.advance();
      return;
    }

    // Lua expression open
    if (char === "$" && this.peek(1) === "(") {
      this.emit(TokenType.LUA_EXPR_OPEN, "$(");
      this.advance();
      this.advance();
      return;
    }

    // Lua block open
    if (char === "@" && this.peek(1) === "l" && this.peek(2) === "u" && this.peek(3) === "a" && this.peek(4) === "{") {
      this.emit(TokenType.LUA_BLOCK_OPEN, "@lua{");
      this.advance();
      this.advance();
      this.advance();
      this.advance();
      this.advance();
      return;
    }

    // Directive start
    if (char === "@") {
      this.scanDirective();
      return;
    }

    // Line comment
    if (char === "/" && this.peek(1) === "/") {
      this.scanLineComment();
      return;
    }

    // Braces
    if (char === "{") {
      this.emit(TokenType.LBRACE, "{");
      this.advance();
      return;
    }

    if (char === "}") {
      this.emit(TokenType.RBRACE, "}");
      this.advance();
      return;
    }

    // Parens
    if (char === "(") {
      this.emit(TokenType.LPAREN, "(");
      this.advance();
      return;
    }

    if (char === ")") {
      this.emit(TokenType.RPAREN, ")");
      this.advance();
      return;
    }

    // Period (used for numbering, table separation)
    if (char === ".") {
      this.emit(TokenType.PERIOD, ".");
      this.advance();
      return;
    }

    // Comma (used in args)
    if (char === ",") {
      this.emit(TokenType.COMMA, ",");
      this.advance();
      return;
    }

    // Colon (used in args)
    if (char === ":") {
      this.emit(TokenType.COLON, ":");
      this.advance();
      return;
    }

    // Equals (used in args)
    if (char === "=") {
      this.emit(TokenType.EQUALS, "=");
      this.advance();
      return;
    }

    // Identifier
    if (this.isAlphaNumeric(char) || char === "_") {
      this.scanIdentifier();
      return;
    }

    // String literal
    if (char === '"' || char === "'") {
      this.scanString();
      return;
    }

    // Number literal
    if (this.isDigit(char)) {
      this.scanNumber();
      return;
    }

    // Default: consume as text
    this.scanText();
  }

  private scanDirective(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // skip @

    // Check for list markers: @- or @#
    // Also handle nested list markers: @@-, @@@-, @@#, etc.
    const nextChar = this.peek();
    if (nextChar === "-") {
      this.advance(); // consume -
      this.emit(TokenType.LIST_BULLET, "@-", startLine, startCol, this.line, this.column);
      return;
    }
    if (nextChar === "#") {
      this.advance(); // consume #
      this.emit(TokenType.LIST_ORDERED, "@#", startLine, startCol, this.line, this.column);
      return;
    }
    if (nextChar === "@") {
      // Nested list marker: @@-, @@@-, @@#, etc.
      let depth = 1; // already consumed one @
      while (this.peek() === "@") {
        depth++;
        this.advance();
      }
      if (this.peek() === "-") {
        this.advance();
        this.emit(TokenType.LIST_BULLET, "@".repeat(depth) + "-", startLine, startCol, this.line, this.column);
        return;
      }
      if (this.peek() === "#") {
        this.advance();
        this.emit(TokenType.LIST_ORDERED, "@".repeat(depth) + "#", startLine, startCol, this.line, this.column);
        return;
      }
      // Not a list marker, these @@ are text
      this.tokens.push(token(TokenType.TEXT, "@".repeat(depth), startLine, startCol, this.line, this.column));
      return;
    }

    // Read directive name
    let name = "";
    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === "_" || this.peek() === "-")) {
      name += this.advance();
    }

    if (!name) {
      this.diagnostics.push(
        error(
          DiagnosticCode.INVALID_DIRECTIVE,
          "Expected directive name after @",
          loc(startLine, startCol)
        )
      );
      return;
    }

    this.emit(TokenType.DIRECTIVE, name, startLine, startCol, this.line, this.column);
    // The ( after a directive name will be handled by the main scanToken loop
  }

  private scanIdentifier(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === "_")) {
      value += this.advance();
    }

    this.emit(TokenType.IDENTIFIER, value, startLine, startCol, this.line, this.column);
  }

  private scanString(): void {
    const startLine = this.line;
    const startCol = this.column;
    const quote = this.advance();

    let value = "";
    while (!this.isAtEnd() && this.peek() !== quote) {
      if (this.peek() === "\\" && this.peek(1) === quote) {
        this.advance();
        value += this.advance();
      } else if (this.peek() === "\n") {
        break;
      } else {
        value += this.advance();
      }
    }

    if (this.peek() === quote) {
      this.advance();
    }

    this.emit(TokenType.STRING, value, startLine, startCol, this.line, this.column);
  }

  private scanNumber(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      value += this.advance();
    }

    // Check for decimal point (length tokens use this pattern)
    if (this.peek() === ".") {
      value += this.advance();
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    this.emit(TokenType.NUMBER, value, startLine, startCol, this.line, this.column);
  }

  private scanText(): void {
    const startLine = this.line;
    const startCol = this.column;
    let text = "";

    while (!this.isAtEnd()) {
      const char = this.peek();

      // Stop at any token start characters
      if (
        char === "\n" ||
        char === "@" ||
        char === "{" ||
        char === "}" ||
        char === "$" ||
        char === "[" ||
        char === "]" ||
        char === '"' ||
        char === "'" ||
        char === "(" ||
        char === ")" ||
        char === "," ||
        char === ":" ||
        char === "=" ||
        char === "." ||
        char === "/"
      ) {
        break;
      }

      text += this.advance();
    }

    if (text) {
      this.emit(TokenType.TEXT, text, startLine, startCol, this.line, this.column);
    }
  }

  private scanLineComment(): void {
    const startLine = this.line;
    const startCol = this.column;

    this.advance(); // /
    this.advance(); // /

    let comment = "";
    while (!this.isAtEnd() && this.peek() !== "\n") {
      comment += this.advance();
    }

    this.emit(TokenType.COMMENT, comment.trim(), startLine, startCol, this.line, this.column);
  }

  private isAtEnd(): boolean {
    return this.pos >= this.input.length;
  }

  private peek(offset = 0): string {
    const idx = this.pos + offset;
    if (idx >= this.input.length) return "\0";
    return this.input[idx]!;
  }

  private advance(): string {
    const char = this.input[this.pos]!;
    this.pos++;
    this.column++;
    return char;
  }

  private emit(type: TokenType, value: string, startLine?: number, startCol?: number, endLine?: number, endCol?: number): void {
    this.tokens.push(token(
      type,
      value,
      startLine ?? this.line,
      startCol ?? this.column,
      endLine ?? this.line,
      endCol ?? this.column + value.length
    ));
  }

  private isDigit(char: string): boolean {
    return char >= "0" && char <= "9";
  }

  private isLetter(char: string): boolean {
    return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isLetter(char) || this.isDigit(char);
  }
}

/**
 * Tokenize LDOC source text.
 */
export function tokenize(source: string): LexResult {
  return new Lexer(source).tokenize();
}
