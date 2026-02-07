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
  /** True when no non-whitespace token has been emitted on the current line yet. */
  private atLineStart = true;

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
      this.emit(TokenType.BLANK_LINE, "\n");
      this.advance();
      this.line++;
      this.column = 0;
      this.atLineStart = true;
      return;
    }

    // Spaces and tabs (preserve atLineStart — whitespace doesn't count)
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

    // All remaining tokens are non-whitespace — clear atLineStart after dispatch
    const wasAtLineStart = this.atLineStart;
    this.atLineStart = false;

    // Escape sequences (Spec §3.3)
    if (char === "\\") {
      this.scanEscape();
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

    // Directive start
    if (char === "@") {
      this.scanDirective(wasAtLineStart);
      return;
    }

    // Line comment
    if (char === "/" && this.peek(1) === "/") {
      this.scanLineComment();
      return;
    }

    // Single slash (not a comment) — consume as text
    if (char === "/") {
      this.emit(TokenType.TEXT, "/");
      this.advance();
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

    // Default: consume as text
    this.scanText();
  }

  private scanDirective(atLineStart: boolean): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // skip @

    // Check for list markers: @- or @#
    // Also handle nested list markers: @@-, @@@-, @@#, etc.
    // Per spec §11.5: markers are only recognized at start-of-line (after optional whitespace)
    const nextChar = this.peek();
    if (atLineStart && nextChar === "-") {
      this.advance(); // consume -
      this.emit(TokenType.LIST_BULLET, "@-", startLine, startCol, this.line, this.column);
      return;
    }
    if (atLineStart && nextChar === "#") {
      this.advance(); // consume #
      this.emit(TokenType.LIST_ORDERED, "@#", startLine, startCol, this.line, this.column);
      return;
    }
    if (nextChar === "@") {
      // Could be nested list marker (@@-, @@@-, etc.) or just stacked @@ text
      if (atLineStart) {
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
      // Not at line start — emit lone @ as text, let next iteration handle the rest
      this.tokens.push(token(TokenType.TEXT, "@", startLine, startCol, this.line, this.column));
      return;
    }

    // Not at line start and we see @- or @# — treat as text, not a list marker
    if (!atLineStart && (nextChar === "-" || nextChar === "#")) {
      // Emit the @ as text; the - or # will be picked up by scanToken next iteration
      this.tokens.push(token(TokenType.TEXT, "@", startLine, startCol, this.line, this.column));
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
    } else {
      // Unterminated string — hit newline or EOF before closing quote
      this.diagnostics.push(
        error(
          DiagnosticCode.UNCLOSED_DELIMITER,
          `Unterminated string literal (missing closing ${quote})`,
          loc(startLine, startCol)
        )
      );
    }

    this.emit(TokenType.STRING, value, startLine, startCol, this.line, this.column);
    // Tag with original quote character for faithful roundtripping
    this.tokens[this.tokens.length - 1]!.quote = quote;
  }

  /**
   * Scan an escape sequence (Spec §3.3).
   * Recognized: \\ \@ \[ \] \{ \} \( \) \$
   * Unknown \X → literal \X
   */
  private scanEscape(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // consume backslash

    if (this.isAtEnd()) {
      // Trailing backslash at end of input → literal backslash
      this.emit(TokenType.TEXT, "\\", startLine, startCol, this.line, this.column);
      return;
    }

    const next = this.peek();
    const escapable = "\\@[]{}()$";
    if (escapable.includes(next)) {
      this.advance(); // consume the escaped character
      this.emit(TokenType.TEXT, next, startLine, startCol, this.line, this.column);
    } else {
      // Unknown escape → literal \X
      // If the next char is a newline, don't consume it — let the main
      // loop handle it so BLANK_LINE is emitted and line/column stay correct.
      const next2 = this.peek();
      if (next2 === "\n") {
        this.emit(TokenType.TEXT, "\\", startLine, startCol, this.line, this.column);
      } else {
        const char = this.advance();
        this.emit(TokenType.TEXT, "\\" + char, startLine, startCol, this.line, this.column);
      }
    }
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
        char === "\\" ||
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
        char === "."
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
      // Stop at paragraph delimiters so they can be tokenized independently.
      // This ensures `[text // comment ] more]` doesn't swallow the `]`.
      if (this.peek() === "]" || this.peek() === "[") {
        break;
      }
      comment += this.advance();
    }

    this.emit(TokenType.COMMENT, comment, startLine, startCol, this.line, this.column);
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
