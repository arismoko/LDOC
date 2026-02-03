// Lexer for Legal Document DSL (.ldoc)

export enum TokenType {
  // Structure
  DOCUMENT = "DOCUMENT",
  META = "META",
  IMPORT = "IMPORT",
  DEFINE = "DEFINE",
  USE = "USE",

  // Control flow
  IF = "IF",
  ELSE = "ELSE",
  END = "END",
  REPEAT = "REPEAT",
  FOREACH = "FOREACH",

  // Numbered items: @, @@, @@@, @@@@
  NUMBERED_ITEM = "NUMBERED_ITEM",

  // Modifiers
  MODIFIER = "MODIFIER",

  // Bullets
  BULLET = "BULLET",

  // Content
  HEADER = "HEADER",
  TEXT = "TEXT",
  VARIABLE = "VARIABLE",
  DEFINED_TERM = "DEFINED_TERM",
  CROSS_REF = "CROSS_REF",
  BLANK = "BLANK",

  // Formatting
  BOLD = "BOLD",
  ITALIC = "ITALIC",
  BOLD_ITALIC = "BOLD_ITALIC",

  // Table
  TABLE = "TABLE",
  TABLE_ROW = "TABLE_ROW",

  // Numbering scheme
  NUMBERING = "NUMBERING",

  // Control
  PAGEBREAK = "PAGEBREAK",
  DOC_HEADER = "DOC_HEADER",
  DOC_FOOTER = "DOC_FOOTER",
  DOC_FIRSTPAGE = "DOC_FIRSTPAGE",
  DOC_EVENPAGE = "DOC_EVENPAGE",
  DOC_MARGINS = "DOC_MARGINS",
  DOC_SPACING = "DOC_SPACING",
  DOC_LANDSCAPE = "DOC_LANDSCAPE",
  DOC_COLUMNS = "DOC_COLUMNS",
  DOC_ANCHOR = "DOC_ANCHOR",
  END_BLOCK = "END_BLOCK",
  COMMENT = "COMMENT",
  TODO = "TODO",

  // Structure
  INDENT = "INDENT",
  DEDENT = "DEDENT",
  NEWLINE = "NEWLINE",
  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  indent: number;
  // For modifiers
  count?: number; // e.g. @indent:2
  // For numbered items
  level?: number; // Number of @ symbols
  style?: string; // '1', 'a', 'i', 'A', 'I', '1.1', etc.
  marker?: string; // The full marker like '@@a'
}

export interface LexerState {
  pos: number;
  line: number;
  column: number;
  indentStack: number[];
}

