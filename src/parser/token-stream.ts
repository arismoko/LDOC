import { TokenType, type Token } from "./lexer";

export class TokenStream {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token {
    return this.tokens[this.pos] || { type: TokenType.EOF, value: "", line: 0, column: 0, endLine: 0, endColumn: 0, indent: 0 };
  }

  advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.tokens[this.pos - 1]!;
  }

  check(type: TokenType): boolean {
    if (this.isAtEnd()) return type === TokenType.EOF;
    return this.peek().type === type;
  }

  consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    const token = this.peek();
    throw new Error(`${message} (line ${token.line}, column ${token.column})`);
  }

  isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  getPosition(): number {
    return this.pos;
  }

  setPosition(pos: number): void {
    this.pos = pos;
  }

  getTokenAt(index: number): Token | undefined {
    return this.tokens[index];
  }

  skipNewlines(): void {
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }
  }

  skipWhitespaceTokens(): void {
    while (this.check(TokenType.NEWLINE) || this.check(TokenType.INDENT) || this.check(TokenType.DEDENT)) {
      this.advance();
    }
  }

  consumeNewlines(): number {
    let count = 0;
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
      count++;
    }
    return count;
  }

  lookaheadNewlinesThenIndent(): { newlines: number; indentAfter: boolean } {
    let i = this.pos;
    let n = 0;
    while (this.tokens[i]?.type === TokenType.NEWLINE) {
      i++;
      n++;
    }
    return { newlines: n, indentAfter: this.tokens[i]?.type === TokenType.INDENT };
  }

  makeSpaceToken(line: number, column: number): Token {
    return { type: TokenType.TEXT, value: " ", line, column, endLine: line, endColumn: column + 1, indent: 0 };
  }

  softWrapIntoTokens(target: Token[], newlineToken: Token): void {
    // Avoid accumulating multiple spaces
    const last = target[target.length - 1];
    if (last?.type === TokenType.TEXT && last.value.endsWith(" ")) return;
    target.push(this.makeSpaceToken(newlineToken.line, newlineToken.column));
  }

  consumeSoftWrappedLine(target: Token[]): void {
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
    this.softWrapIntoTokens(target, newlineTok);
    while (
      !this.isAtEnd() &&
      !this.check(TokenType.NEWLINE) &&
      !this.check(TokenType.EOF) &&
      !this.check(TokenType.INDENT) &&
      !this.check(TokenType.DEDENT)
    ) {
      // Stop if we hit a block start mid-line (shouldn't happen often, but safe)
      if (this.isBlockStart(this.peek().type)) break;
      target.push(this.advance());
    }
  }

  isBlockStart(type: TokenType): boolean {
    return (
      type === TokenType.HEADER ||
      type === TokenType.NUMBERED_ITEM ||
      type === TokenType.BULLET ||
      type === TokenType.MODIFIER ||
      type === TokenType.TABLE ||
      type === TokenType.PAGEBREAK ||
      type === TokenType.COLUMN_BREAK ||
      type === TokenType.DOC_HEADER ||
      type === TokenType.DOC_FOOTER ||
      type === TokenType.DOC_FIRSTPAGE ||
      type === TokenType.DOC_EVENPAGE ||
      type === TokenType.DOC_COLUMNS ||
      type === TokenType.DOC_ANCHOR ||
      type === TokenType.IF ||
      type === TokenType.ELSE ||
      type === TokenType.END ||
      type === TokenType.REPEAT ||
      type === TokenType.FOREACH ||
      type === TokenType.DOCUMENT ||
      type === TokenType.META ||
      type === TokenType.IMPORT ||
      type === TokenType.DEFINE ||
      type === TokenType.USE ||
      type === TokenType.COMMENT ||
      type === TokenType.TODO ||
      type === TokenType.BLOCKQUOTE ||
      type === TokenType.HORIZONTAL_RULE ||
      type === TokenType.FOOTNOTE_DEF
    );
  }
}
