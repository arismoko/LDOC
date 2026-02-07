/**
 * Token types produced by the lexer.
 *
 * Design decision: Keep the lexer "dumb" - it produces simple tokens.
 * Complex parsing (like directive arguments) happens in the parser.
 */

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  /** Set by lexer when token is incomplete (e.g., unclosed {{ or [^ ) */
  incomplete?: boolean;
  /** Original quote character for STRING tokens (' or ") */
  quote?: string;
}

/**
 * Create a token with location info.
 */
export function token(
  type: TokenType,
  value: string,
  line: number,
  column: number,
  endLine?: number,
  endColumn?: number
): Token {
  return {
    type,
    value,
    line,
    column,
    endLine: endLine ?? line,
    endColumn: endColumn ?? column + value.length,
  };
}

export enum TokenType {
  // Structural / Content
  EOF = "EOF",
  BLANK_LINE = "BLANK_LINE",          // Blank line (one per blank line in source)

  // Paragraph blocks
  PARA_OPEN = "PARA_OPEN",             // [
  PARA_CLOSE = "PARA_CLOSE",           // ]

  // Lua evaluation
  LUA_EXPR_OPEN = "LUA_EXPR_OPEN",     // $(

  // Directives
  DIRECTIVE = "DIRECTIVE",            // @name (e.g., @document, @def)

  // Arguments
  LPAREN = "LPAREN",                   // (
  RPAREN = "RPAREN",                   // )
  LBRACE = "LBRACE",                   // {
  RBRACE = "RBRACE",                   // }
  COMMA = "COMMA",                     // ,
  COLON = "COLON",                     // :
  EQUALS = "EQUALS",                   // =
  PERIOD = "PERIOD",                   // .

  // List markers
  LIST_BULLET = "LIST_BULLET",         // @- (bullet)
  LIST_ORDERED = "LIST_ORDERED",       // @# (ordered)

  // Content / Literals
  TEXT = "TEXT",                       // Plain text content
  STRING = "STRING",                   // "..." or '...'
  NUMBER = "NUMBER",                   // 123, 3.14
  LENGTH = "LENGTH",                   // 1in, 12pt, 2.5cm
  BOOLEAN = "BOOLEAN",                 // true, false
  IDENTIFIER = "IDENTIFIER",           // bareword identifier

  // Comments
  COMMENT = "COMMENT",                 // // comment (structural only)
}
