/**
 * LDOC Lexer
 * 
 * Produces tokens from LDOC source text.
 * Design goals:
 * - Keep lexer "dumb" - minimal semantic knowledge
 * - Handle indentation-based blocks (INDENT/DEDENT)
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
  
  // Indentation tracking
  private indentStack: number[] = [0];
  private atLineStart = true;

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): LexResult {
    while (!this.isAtEnd()) {
      this.scanToken();
    }

    // Emit remaining DEDENTs
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.emit(TokenType.DEDENT, "");
    }

    this.emit(TokenType.EOF, "");
    
    return {
      tokens: this.tokens,
      diagnostics: this.diagnostics,
    };
  }

  private scanToken(): void {
    // Handle start of line - indentation
    if (this.atLineStart) {
      this.handleIndentation();
      this.atLineStart = false;
    }

    if (this.isAtEnd()) return;

    const char = this.peek();

    // Newline
    if (char === "\n") {
      this.emit(TokenType.NEWLINE, "\n");
      this.advance();
      this.line++;
      this.column = 0;
      this.atLineStart = true;
      return;
    }

    // Skip spaces (not at line start)
    if (char === " " || char === "\t") {
      this.advance();
      return;
    }

    // Comments
    if (char === "/" && this.peek(1) === "/") {
      this.scanLineComment();
      return;
    }

    // Directives
    if (char === "@") {
      this.scanDirective();
      return;
    }

    // Headers
    if (char === "#") {
      this.scanHeader();
      return;
    }

    // Horizontal rule
    if (char === "-" && this.peek(1) === "-" && this.peek(2) === "-") {
      this.scanHorizontalRule();
      return;
    }

    // Bullet
    if (char === "-" && this.isWhitespace(this.peek(1))) {
      this.emit(TokenType.BULLET, "-");
      this.advance();
      this.skipSpaces();
      return;
    }

    // Numbered list (1. 2. a. etc)
    if (this.isDigit(char) || this.isLetter(char)) {
      if (this.tryNumberedItem()) {
        return;
      }
    }

    // Blockquote
    if (char === ">") {
      this.emit(TokenType.BLOCKQUOTE, ">");
      this.advance();
      this.skipSpaces();
      return;
    }

    // Variable {{ ... }}
    if (char === "{" && this.peek(1) === "{") {
      this.scanVariable();
      return;
    }

    // Bold **
    if (char === "*" && this.peek(1) === "*") {
      this.scanEmphasis("**", TokenType.BOLD_MARKER);
      return;
    }

    // Italic *
    if (char === "*" && this.peek(1) !== "*") {
      this.scanEmphasis("*", TokenType.ITALIC_MARKER);
      return;
    }

    // Strikethrough ~~
    if (char === "~" && this.peek(1) === "~") {
      this.scanEmphasis("~~", TokenType.STRIKE_MARKER);
      return;
    }

    // Highlight ==
    if (char === "=" && this.peek(1) === "=") {
      this.scanEmphasis("==", TokenType.HIGHLIGHT_MARKER);
      return;
    }

    // Inline code `
    if (char === "`") {
      this.scanInlineCode();
      return;
    }

    // Links and references
    if (char === "[") {
      this.scanBracket();
      return;
    }

    // Image
    if (char === "!" && this.peek(1) === "[") {
      this.scanImage();
      return;
    }

    // Argument syntax
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
    if (char === ",") {
      this.emit(TokenType.COMMA, ",");
      this.advance();
      return;
    }
    if (char === ":") {
      this.emit(TokenType.COLON, ":");
      this.advance();
      return;
    }
    if (char === "=") {
      this.emit(TokenType.EQUALS, "=");
      this.advance();
      return;
    }

    // String literal
    if (char === '"' || char === "'") {
      this.scanString();
      return;
    }

    // Default: text content
    this.scanText();
  }

  // ===========================================================================
  // Indentation
  // ===========================================================================

  private handleIndentation(): void {
    const startCol = this.column;
    let spaces = 0;
    let hasSpaces = false;
    let hasTabs = false;

    while (!this.isAtEnd() && (this.peek() === " " || this.peek() === "\t")) {
      if (this.peek() === " ") {
        hasSpaces = true;
        spaces++;
      } else {
        hasTabs = true;
        spaces += 4; // Tabs count as 4 spaces
      }
      this.advance();
    }

    // Reject mixed tabs and spaces
    if (hasSpaces && hasTabs) {
      this.diagnostics.push(
        error(
          DiagnosticCode.INVALID_INDENT,
          "Mixed tabs and spaces in indentation; use one or the other",
          loc(this.line, startCol)
        )
      );
    }
    // Tabs count as 2 spaces
    while (!this.isAtEnd() && this.peek() === "\t") {
      spaces += 2;
      this.advance();
    }

    // Skip blank lines
    if (this.peek() === "\n" || this.isAtEnd()) {
      return;
    }

    // Skip comment-only lines for indentation purposes
    if (this.peek() === "/" && this.peek(1) === "/") {
      return;
    }

    const currentIndent = this.indentStack[this.indentStack.length - 1]!;

    if (spaces > currentIndent) {
      this.indentStack.push(spaces);
      this.emit(TokenType.INDENT, "");
    } else if (spaces < currentIndent) {
      while (
        this.indentStack.length > 1 &&
        this.indentStack[this.indentStack.length - 1]! > spaces
      ) {
        this.indentStack.pop();
        this.emit(TokenType.DEDENT, "");
      }
    }
  }

  // ===========================================================================
  // Scanning helpers
  // ===========================================================================

  private scanDirective(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // skip @

    // Check for numbered item (@@, @@@)
    if (this.peek() === "@") {
      this.scanNumberedDirective(startLine, startCol);
      return;
    }

    // Read directive name
    let name = "";
    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === "_")) {
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

    this.tokens.push(token(TokenType.DIRECTIVE, name, startLine, startCol, this.line, this.column));
  }

  private scanNumberedDirective(startLine: number, startCol: number): void {
    let level = 1;
    while (this.peek() === "@") {
      level++;
      this.advance();
    }
    
    // Optional style marker (a, i, A, I, 1)
    let style = "";
    if (this.isAlphaNumeric(this.peek())) {
      style = this.advance();
    }

    const value = "@".repeat(level) + style;
    this.tokens.push(token(TokenType.NUMBERED, value, startLine, startCol, this.line, this.column));
  }

  private scanHeader(): void {
    const startLine = this.line;
    const startCol = this.column;
    let level = 0;

    while (this.peek() === "#" && level < 6) {
      level++;
      this.advance();
    }

    // Skip space after #
    this.skipSpaces();

    this.tokens.push(token(TokenType.HEADER_MARKER, "#".repeat(level), startLine, startCol, this.line, this.column));
  }

  private scanHorizontalRule(): void {
    const startLine = this.line;
    const startCol = this.column;
    
    while (this.peek() === "-") {
      this.advance();
    }

    this.tokens.push(token(TokenType.HORIZONTAL_RULE, "---", startLine, startCol, this.line, this.column));
  }

  private tryNumberedItem(): boolean {
    // Look ahead for pattern like "1." or "a."
    let i = 0;
    while (this.isDigit(this.peek(i)) || this.isLetter(this.peek(i))) {
      i++;
    }
    if (this.peek(i) === "." && this.isWhitespace(this.peek(i + 1))) {
      const startCol = this.column;
      let marker = "";
      for (let j = 0; j <= i; j++) {
        marker += this.advance();
      }
      this.skipSpaces();
      this.tokens.push(token(TokenType.NUMBERED, marker, this.line, startCol, this.line, this.column));
      return true;
    }
    return false;
  }

  private scanVariable(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // {
    this.advance(); // {

    let expr = "";
    while (!this.isAtEnd() && !(this.peek() === "}" && this.peek(1) === "}")) {
      if (this.peek() === "\n") {
        this.diagnostics.push(
          error(
            DiagnosticCode.UNCLOSED_BLOCK,
            "Unclosed variable expression",
            loc(startLine, startCol)
          )
        );
        return;
      }
      expr += this.advance();
    }

    if (!this.isAtEnd()) {
      this.advance(); // }
      this.advance(); // }
    }

    this.tokens.push(token(TokenType.VARIABLE, expr.trim(), startLine, startCol, this.line, this.column));
  }

  private scanEmphasis(marker: string, type: TokenType): void {
    const startLine = this.line;
    const startCol = this.column;
    
    for (let i = 0; i < marker.length; i++) {
      this.advance();
    }

    this.tokens.push(token(type, marker, startLine, startCol, this.line, this.column));
  }

  private scanInlineCode(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // `

    let content = "";
    while (!this.isAtEnd() && this.peek() !== "`" && this.peek() !== "\n") {
      content += this.advance();
    }

    if (this.peek() === "`") {
      this.advance();
    }

    this.tokens.push(token(TokenType.CODE_MARKER, content, startLine, startCol, this.line, this.column));
  }

  private scanBracket(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // [

    // Check for footnote [^...]
    if (this.peek() === "^") {
      this.advance();
      let label = "";
      while (!this.isAtEnd() && this.peek() !== "]") {
        label += this.advance();
      }
      if (this.peek() === "]") this.advance();
      this.tokens.push(token(TokenType.FOOTNOTE_REF, label, startLine, startCol, this.line, this.column));
      return;
    }

    // Check for cross-ref [@...]
    if (this.peek() === "@") {
      this.advance();
      let target = "";
      while (!this.isAtEnd() && this.peek() !== "]") {
        target += this.advance();
      }
      if (this.peek() === "]") this.advance();
      this.tokens.push(token(TokenType.CROSS_REF, target, startLine, startCol, this.line, this.column));
      return;
    }

    // Regular link [text](url)
    this.emit(TokenType.LINK_START, "[");
  }

  private scanImage(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // !
    this.advance(); // [

    let alt = "";
    while (!this.isAtEnd() && this.peek() !== "]") {
      alt += this.advance();
    }
    if (this.peek() === "]") this.advance();

    let src = "";
    if (this.peek() === "(") {
      this.advance();
      while (!this.isAtEnd() && this.peek() !== ")") {
        src += this.advance();
      }
      if (this.peek() === ")") this.advance();
    }

    this.tokens.push(token(TokenType.IMAGE, `${alt}|${src}`, startLine, startCol, this.line, this.column));
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

    this.tokens.push(token(TokenType.STRING, value, startLine, startCol, this.line, this.column));
  }

  private scanText(): void {
    const startLine = this.line;
    const startCol = this.column;
    let text = "";

    while (!this.isAtEnd()) {
      const char = this.peek();

      // Stop at special characters
      if (
        char === "\n" ||
        char === "@" ||
        char === "{" ||
        char === "*" ||
        char === "~" ||
        char === "=" ||
        char === "`" ||
        char === "[" ||
        char === "!" ||
        char === "#" ||
        char === "(" ||
        char === ")" ||
        char === "," ||
        char === ":" ||
        char === '"' ||
        char === "'"
      ) {
        break;
      }

      text += this.advance();
    }

    if (text) {
      this.tokens.push(token(TokenType.TEXT, text, startLine, startCol, this.line, this.column));
    }
  }

  private scanLineComment(): void {
    this.advance(); // /
    this.advance(); // /

    let comment = "";
    while (!this.isAtEnd() && this.peek() !== "\n") {
      comment += this.advance();
    }

    this.tokens.push(token(TokenType.COMMENT, comment.trim(), this.line, this.column - comment.length - 2, this.line, this.column));
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

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

  private emit(type: TokenType, value: string): void {
    this.tokens.push(token(type, value, this.line, this.column, this.line, this.column + value.length));
  }

  private skipSpaces(): void {
    while (this.peek() === " " || this.peek() === "\t") {
      this.advance();
    }
  }

  private isWhitespace(char: string): boolean {
    return char === " " || char === "\t" || char === "\n";
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