const MODIFIERS = new Set([
  "center",
  "right",
  "indent",
  "outdent",
  "box",
  "bold",
  "italic",
  "small",
  "caps",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const KEYWORDS = new Set([
  "document",
  "meta",
  "import",
  "define",
  "use",
  "table",
  "pagebreak",
  "todo",
  "header",
  "footer",
  "firstpage",
  "evenpage",
  "margins",
  "spacing",
  "landscape",
  "columns",
  "anchor",
  "numbering",
  "if",
  "else",
  "end",
  "repeat",
  "foreach",
  "params",
  "template",
]);

export class Lexer {
  private input: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private indentStack: number[] = [0];
  private tokens: Token[] = [];
  private pendingDedents: number = 0;
  private pendingDedentTargetIndent: number | null = null;

  private debug: boolean = false;
  private maxIterations: number = 100000;

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
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
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

    // Skip whitespace (not at start of line)
    if (this.column > 1) {
      this.skipInlineWhitespace();
    }

    if (this.pos >= this.input.length) return;

    const char = this.peek();

    // Explicit block terminator (closes innermost open block)
    // Must be a standalone line: optional leading whitespace + `@;` + optional trailing whitespace
    if (char === "@" && this.peek(1) === ";") {
      const startCol = this.column;
      this.advance(); // @
      this.advance(); // ;

      // Only allow trailing whitespace before newline/EOF
      while (this.pos < this.input.length && (this.peek() === " " || this.peek() === "\t")) {
        this.advance();
      }

      if (this.pos < this.input.length && this.peek() !== "\n") {
        const context = this.input.slice(Math.max(0, this.pos - 10), this.pos + 20);
        throw new Error(
          `Invalid @; terminator: unexpected characters before newline at line ${this.line}, column ${startCol}. ` +
            `Context: "${context.replace(/\n/g, "\\n")}"`
        );
      }

      this.tokens.push({
        type: TokenType.END_BLOCK,
        value: "@;",
        line: this.line,
        column: startCol,
        indent: this.indentStack[this.indentStack.length - 1] ?? 0,
      });

      // Flush any deferred dedents for this terminator line
      if (this.pendingDedents > 0 && this.pendingDedentTargetIndent !== null) {
        const target = this.pendingDedentTargetIndent;
        for (let i = 0; i < this.pendingDedents; i++) {
          if (this.indentStack.length > 1) {
            this.indentStack.pop();
          }
          this.tokens.push(this.makeToken(TokenType.DEDENT, "", target));
        }
        this.pendingDedents = 0;
        this.pendingDedentTargetIndent = null;
      }
      return;
    }

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
      return;
    }

    // Headers (markdown style) - allow after modifiers too
    if (char === "#") {
      const lastToken = this.tokens[this.tokens.length - 1];
      if (this.column === 1 || lastToken?.type === TokenType.INDENT || lastToken?.type === TokenType.MODIFIER) {
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

    // Cross-references [[...]]
    if (char === "[" && this.peek(1) === "[") {
      this.scanCrossRef();
      return;
    }

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

    // Blanks (underscores)
    if (char === "_" && this.peek(1) === "_" && this.peek(2) === "_") {
      this.scanBlank();
      return;
    }

    // Table row [...]
    if (char === "[") {
      this.scanTableRow();
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

    const isEndBlockLine = this.peek() === "@" && this.peek(1) === ";";

    // Skip empty lines
    if (this.peek() === "\n" || this.pos >= this.input.length) {
      return;
    }

    const currentIndent = this.indentStack[this.indentStack.length - 1] ?? 0;

    if (indent > currentIndent) {
      this.indentStack.push(indent);
      this.tokens.push(this.makeToken(TokenType.INDENT, "", indent));
    } else if (indent < currentIndent) {
      // If this line is an explicit end-block terminator, emit the END_BLOCK token
      // before any DEDENT tokens. We do that by deferring DEDENT emission until after
      // scanToken() consumes the @;.
      if (isEndBlockLine) {
        this.pendingDedentTargetIndent = indent;
        // Count how many dedents will be needed.
        let count = 0;
        for (let i = this.indentStack.length - 1; i > 0; i--) {
          if ((this.indentStack[i] ?? 0) > indent) count++;
          else break;
        }
        this.pendingDedents = count;
        return;
      }

      while (this.indentStack.length > 1 && (this.indentStack[this.indentStack.length - 1] ?? 0) > indent) {
        this.indentStack.pop();
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
      this.tokens.push({
        type: TokenType.BULLET,
        value: "@".repeat(level) + "-",
        line: this.line,
        column: startCol,
        indent: this.indentStack[this.indentStack.length - 1] ?? 0,
        level,
      });
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
      let count: number | undefined;

      // Parameter forms:
      // - @indent:2
      // - @indent 2   (only when the number is the only thing left on the line)
      if (this.peek() === ":") {
        this.advance();
        const start = this.pos;
        while (/[0-9]/.test(this.peek())) {
          this.advance();
        }
        const raw = this.input.slice(start, this.pos);
        if (raw) count = parseInt(raw, 10);
      } else {
        // Try space form safely
        const savePos = this.pos;
        const saveCol = this.column;
        this.skipInlineWhitespace();

        const start = this.pos;
        while (/[0-9]/.test(this.peek())) {
          this.advance();
        }
        const raw = this.input.slice(start, this.pos);

        // Only treat as a count if the rest of the line is whitespace then newline/EOF
        const afterDigitsPos = this.pos;
        while (this.peek() === " " || this.peek() === "\t") {
          this.advance();
        }
        if (raw && (this.peek() === "\n" || this.pos >= this.input.length)) {
          count = parseInt(raw, 10);
        } else {
          // Roll back; it was content
          this.pos = savePos;
          this.column = saveCol;
        }
      }

      this.tokens.push({
        type: TokenType.MODIFIER,
        value: word,
        line: this.line,
        column: startCol,
        indent: this.indentStack[this.indentStack.length - 1] ?? 0,
        count,
      });
      return;
    }

    // Is it a keyword?
    if (level === 1 && KEYWORDS.has(word)) {
      const tokenType = this.keywordToTokenType(word);
      this.tokens.push({
        type: tokenType,
        value: word,
        line: this.line,
        column: startCol,
        indent: this.indentStack[this.indentStack.length - 1] ?? 0,
      });
      return;
    }

    // Otherwise it's a numbered item
    // Backtrack and re-parse for style
    this.pos = startPos + level;
    this.column = startCol + level;

    const style = this.parseNumberedStyle();
    const marker = this.input.slice(startPos, this.pos);

    this.tokens.push({
      type: TokenType.NUMBERED_ITEM,
      value: marker,
      line: this.line,
      column: startCol,
      indent: this.indentStack[this.indentStack.length - 1] ?? 0,
      level,
      style,
      marker,
    });
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

    this.tokens.push({
      type: TokenType.HEADER,
      value: text,
      line: this.line,
      column: startCol,
      indent: this.indentStack[this.indentStack.length - 1] ?? 0,
      level,
    });
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

    this.tokens.push({
      type: TokenType.VARIABLE,
      value: name,
      line: this.line,
      column: startCol,
      indent: this.indentStack[this.indentStack.length - 1] ?? 0,
    });
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

    this.tokens.push({
      type: TokenType.CROSS_REF,
      value: ref,
      line: this.line,
      column: startCol,
      indent: this.indentStack[this.indentStack.length - 1] ?? 0,
    });
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

    this.tokens.push({
      type: TokenType.DEFINED_TERM,
      value: term,
      line: this.line,
      column: startCol,
      indent: this.indentStack[this.indentStack.length - 1] ?? 0,
    });
  }

  private scanEmphasis(): void {
    const startCol = this.column;
    let stars = 0;

    while (this.peek() === "*") {
      stars++;
      this.advance();
    }

    const textStart = this.pos;
    let textEnd = this.pos;
    let found = false;

    // Find closing stars - only within the same line
    while (this.pos < this.input.length && this.peek() !== "\n") {
      if (this.peek() === "*") {
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
      this.tokens.push({
        type: TokenType.TEXT,
        value: "*".repeat(stars) + this.input.slice(textStart, this.pos),
        line: this.line,
        column: startCol,
        indent: this.indentStack[this.indentStack.length - 1] ?? 0,
      });
      return;
    }

    const text = this.input.slice(textStart, textEnd);
    const type =
      stars >= 3 ? TokenType.BOLD_ITALIC : stars === 2 ? TokenType.BOLD : TokenType.ITALIC;

    this.tokens.push({
      type,
      value: text,
      line: this.line,
      column: startCol,
      indent: this.indentStack[this.indentStack.length - 1] ?? 0,
    });
  }

  private scanBlank(): void {
    const startCol = this.column;
    let count = 0;

    while (this.peek() === "_") {
      count++;
      this.advance();
    }

    this.tokens.push({
      type: TokenType.BLANK,
      value: "_".repeat(count),
      line: this.line,
      column: startCol,
      indent: this.indentStack[this.indentStack.length - 1] ?? 0,
    });
  }

  private scanTableRow(): void {
    const startCol = this.column;
    this.advance(); // [

    const content: string[] = [];
    let current = "";
    let inQuotes = false;

    while (this.pos < this.input.length && this.peek() !== "]") {
      const char = this.peek();

      if (char === '"') {
        inQuotes = !inQuotes;
        this.advance();
      } else if (char === "," && !inQuotes) {
        content.push(current.trim());
        current = "";
        this.advance();
      } else {
        current += char;
        this.advance();
      }
    }

    content.push(current.trim());
    this.advance(); // ]

    this.tokens.push({
      type: TokenType.TABLE_ROW,
      value: JSON.stringify(content),
      line: this.line,
      column: startCol,
      indent: this.indentStack[this.indentStack.length - 1] ?? 0,
    });
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
      this.tokens.push({
        type: TokenType.TEXT,
        value: text,
        line: this.line,
        column: startCol,
        indent: this.indentStack[this.indentStack.length - 1] ?? 0,
      });
    }
  }

  private scanLineComment(): void {
    this.advance(); // /
    this.advance(); // /

    const textStart = this.pos;
    while (this.pos < this.input.length && this.peek() !== "\n") {
      this.advance();
    }

    this.tokens.push({
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

    this.tokens.push({
      type: TokenType.COMMENT,
      value: text,
      line: startLine,
      column: 1,
      indent: 0,
    });
  }

  private isSpecialChar(char: string): boolean {
    return ["@", "{", "[", '"', "*", "_", "/", "#"].includes(char);
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
      case "header":
        return TokenType.DOC_HEADER;
      case "footer":
        return TokenType.DOC_FOOTER;
      case "firstpage":
        return TokenType.DOC_FIRSTPAGE;
      case "evenpage":
        return TokenType.DOC_EVENPAGE;
      case "margins":
        return TokenType.DOC_MARGINS;
      case "spacing":
        return TokenType.DOC_SPACING;
      case "landscape":
        return TokenType.DOC_LANDSCAPE;
      case "columns":
        return TokenType.DOC_COLUMNS;
      case "anchor":
        return TokenType.DOC_ANCHOR;
      case "if":
        return TokenType.IF;
      case "else":
        return TokenType.ELSE;
      case "end":
        return TokenType.END;
      case "repeat":
        return TokenType.REPEAT;
      case "foreach":
        return TokenType.FOREACH;
      case "todo":
        return TokenType.TODO;
      case "numbering":
        return TokenType.NUMBERING;
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

  private makeToken(type: TokenType, value: string, indent?: number): Token {
    return {
      type,
      value,
      line: this.line,
      column: this.column,
      indent: indent ?? (this.indentStack[this.indentStack.length - 1] ?? 0),
    };
  }
}
