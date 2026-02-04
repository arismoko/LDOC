import { IndentationManager } from "../indentation-manager";
import { TokenType, type Token, MODIFIERS, LEGACY_DOCUMENT_DIRECTIVES, KEYWORDS } from "./patterns";

export class Lexer {
  private input: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private indentation = new IndentationManager();
  private tokens: Token[] = [];

  private debug: boolean = false;
  private maxIterations: number = 100000;
  private lineHasContent: boolean = false;

  constructor(input: string, options?: { debug?: boolean }) {
    this.input = input;
    this.debug = options?.debug ?? false;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log(`[Lexer pos=${this.pos} line=${this.line} col=${this.column}]`, ...args);
    }
  }

  tokenize(): Token[] {
    let iterations = 0;
    let lastPos = -1;

    while (this.pos < this.input.length) {
      // Detect infinite loop
      if (this.pos === lastPos) {
        const char = this.peek();
        const context = this.input.slice(Math.max(0, this.pos - 10), this.pos + 20);
        throw new Error(
          `Lexer stuck at position ${this.pos}, line ${this.line}, column ${this.column}. ` +
          `Current char: '${char}' (code ${char.charCodeAt(0)}). ` +
          `Context: "${context.replace(/\n/g, '\\n')}"`
        );
      }
      
      if (++iterations > this.maxIterations) {
        throw new Error(`Lexer exceeded ${this.maxIterations} iterations. Likely infinite loop.`);
      }

      lastPos = this.pos;
      this.log(`scanToken, char='${this.peek()}'`);
      this.scanToken();
    }

    // Emit remaining dedents
    while (this.indentation.remainingLevels() > 0) {
      this.indentation.popIndent();
      this.tokens.push(this.makeToken(TokenType.DEDENT, ""));
    }

    this.tokens.push(this.makeToken(TokenType.EOF, ""));
    return this.tokens;
  }

  private scanToken(): void {
    // Handle start of line (indentation)
    if (this.column === 1) {
      this.handleIndentation();
    }

    if (this.pos >= this.input.length) return;

    const char = this.peek();

    // Comments
    if (char === "/" && this.peek(1) === "/") {
      this.scanLineComment();
      return;
    }
    if (char === "/" && this.peek(1) === "*") {
      this.scanBlockComment();
      return;
    }

    // Newline
    if (char === "\n") {
      this.tokens.push(this.makeToken(TokenType.NEWLINE, "\n"));
      this.advance();
      this.line++;
      this.column = 1;
      this.lineHasContent = false;
      return;
    }

    // Horizontal rule (---)
    if (char === "-" && this.peek(1) === "-" && this.peek(2) === "-") {
      const startCol = this.column;
      this.advance();
      this.advance();
      this.advance();
      
      // Consume any extra dashes
      while (this.peek() === "-") {
        this.advance();
      }
      
      this.pushToken({
        type: TokenType.HORIZONTAL_RULE,
        value: "---",
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
      return;
    }

    // Blockquote (> text)
    if (char === ">") {
      const startCol = this.column;
      this.advance();
      
      // Optional space after >
      if (this.peek() === " ") {
        this.advance();
      }
      
      this.pushToken({
        type: TokenType.BLOCKQUOTE,
        value: ">",
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
      return;
    }

    // Headers (markdown style) - allow after modifiers too
    // Also allow when at the start of line content (lineHasContent is false)
    if (char === "#") {
      const lastToken = this.tokens[this.tokens.length - 1];
      if (this.column === 1 || !this.lineHasContent || lastToken?.type === TokenType.INDENT || lastToken?.type === TokenType.MODIFIER) {
        this.scanHeader();
        return;
      }
      // Otherwise treat # as regular text
      this.scanText();
      return;
    }

    // @ commands and numbered items
    if (char === "@") {
      this.scanAtCommand();
      return;
    }

    // Variables {{...}}
    if (char === "{" && this.peek(1) === "{") {
      this.scanVariable();
      return;
    }

    // Image ![alt](src)
    if (char === "!" && this.peek(1) === "[") {
      this.scanImage();
      return;
    }

    // Link [text](url)
    if (char === "[") {
      // Check for [[ (Cross ref)
      if (this.peek(1) === "[") {
        this.scanCrossRef();
        return;
      }

      // Check for [^ (Footnote) - must check BEFORE table row to handle [^1]: at line start
      // Footnote: [^label] where label is alphanumeric - NOT [^, ...] which is table row with rowspan
      if (this.peek(1) === "^" && this.lookaheadIsFootnote()) {
        this.scanFootnote();
        return;
      }

      // Check for Link [text](url) FIRST - lookahead for ](
      // This must come before table row check, otherwise [link](url) at start
      // of line gets parsed as a single-cell table row.
      const isLink = this.lookaheadIsLink();
      if (isLink) {
        this.scanLink();
        return;
      }

      // If at start of line content and not a link, try Table Row
      // This allows [cell1, cell2] and [^, ...] to be parsed as table row
      if (!this.lineHasContent) {
        this.scanTableRow();
        return;
      }

      // Otherwise, just text
      // We need to consume [ as text.
      this.pushToken({
        type: TokenType.TEXT,
        value: "[",
        line: this.line,
        column: this.column,
        indent: this.indentation.currentIndent(),
      });
      this.advance();
      this.lineHasContent = true;
      return;
    }

    // Cross-references [[...]]
    // Handled above inside `if (char === "[")`

    // Defined terms "Term"
    if (char === '"') {
      this.scanDefinedTerm();
      return;
    }

    // Bold/Italic
    if (char === "*") {
      this.scanEmphasis();
      return;
    }

    // Strikethrough (~~)
    if (char === "~" && this.peek(1) === "~") {
      this.scanStrikethrough();
      return;
    }

    // Inline Code (`)
    if (char === "`") {
      this.scanInlineCode();
      return;
    }

    // Blanks (underscores)
    if (char === "_" && this.peek(1) === "_" && this.peek(2) === "_") {
      this.scanBlank();
      return;
    }

    // Regular text
    this.scanText();
  }

  private handleIndentation(): void {
    let indent = 0;
    while (this.pos < this.input.length && (this.peek() === " " || this.peek() === "\t")) {
      indent += this.peek() === "\t" ? 2 : 1;
      this.advance();
    }

    // Skip empty lines
    if (this.peek() === "\n" || this.pos >= this.input.length) {
      return;
    }

    const currentIndent = this.indentation.currentIndent();

    if (indent > currentIndent) {
      this.indentation.pushIndent(indent);
      this.tokens.push(this.makeToken(TokenType.INDENT, "", indent));
    } else if (indent < currentIndent) {
      while (this.indentation.shouldDedent(indent)) {
        this.indentation.popIndent();
        this.tokens.push(this.makeToken(TokenType.DEDENT, "", indent));
      }
    }
  }

  private scanAtCommand(): void {
    const startPos = this.pos;
    const startCol = this.column;

    // Count @ symbols for level
    let level = 0;
    while (this.peek() === "@") {
      level++;
      this.advance();
    }

    // Check if it's a bullet (@-)
    if (this.peek() === "-") {
      this.advance();
      this.pushToken({
        type: TokenType.BULLET,
        value: "@".repeat(level) + "-",
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
        level,
      });
      this.lineHasContent = true;
      return;
    }

    // Check for keyword after @
    // Allow digits for modifiers like @h1..@h6 (read h1 as a single word)
    const wordStart = this.pos;
    while (this.pos < this.input.length && /[a-zA-Z0-9]/.test(this.peek())) {
      this.advance();
    }
    const word = this.input.slice(wordStart, this.pos).toLowerCase();

    // Is it a modifier?
    if (level === 1 && MODIFIERS.has(word)) {
      // Special handling for @style with key=value pairs
      if (word === "style") {
        // Check for inline form: @style(attrs)[content]
        if (this.peek() === "(") {
          this.scanInlineStyle(startCol);
          return;
        }

        // Block form: @style key=value key=value
        const attributes: Record<string, string> = {};

        while (true) {
          this.skipInlineWhitespace();
          if (this.peek() === "\n" || this.pos >= this.input.length) break;

          // Parse key
          const keyStart = this.pos;
          while (this.pos < this.input.length && /[a-zA-Z0-9_-]/.test(this.peek())) {
            this.advance();
          }
          const key = this.input.slice(keyStart, this.pos);
          if (!key) break;

          // Expect =
          if (this.peek() !== "=") break;
          this.advance();

          // Parse value (may be quoted or unquoted)
          let value: string;
          if (this.peek() === '"') {
            this.advance();
            const valStart = this.pos;
            while (this.pos < this.input.length && this.peek() !== '"' && this.peek() !== "\n") {
              this.advance();
            }
            value = this.input.slice(valStart, this.pos);
            if (this.peek() === '"') this.advance();
          } else {
            const valStart = this.pos;
            while (this.pos < this.input.length && !/[\s\n]/.test(this.peek())) {
              this.advance();
            }
            value = this.input.slice(valStart, this.pos);
          }

          if (key && value) {
            attributes[key] = value;
          }
        }

        this.pushToken({
          type: TokenType.MODIFIER,
          value: word,
          line: this.line,
          column: startCol,
          indent: this.indentation.currentIndent(),
          attributes,
        });
        this.lineHasContent = true;
        return;
      }

      let count: number | undefined;
      let length: string | undefined;

      const isLengthToken = (raw: string) => /^(?:\d+(?:\.\d+)?)(?:in|pt|cm|mm)$/i.test(raw);

      // Parameter forms:
      // - @indent:2
      // - @indent=36pt
      // - @indent 2   (only when the number is the only thing left on the line)
      if (this.peek() === ":") {
        this.advance();
        const start = this.pos;
        while (/[0-9]/.test(this.peek())) {
          this.advance();
        }
        const raw = this.input.slice(start, this.pos);
        if (raw) count = parseInt(raw, 10);
      } else if (this.peek() === "=") {
        // Equals form: allow length tokens and keep rest of line as content
        const savePos = this.pos;
        const saveCol = this.column;
        this.advance();
        const start = this.pos;
        while (this.pos < this.input.length && this.peek() !== " " && this.peek() !== "\t" && this.peek() !== "\n") {
          this.advance();
        }
        const raw = this.input.slice(start, this.pos);
        if (raw && isLengthToken(raw)) {
          length = raw;
        } else {
          // Roll back; treat '=' and following as content
          this.pos = savePos;
          this.column = saveCol;
        }
      } else {
        // Try space form safely
        const savePos = this.pos;
        const saveCol = this.column;
        this.skipInlineWhitespace();

        const start = this.pos;
        while (/[0-9.]/.test(this.peek())) {
          this.advance();
        }
        while (/[a-zA-Z]/.test(this.peek())) {
          this.advance();
        }
        const raw = this.input.slice(start, this.pos);

        // Only treat as a count if the rest of the line is whitespace then newline/EOF
        const afterDigitsPos = this.pos;
        while (this.peek() === " " || this.peek() === "\t") {
          this.advance();
        }
        if (raw && (this.peek() === "\n" || this.pos >= this.input.length)) {
          if (/^\d+$/.test(raw)) count = parseInt(raw, 10);
          else if (isLengthToken(raw)) length = raw;
        } else {
          // Roll back; it was content
          this.pos = savePos;
          this.column = saveCol;
        }
      }

      this.pushToken({
        type: TokenType.MODIFIER,
        value: word,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
        count,
        length,
      });
      this.lineHasContent = true;
      return;
    }

    // Check for legacy directives that are now errors
    if (level === 1 && LEGACY_DOCUMENT_DIRECTIVES.has(word)) {
      throw new Error(
        `@${word} is no longer supported. Use @document block instead. ` +
        `Example: @document\\n  ${word}: ...\\n` +
        `(line ${this.line}, column ${startCol})`
      );
    }

    // Is it a keyword?
    if (level === 1 && KEYWORDS.has(word)) {
      const tokenType = this.keywordToTokenType(word);
      this.pushToken({
        type: tokenType,
        value: word,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
        level: 1, // Add level for consistency, though not strictly needed for keywords
      });
      this.lineHasContent = true;
      return;
    }

    // Otherwise it might be a numbered item - but we need to validate
    // Backtrack and re-parse for style
    this.pos = startPos + level;
    this.column = startCol + level;

    const styleStart = this.pos;
    const style = this.parseNumberedStyle();
    const afterStyle = this.pos;

    // A numbered item MUST be followed by whitespace (space/tab) or newline/EOF
    // This prevents @someone from being parsed as a list item
    const nextChar = this.peek();
    const isValidTerminator = nextChar === " " || nextChar === "\t" || nextChar === "\n" || nextChar === "";

    if (!isValidTerminator) {
      // Not a valid numbered item - treat @... as plain text
      // We need to consume the @ symbols AND the following word-like characters
      // First, move past the @ symbols (level count)
      this.pos = startPos;
      this.column = startCol;
      
      // Consume the @ symbols
      for (let i = 0; i < level; i++) {
        this.advance();
      }
      
      // Consume word characters (letters, digits, underscores, dots, hyphens)
      // This captures things like @someone, @john.doe, @jane_smith
      while (this.pos < this.input.length && /[a-zA-Z0-9_.\-]/.test(this.peek())) {
        this.advance();
      }
      
      const text = this.input.slice(startPos, this.pos);
      this.pushToken({
        type: TokenType.TEXT,
        value: text,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
      return;
    }

    const marker = this.input.slice(startPos, this.pos);

    this.pushToken({
      type: TokenType.NUMBERED_ITEM,
      value: marker,
      line: this.line,
      column: startCol,
      indent: this.indentation.currentIndent(),
      level,
      style,
      marker,
    });
    this.lineHasContent = true;
  }

  private parseNumberedStyle(): string {
    const start = this.pos;

    // Decimal with possible sub-numbers: 1, 2.1, 2.1.3
    if (/[0-9]/.test(this.peek())) {
      while (/[0-9.]/.test(this.peek())) {
        this.advance();
      }
      return this.input.slice(start, this.pos);
    }

    // Roman numerals: i, ii, iii, iv, v, vi, vii, viii, ix, x
    if (/[ivxIVX]/.test(this.peek())) {
      while (/[ivxIVX]/.test(this.peek())) {
        this.advance();
      }
      const roman = this.input.slice(start, this.pos);
      // Validate it's actually roman
      if (/^[ivx]+$/i.test(roman)) {
        return roman;
      }
      // Backtrack if not valid roman
      this.pos = start;
      this.column -= roman.length;
    }

    // Alpha: a, b, c or A, B, C
    if (/[a-zA-Z]/.test(this.peek())) {
      const letter = this.peek();
      this.advance();
      return letter;
    }

    // Auto (no explicit style)
    return "";
  }

  private scanHeader(): void {
    const startCol = this.column;
    let level = 0;

    while (this.peek() === "#") {
      level++;
      this.advance();
    }

    this.skipInlineWhitespace();

    const textStart = this.pos;
    while (this.pos < this.input.length && this.peek() !== "\n") {
      this.advance();
    }

    const text = this.input.slice(textStart, this.pos).trim();

    this.pushToken({
      type: TokenType.HEADER,
      value: text,
      line: this.line,
      column: startCol,
      indent: this.indentation.currentIndent(),
      level,
    });
    this.lineHasContent = true;
  }

  private scanVariable(): void {
    const startCol = this.column;
    this.advance(); // {
    this.advance(); // {

    const nameStart = this.pos;
    while (this.pos < this.input.length && !(this.peek() === "}" && this.peek(1) === "}")) {
      this.advance();
    }

    const name = this.input.slice(nameStart, this.pos);
    this.advance(); // }
    this.advance(); // }

    this.pushToken({
      type: TokenType.VARIABLE,
      value: name,
      line: this.line,
      column: startCol,
      indent: this.indentation.currentIndent(),
    });
    this.lineHasContent = true;
  }

  /**
   * Check if [^ is a footnote (vs table row with rowspan marker).
   * Footnote: [^label] or [^label]: where label is alphanumeric
   * Table row: [^, ...] where ^ is immediately followed by , or ]
   */
  private lookaheadIsFootnote(): boolean {
    // We're at '[', peek(1) is '^'
    // Check what comes after '^' (at pos + 2)
    const afterCaret = this.input[this.pos + 2];
    
    // If immediately followed by , or ] or space, it's a table row marker
    if (afterCaret === "," || afterCaret === "]" || afterCaret === " ") {
      return false;
    }
    
    // Otherwise assume it's a footnote label (alphanumeric)
    return true;
  }

  private lookaheadIsLink(): boolean {
    let i = this.pos + 1;
    // Scan for ]
    while (i < this.input.length && this.input[i] !== "]") {
      if (this.input[i] === "\n") return false; // Links can't span lines (usually)
      i++;
    }
    
    if (i >= this.input.length) return false; // No closing ]
    
    // Check for ( after ]
    if (this.input[i + 1] === "(") {
      return true;
    }
    
    return false;
  }

  private scanFootnote(): void {
    const startCol = this.column;
    this.advance(); // [
    this.advance(); // ^

    const labelStart = this.pos;
    while (this.pos < this.input.length && this.peek() !== "]") {
      this.advance();
    }
    const label = this.input.slice(labelStart, this.pos);
    this.advance(); // ]

    // Check for definition syntax: [^label]:
    if (this.peek() === ":") {
      this.advance(); // :
      
      // Optional space
      if (this.peek() === " ") this.advance();

      this.pushToken({
        type: TokenType.FOOTNOTE_DEF,
        value: label,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    } else {
      // Reference
      this.pushToken({
        type: TokenType.FOOTNOTE_REF,
        value: label,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    }
  }

  private scanImage(): void {
    const startCol = this.column;
    this.advance(); // !
    this.advance(); // [

    const altStart = this.pos;
    while (this.pos < this.input.length && this.peek() !== "]") {
      this.advance();
    }
    const alt = this.input.slice(altStart, this.pos);
    this.advance(); // ]

    if (this.peek() === "(") {
      this.advance(); // (
      const srcStart = this.pos;
      while (this.pos < this.input.length && this.peek() !== ")") {
        this.advance();
      }
      const src = this.input.slice(srcStart, this.pos);
      this.advance(); // )

      this.pushToken({
        type: TokenType.IMAGE,
        value: `${alt}|${src}`,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    } else {
      // Not an image, treat as text
      this.pushToken({
        type: TokenType.TEXT,
        value: `![${alt}]`,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    }
  }

  private scanLink(): void {
    const startCol = this.column;
    this.advance(); // [

    const textStart = this.pos;
    while (this.pos < this.input.length && this.peek() !== "]") {
      this.advance();
    }
    const text = this.input.slice(textStart, this.pos);
    this.advance(); // ]

    if (this.peek() === "(") {
      this.advance(); // (
      const urlStart = this.pos;
      while (this.pos < this.input.length && this.peek() !== ")") {
        this.advance();
      }
      const url = this.input.slice(urlStart, this.pos);
      this.advance(); // )

      this.pushToken({
        type: TokenType.LINK,
        value: `${text}|${url}`,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    } else {
      // Not a link, treat as text
      // Backtrack? Or just emit text tokens?
      // For simplicity, emit as TEXT for now, but this is tricky without backtracking.
      // Actually, we consumed [text]. If no (, it's just text.
      // But we already advanced past ].
      // Let's just emit TEXT token for "[text]"
      this.pushToken({
        type: TokenType.TEXT,
        value: `[${text}]`,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    }
  }

  private scanCrossRef(): void {
    const startCol = this.column;
    this.advance(); // [
    this.advance(); // [

    const refStart = this.pos;
    while (this.pos < this.input.length && !(this.peek() === "]" && this.peek(1) === "]")) {
      this.advance();
    }

    const ref = this.input.slice(refStart, this.pos);
    this.advance(); // ]
    this.advance(); // ]

    this.pushToken({
      type: TokenType.CROSS_REF,
      value: ref,
      line: this.line,
      column: startCol,
      indent: this.indentation.currentIndent(),
    });
    this.lineHasContent = true;
  }

  private scanDefinedTerm(): void {
    const startCol = this.column;
    this.advance(); // opening "

    const termStart = this.pos;
    while (this.pos < this.input.length && this.peek() !== '"') {
      this.advance();
    }

    const term = this.input.slice(termStart, this.pos);
    this.advance(); // closing "

    this.pushToken({
      type: TokenType.DEFINED_TERM,
      value: term,
      line: this.line,
      column: startCol,
      indent: this.indentation.currentIndent(),
    });
    this.lineHasContent = true;
  }

  private scanEmphasis(): void {
    const startCol = this.column;
    let stars = 0;

    while (this.peek() === "*") {
      stars++;
      this.advance();
    }

    // If followed by whitespace, it's not an emphasis start (treat as text)
    // This fixes ambiguity with math multiplication like "5 * 10"
    if (this.peek() === " " || this.peek() === "\t") {
      this.pushToken({
        type: TokenType.TEXT,
        value: "*".repeat(stars),
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
      return;
    }

    const textStart = this.pos;
    let textEnd = this.pos;
    let found = false;

    // Find closing stars - only within the same line
    while (this.pos < this.input.length && this.peek() !== "\n") {
      if (this.peek() === "*") {
        // If preceded by whitespace, it's not an emphasis end
        if (this.input[this.pos - 1] === " " || this.input[this.pos - 1] === "\t") {
          this.advance();
          continue;
        }

        let closingStars = 0;
        const potentialEnd = this.pos;
        while (this.peek() === "*" && this.pos < this.input.length) {
          closingStars++;
          this.advance();
        }
        if (closingStars === stars) {
          textEnd = potentialEnd;
          found = true;
          break;
        }
        // If we didn't find a match, continue - stars already consumed
      } else {
        this.advance();
      }
    }

    // If we didn't find closing stars, treat the opening stars as text
    if (!found) {
      this.pushToken({
        type: TokenType.TEXT,
        value: "*".repeat(stars) + this.input.slice(textStart, this.pos),
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
      return;
    }

    const text = this.input.slice(textStart, textEnd);
    const type =
      stars >= 3 ? TokenType.BOLD_ITALIC : stars === 2 ? TokenType.BOLD : TokenType.ITALIC;

    this.pushToken({
      type,
      value: text,
      line: this.line,
      column: startCol,
      indent: this.indentation.currentIndent(),
    });
    this.lineHasContent = true;
  }

  private scanStrikethrough(): void {
    const startCol = this.column;
    this.advance(); // ~
    this.advance(); // ~

    const textStart = this.pos;
    while (this.pos < this.input.length) {
      if (this.peek() === "~" && this.peek(1) === "~") {
        break;
      }
      if (this.peek() === "\n") {
        // Strikethrough cannot span lines (standard markdown)
        // Treat as text
        // Backtrack? Or just emit text.
        // For simplicity, let's assume it fails and emit text tokens?
        // Actually, let's just stop and let the parser handle it or fail.
        // Better: treat as text if no closing found on same line.
        break;
      }
      this.advance();
    }

    if (this.peek() === "~" && this.peek(1) === "~") {
      const text = this.input.slice(textStart, this.pos);
      this.advance(); // ~
      this.advance(); // ~
      
      this.pushToken({
        type: TokenType.STRIKETHROUGH,
        value: text,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    } else {
      // Failed to find closing ~~, treat as text
      // We consumed the opening ~~.
      // This is tricky without backtracking.
      // Let's just emit TEXT for the whole thing including opening ~~
      // But we already advanced past them.
      // We can emit a TEXT token for "~~" and then reset pos to textStart?
      // No, we can just emit TEXT for "~~" + textSoFar
      const textSoFar = this.input.slice(textStart, this.pos);
      this.pushToken({
        type: TokenType.TEXT,
        value: "~~" + textSoFar,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    }
  }

  private scanInlineCode(): void {
    const startCol = this.column;
    this.advance(); // `

    const textStart = this.pos;
    while (this.pos < this.input.length) {
      if (this.peek() === "`") {
        break;
      }
      if (this.peek() === "\n") {
        // Inline code usually doesn't span lines in simple parsers, 
        // though GFM allows it. Let's restrict to single line for now.
        break;
      }
      this.advance();
    }

    if (this.peek() === "`") {
      const text = this.input.slice(textStart, this.pos);
      this.advance(); // `
      
      this.pushToken({
        type: TokenType.INLINE_CODE,
        value: text,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    } else {
      // Failed to find closing `, treat as text
      const textSoFar = this.input.slice(textStart, this.pos);
      this.pushToken({
        type: TokenType.TEXT,
        value: "`" + textSoFar,
        line: this.line,
        column: startCol,
        indent: this.indentation.currentIndent(),
      });
      this.lineHasContent = true;
    }
  }

  private scanBlank(): void {
    const startCol = this.column;
    let count = 0;

    while (this.peek() === "_") {
      count++;
      this.advance();
    }

    this.pushToken({
      type: TokenType.BLANK,
      value: "_".repeat(count),
      line: this.line,
      column: startCol,
      indent: this.indentation.currentIndent(),
    });
    this.lineHasContent = true;
  }

  private scanTableRow(): void {
    const startCol = this.column;
    this.advance(); // [

    const content: { value: string; quoted: boolean }[] = [];
    let current = "";
    let inQuotes = false;
    let cellQuoted = false;

    while (this.pos < this.input.length && this.peek() !== "]") {
      const char = this.peek();

      if (char === '"') {
        if (!inQuotes) {
          // Starting a quoted section
          inQuotes = true;
          cellQuoted = true;
        } else {
          // Ending a quoted section
          inQuotes = false;
        }
        this.advance();
      } else if (char === "," && !inQuotes) {
        content.push({ value: current.trim(), quoted: cellQuoted });
        current = "";
        cellQuoted = false;
        this.advance();
      } else {
        current += char;
        this.advance();
      }
    }

    content.push({ value: current.trim(), quoted: cellQuoted });
    this.advance(); // ]

    this.pushToken({
      type: TokenType.TABLE_ROW,
      value: JSON.stringify(content),
      line: this.line,
      column: startCol,
      indent: this.indentation.currentIndent(),
    });
    this.lineHasContent = true;
  }

  private scanText(): void {
    const startCol = this.column;
    const textStart = this.pos;

    while (
      this.pos < this.input.length &&
      !this.isSpecialChar(this.peek()) &&
      this.peek() !== "\n"
    ) {
      this.advance();
    }

    // If we didn't advance at all, we're stuck on a special character that
    // didn't match its expected pattern (e.g., single underscore, single brace).
    // Consume it as text to avoid infinite loop.
    if (this.pos === textStart && this.pos < this.input.length && this.peek() !== "\n") {
      this.advance();
    }

    const text = this.input.slice(textStart, this.pos);
    if (text) {
      // Check for hard break (2+ spaces at end)
      // Only if followed by a newline (which is why we stopped here usually)
      if (text.endsWith("  ") && this.peek() === "\n") {
        const trimmed = text.trimEnd();
        if (trimmed) {
          this.pushToken({
            type: TokenType.TEXT,
            value: trimmed,
            line: this.line,
            column: startCol,
            indent: this.indentation.currentIndent(),
          });
        }
        this.pushToken({
          type: TokenType.HARD_BREAK,
          value: "  ",
          line: this.line,
          column: startCol + trimmed.length,
          indent: this.indentation.currentIndent(),
        });
      } else {
        this.pushToken({
          type: TokenType.TEXT,
          value: text,
          line: this.line,
          column: startCol,
          indent: this.indentation.currentIndent(),
        });
      }
      this.lineHasContent = true;
    }
  }

  /**
   * Scan inline @style(attrs)[content] syntax.
   * Called after we've recognized "@style" and seen "(" as next character.
   */
  private scanInlineStyle(startCol: number): void {
    // Consume (
    this.advance();

    // Parse attributes
    const attributes = this.parseInlineStyleAttributes();

    // Expect )
    if (this.peek() !== ")") {
      throw new Error(
        `Expected ')' after inline style attributes at line ${this.line}, column ${this.column}`
      );
    }
    this.advance();

    // Expect [
    if (this.peek() !== "[") {
      throw new Error(
        `Expected '[' after inline style attributes at line ${this.line}, column ${this.column}`
      );
    }
    this.advance();

    // Scan content with balanced bracket counting
    const contentStart = this.pos;
    let depth = 1;
    while (depth > 0 && this.pos < this.input.length) {
      const char = this.peek();
      if (char === "\n") {
        throw new Error(
          `Inline style cannot span lines at line ${this.line}, column ${this.column}`
        );
      }
      if (char === "[") depth++;
      else if (char === "]") depth--;
      if (depth > 0) this.advance();
    }

    const rawContent = this.input.slice(contentStart, this.pos);

    // Consume closing ]
    if (this.peek() !== "]") {
      throw new Error(
        `Expected ']' to close inline style at line ${this.line}, column ${this.column}`
      );
    }
    this.advance();

    this.pushToken({
      type: TokenType.INLINE_STYLE,
      value: "@style",
      line: this.line,
      column: startCol,
      indent: this.indentation.currentIndent(),
      attributes,
      rawContent,
    });
    this.lineHasContent = true;
  }

  /**
   * Parse attributes inside parentheses for inline @style.
   * Format: key=value or key="quoted value", space-separated.
   */
  private parseInlineStyleAttributes(): Record<string, string> {
    const attributes: Record<string, string> = {};

    while (this.pos < this.input.length && this.peek() !== ")") {
      // Skip whitespace
      while (this.peek() === " " || this.peek() === "\t") {
        this.advance();
      }

      if (this.peek() === ")") break;

      // Parse key
      const keyStart = this.pos;
      while (this.pos < this.input.length && /[a-zA-Z0-9_-]/.test(this.peek())) {
        this.advance();
      }
      const key = this.input.slice(keyStart, this.pos);
      if (!key) break;

      // Expect =
      if (this.peek() !== "=") {
        throw new Error(
          `Expected '=' after attribute key '${key}' at line ${this.line}, column ${this.column}`
        );
      }
      this.advance();

      // Parse value (may be quoted or unquoted)
      let value: string;
      if (this.peek() === '"') {
        this.advance();
        const valStart = this.pos;
        while (this.pos < this.input.length && this.peek() !== '"' && this.peek() !== "\n") {
          this.advance();
        }
        value = this.input.slice(valStart, this.pos);
        if (this.peek() === '"') {
          this.advance();
        } else {
          throw new Error(
            `Unclosed quoted value for attribute '${key}' at line ${this.line}, column ${this.column}`
          );
        }
      } else {
        const valStart = this.pos;
        while (this.pos < this.input.length && !/[\s\n)]/.test(this.peek())) {
          this.advance();
        }
        value = this.input.slice(valStart, this.pos);
      }

      if (key && value) {
        attributes[key] = value;
      }
    }

    return attributes;
  }

  private scanLineComment(): void {
    this.advance(); // /
    this.advance(); // /

    const textStart = this.pos;
    while (this.pos < this.input.length && this.peek() !== "\n") {
      this.advance();
    }

    this.pushToken({
      type: TokenType.COMMENT,
      value: this.input.slice(textStart, this.pos).trim(),
      line: this.line,
      column: 1,
      indent: 0,
    });
  }

  private scanBlockComment(): void {
    const startLine = this.line;
    this.advance(); // /
    this.advance(); // *

    const textStart = this.pos;
    while (this.pos < this.input.length && !(this.peek() === "*" && this.peek(1) === "/")) {
      if (this.peek() === "\n") {
        this.line++;
        this.column = 0;
      }
      this.advance();
    }

    const text = this.input.slice(textStart, this.pos).trim();
    this.advance(); // *
    this.advance(); // /

    this.pushToken({
      type: TokenType.COMMENT,
      value: text,
      line: startLine,
      column: 1,
      indent: 0,
    });
  }

  private isSpecialChar(char: string): boolean {
    return ["@", "{", "[", '"', "*", "_", "/", "#", "~", "`"].includes(char);
  }

  private keywordToTokenType(keyword: string): TokenType {
    switch (keyword) {
      case "document":
        return TokenType.DOCUMENT;
      case "meta":
        return TokenType.META;
      case "import":
        return TokenType.IMPORT;
      case "define":
        return TokenType.DEFINE;
      case "use":
        return TokenType.USE;
      case "table":
        return TokenType.TABLE;
      case "pagebreak":
        return TokenType.PAGEBREAK;
      case "break":
        return TokenType.COLUMN_BREAK;
      case "header":
        return TokenType.DOC_HEADER;
      case "footer":
        return TokenType.DOC_FOOTER;
      case "firstpage":
        return TokenType.DOC_FIRSTPAGE;
      case "evenpage":
        return TokenType.DOC_EVENPAGE;
      case "columns":
        return TokenType.DOC_COLUMNS;
      case "anchor":
        return TokenType.DOC_ANCHOR;
      case "if":
        return TokenType.IF;
      case "elseif":
        return TokenType.ELSEIF;
      case "else":
        return TokenType.ELSE;
      case "end":
        return TokenType.END;
      case "repeat":
        return TokenType.REPEAT;
      case "foreach":
        return TokenType.FOREACH;
      case "set":
        return TokenType.SET;
      case "todo":
        return TokenType.TODO;
      default:
        return TokenType.TEXT;
    }
  }

  private peek(offset: number = 0): string {
    return this.input[this.pos + offset] ?? "";
  }

  private advance(): void {
    this.pos++;
    this.column++;
  }

  private skipInlineWhitespace(): void {
    while (this.pos < this.input.length && (this.peek() === " " || this.peek() === "\t")) {
      this.advance();
    }
  }

  /**
   * Compute end position from start position and value.
   * For multi-line values, tracks newlines. For single-line, adds value length.
   */
  private computeEndPosition(startLine: number, startColumn: number, value: string): { endLine: number; endColumn: number } {
    const lines = value.split("\n");
    if (lines.length > 1) {
      return {
        endLine: startLine + lines.length - 1,
        endColumn: (lines[lines.length - 1]?.length ?? 0) + 1,
      };
    }
    return {
      endLine: startLine,
      endColumn: startColumn + value.length,
    };
  }

  /**
   * Push a token with automatic end position computation.
   * Takes a partial token (without endLine/endColumn) and adds them.
   */
  private pushToken(partial: Omit<Token, "endLine" | "endColumn">): void {
    const { endLine, endColumn } = this.computeEndPosition(partial.line, partial.column, partial.value);
    this.tokens.push({
      ...partial,
      endLine,
      endColumn,
    });
  }

  private makeToken(type: TokenType, value: string, indent?: number): Token {
    // Compute end position based on value content
    let endLine = this.line;
    let endColumn = this.column;

    // Count newlines in value to find actual end position
    const lines = value.split("\n");
    if (lines.length > 1) {
      endLine = this.line + lines.length - 1;
      endColumn = (lines[lines.length - 1]?.length ?? 0) + 1;
    } else {
      endColumn = this.column + value.length;
    }

    return {
      type,
      value,
      line: this.line,
      column: this.column,
      endLine,
      endColumn,
      indent: indent ?? (this.indentation.currentIndent()),
    };
  }
}
