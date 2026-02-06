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
  
  // Context tracking for argument parsing
  // When parenDepth > 0, we're inside directive arguments and comma/colon/equals are special tokens
  // When parenDepth == 0, they should be treated as regular text characters
  private parenDepth = 0;

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

    // Newline — consume and check for paragraph breaks
    if (char === "\n") {
      // Newlines end unclosed argument lists (recovery)
      if (this.parenDepth > 0) {
        this.parenDepth = 0;
      }
      this.advance();
      this.line++;
      this.column = 0;
      this.atLineStart = true;
      // Don't emit any token for a single newline (soft continuation).
      // Paragraph breaks (PARA_BREAK) and empty paragraphs (EMPTY_PARAGRAPH)
      // are detected by handleIndentation when it finds blank lines.
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

    // Blank (fill-in line) - 3+ underscores
    if (char === "_" && this.peek(1) === "_" && this.peek(2) === "_") {
      this.scanBlank();
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

    // Single { - emit as text to prevent infinite loop
    if (char === "{") {
      this.tokens.push(token(TokenType.TEXT, "{", this.line, this.column, this.line, this.column + 1));
      this.advance();
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

    // Single ~ - emit as text to prevent infinite loop
    if (char === "~") {
      this.tokens.push(token(TokenType.TEXT, "~", this.line, this.column, this.line, this.column + 1));
      this.advance();
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

    // Closing bracket ] — always emitted as its own TEXT token
    // so the parser can match it for inline directive content: @style(args)[content]
    if (char === "]") {
      this.tokens.push(token(TokenType.TEXT, "]", this.line, this.column, this.line, this.column + 1));
      this.advance();
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
    
    // Lone ! (not image) - include in text
    if (char === "!") {
      this.tokens.push(token(TokenType.TEXT, "!", this.line, this.column, this.line, this.column + 1));
      this.advance();
      return;
    }

    // Argument syntax - parentheses are only special inside argument context
    // Opening ( is handled in scanDirective() when it immediately follows @name
    // Here we handle nested ( and ) inside argument lists
    if (char === "(" && this.parenDepth > 0) {
      // Nested ( inside arguments - track for matching but consume as text
      this.parenDepth++;
      this.tokens.push(token(TokenType.TEXT, "(", this.line, this.column, this.line, this.column + 1));
      this.advance();
      return;
    }
    if (char === ")" && this.parenDepth > 0) {
      this.parenDepth--;
      if (this.parenDepth === 0) {
        // Final closing paren - emit RPAREN to close argument list
        this.emit(TokenType.RPAREN, ")");
      } else {
        // Nested closing paren - consume as text
        this.tokens.push(token(TokenType.TEXT, ")", this.line, this.column, this.line, this.column + 1));
      }
      this.advance();
      return;
    }
    // Comma, colon, equals are only special tokens inside parentheses
    // Outside parentheses, they are regular text and will be captured by scanText()
    if (this.parenDepth > 0) {
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

    // Blank line detected (whitespace-only before newline/EOF).
    // Emit PARA_BREAK for the first blank line (paragraph separator).
    // Emit EMPTY_PARAGRAPH for each additional consecutive blank line.
    if (this.peek() === "\n" || this.isAtEnd()) {
      const prev = this.tokens.length > 0 ? this.tokens[this.tokens.length - 1] : undefined;
      if (prev && prev.type === TokenType.EMPTY_PARAGRAPH) {
        // Already in a run of blank lines — this is another empty paragraph
        this.tokens.push(token(TokenType.EMPTY_PARAGRAPH, "", this.line, startCol, this.line, this.column));
      } else if (prev && prev.type === TokenType.PARA_BREAK) {
        // Second blank line after a PARA_BREAK — first empty paragraph
        this.tokens.push(token(TokenType.EMPTY_PARAGRAPH, "", this.line, startCol, this.line, this.column));
      } else {
        // First blank line — paragraph separator
        this.tokens.push(token(TokenType.PARA_BREAK, "", this.line, startCol, this.line, this.column));
      }
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

    // If ( immediately follows the directive name (no whitespace), it's argument syntax.
    // e.g., @style(bold) — the ( starts argument parsing.
    // Without this, standalone ( in prose like "one (1)" would be misinterpreted.
    if (this.peek() === "(") {
      this.parenDepth++;
      this.emit(TokenType.LPAREN, "(");
      this.advance();
    }
  }

  private scanNumberedDirective(startLine: number, startCol: number): void {
    let level = 1; // We already consumed first @, now count additional @s
    while (this.peek() === "@") {
      level++;
      this.advance();
    }
    
    // Parse numbering style - supports:
    //   Decimal with sub-numbers (legal): 1, 1.1, 2.1.3
    //   Roman numerals: i, ii, iii, I, II, III
    //   Alpha: a, b, A, B
    const style = this.parseNumberedStyle();

    // Validate: must be followed by whitespace/newline/EOF
    const terminator = this.peek();
    if (terminator !== " " && terminator !== "\t" && terminator !== "\n" && terminator !== "\0" && !this.isAtEnd()) {
      // Not a numbered item - treat as directive (e.g., @someone)
      this.tokens.push(token(TokenType.DIRECTIVE, "@".repeat(level - 1) + style, startLine, startCol, this.line, this.column));
      return;
    }

    // Emit NUMBERED_ITEM with value encoding "level|style"
    const value = `${level}|${style}`;
    this.tokens.push(token(TokenType.NUMBERED_ITEM, value, startLine, startCol, this.line, this.column));
    this.skipSpaces();
  }

  /**
   * Parse a numbering style marker after @@ symbols.
   * Supports:
   *   - Decimal with sub-numbers (legal numbering): 1, 2.1, 2.1.3
   *   - Roman numerals: i, ii, iii, iv, I, II, III
   *   - Alpha: a, b, c, A, B, C
   *   - Empty (auto style)
   */
  private parseNumberedStyle(): string {
    const startPos = this.pos;
    const startCol = this.column;

    // Decimal with possible sub-numbers: 1, 2.1, 2.1.3
    if (this.isDigit(this.peek())) {
      while (this.isDigit(this.peek()) || this.peek() === ".") {
        // Don't consume trailing dot (e.g., "1." — dot followed by non-digit is end)
        if (this.peek() === ".") {
          if (!this.isDigit(this.peek(1))) break;
        }
        this.advance();
      }
      return this.input.slice(startPos, this.pos);
    }

    // Roman numerals: i, ii, iii, iv, v, vi, vii, viii, ix, x (or uppercase)
    if (/[ivxIVX]/.test(this.peek())) {
      while (/[ivxIVX]/.test(this.peek())) {
        this.advance();
      }
      const roman = this.input.slice(startPos, this.pos);
      if (/^[ivx]+$/i.test(roman)) {
        return roman;
      }
      // Backtrack if not valid roman
      this.pos = startPos;
      this.column = startCol;
    }

    // Alpha: a, b, c or A, B, C (single letter)
    if (this.isLetter(this.peek())) {
      return this.advance();
    }

    // Auto (no explicit style)
    return "";
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

  private scanBlank(): void {
    const startLine = this.line;
    const startCol = this.column;
    let count = 0;
    
    while (this.peek() === "_") {
      count++;
      this.advance();
    }
    
    this.tokens.push(token(TokenType.BLANK, "_".repeat(count), startLine, startCol, this.line, this.column));
  }

  private scanVariable(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // {
    this.advance(); // {

    let expr = "";
    let incomplete = false;
    
    while (!this.isAtEnd() && !(this.peek() === "}" && this.peek(1) === "}")) {
      if (this.peek() === "\n") {
        // Unclosed variable - emit diagnostic but still create token with incomplete flag
        this.diagnostics.push(
          error(
            DiagnosticCode.UNCLOSED_BLOCK,
            "Unclosed variable expression - missing }}",
            loc(startLine, startCol)
          )
        );
        incomplete = true;
        break;
      }
      expr += this.advance();
    }

    if (!incomplete && !this.isAtEnd()) {
      this.advance(); // }
      this.advance(); // }
    }

    // Always emit a token, with incomplete flag if needed
    const tok = token(TokenType.VARIABLE, expr.trim(), startLine, startCol, this.line, this.column);
    if (incomplete) {
      tok.incomplete = true;
    }
    this.tokens.push(tok);
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

    // Check for footnote [^...]
    if (this.peek(1) === "^") {
      this.advance(); // [
      this.advance(); // ^
      let label = "";
      let incomplete = false;
      
      while (!this.isAtEnd() && this.peek() !== "]" && this.peek() !== "\n") {
        label += this.advance();
      }
      
      if (this.peek() === "]") {
        this.advance();
      } else {
        // Unclosed footnote reference - missing ]
        incomplete = true;
        this.diagnostics.push(
          error(
            DiagnosticCode.UNCLOSED_DELIMITER,
            "Unclosed footnote reference - missing ]",
            loc(startLine, startCol)
          )
        );
      }
      
      // Check for footnote definition [^label]:
      if (!incomplete && this.peek() === ":") {
        this.advance(); // :
        this.skipSpaces();
        this.tokens.push(token(TokenType.FOOTNOTE_DEF, label, startLine, startCol, this.line, this.column));
      } else {
        const tok = token(TokenType.FOOTNOTE_REF, label, startLine, startCol, this.line, this.column);
        if (incomplete) {
          tok.incomplete = true;
        }
        this.tokens.push(tok);
      }
      return;
    }

    // Check for cross-ref [[...]]
    if (this.peek(1) === "[") {
      this.advance(); // [
      this.advance(); // [
      let target = "";
      let incomplete = false;
      while (!this.isAtEnd() && this.peek() !== "]") {
        target += this.advance();
      }
      if (this.peek() === "]") {
        this.advance(); // first ]
        if (this.peek() === "]") {
          this.advance(); // second ]
        } else {
          incomplete = true;
        }
      } else {
        incomplete = true;
      }
      const tok = token(TokenType.CROSS_REF, target, startLine, startCol, this.line, this.column);
      if (incomplete) {
        tok.incomplete = true;
      }
      this.tokens.push(tok);
      return;
    }

    // Check for link [text](url) - lookahead for ](
    const linkCheck = this.lookaheadIsLink();
    if (linkCheck.isLink) {
      this.scanLink(linkCheck.mightBeIncomplete);
      return;
    }

    // Not a special bracket - emit as text
    this.tokens.push(token(TokenType.TEXT, "[", startLine, startCol, this.line, this.column + 1));
    this.advance();
  }

  /**
   * Look ahead to see if this is a link [text](url) or partial link [text](url
   * Returns object indicating if it's a link and if it might be incomplete
   */
  private lookaheadIsLink(): { isLink: boolean; mightBeIncomplete: boolean } {
    let i = this.pos + 1;
    // Scan for ]
    while (i < this.input.length && this.input[i] !== "]") {
      if (this.input[i] === "\n") return { isLink: false, mightBeIncomplete: false }; // Links can't span lines
      i++;
    }
    
    if (i >= this.input.length) return { isLink: false, mightBeIncomplete: false }; // No closing ]
    
    // Check for ( after ]
    if (this.input[i + 1] === "(") {
      // Now check if there's a closing ) before newline/EOF
      let j = i + 2;
      while (j < this.input.length && this.input[j] !== ")" && this.input[j] !== "\n") {
        j++;
      }
      // If we hit newline or EOF without ), it's an incomplete link
      const mightBeIncomplete = j >= this.input.length || this.input[j] === "\n";
      return { isLink: true, mightBeIncomplete };
    }
    
    return { isLink: false, mightBeIncomplete: false };
  }

  /**
   * Scan a link [text](url)
   * @param mightBeIncomplete - hint from lookahead that closing ) may be missing
   */
  private scanLink(mightBeIncomplete = false): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // [

    // Read text until ]
    let text = "";
    while (!this.isAtEnd() && this.peek() !== "]") {
      text += this.advance();
    }
    this.advance(); // ]

    // Read URL from (...)
    let url = "";
    let incomplete = false;
    
    if (this.peek() === "(") {
      this.advance(); // (
      while (!this.isAtEnd() && this.peek() !== ")" && this.peek() !== "\n") {
        url += this.advance();
      }
      if (this.peek() === ")") {
        this.advance(); // )
      } else {
        // Missing closing )
        incomplete = true;
        this.diagnostics.push(
          error(
            DiagnosticCode.UNCLOSED_DELIMITER,
            "Unclosed link - missing )",
            loc(startLine, startCol)
          )
        );
      }
    }

    const tok = token(TokenType.LINK, `${text}|${url}`, startLine, startCol, this.line, this.column);
    if (incomplete) {
      tok.incomplete = true;
    }
    this.tokens.push(tok);
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

      // Stop at special characters that are always special
      if (
        char === "\n" ||
        char === "@" ||
        char === "{" ||
        char === "*" ||
        char === "~" ||
        char === "`" ||
        char === "[" ||
        char === "]" ||
        char === "!" ||
        char === "#" ||
        char === '"' ||
        char === "'"
      ) {
        break;
      }
      
      // Parentheses are special inside argument context
      // ( increments depth (handled in scanToken), ) decrements/closes
      if (this.parenDepth > 0 && (char === "(" || char === ")")) {
        break;
      }
      
      // Equals is special for == highlight markers (check for double =)
      if (char === "=" && this.peek(1) === "=") {
        break;
      }
      
      // Underscore is special for ___ blank markers (check for triple _)
      if (char === "_" && this.peek(1) === "_" && this.peek(2) === "_") {
        break;
      }
      
      // Comma, colon, single equals are only stopchars inside parentheses (argument context)
      if (this.parenDepth > 0 && (char === "," || char === ":" || char === "=")) {
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
