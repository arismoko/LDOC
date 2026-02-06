/**
 * Token types produced by the lexer.
 * 
 * Design decision: Keep the lexer "dumb" - it produces simple tokens.
 * Complex parsing (like directive arguments) happens in the parser.
 */

export enum TokenType {
  // Structural
  EOF = "EOF",
  BLANK_LINE = "BLANK_LINE",          // Blank line (one per blank line in source)
  INDENT = "INDENT",
  DEDENT = "DEDENT",
  
  // Directives (@ prefixed)
  DIRECTIVE = "DIRECTIVE",  // @document, @define, @if, @style, etc.
  
  // Arguments (after directive name)
  LPAREN = "LPAREN",        // (
  RPAREN = "RPAREN",        // )
  LBRACKET = "LBRACKET",    // [
  RBRACKET = "RBRACKET",    // ]
  COMMA = "COMMA",          // ,
  COLON = "COLON",          // :
  EQUALS = "EQUALS",        // =
  
  // Literals
  STRING = "STRING",        // "..." or '...'
  NUMBER = "NUMBER",        // 123, 3.14
  LENGTH = "LENGTH",        // 1in, 12pt, 2.5cm
  BOOLEAN = "BOOLEAN",      // true, false
  IDENTIFIER = "IDENTIFIER", // bareword identifier
  
  // Content
  TEXT = "TEXT",            // Plain text content
  VARIABLE = "VARIABLE",    // {{ expr }}
  EXPRESSION = "EXPRESSION", // Expression inside {{ }}
  
  // Inline formatting markers (lexer emits same token for open/close; parser tracks state)
  BOLD_MARKER = "BOLD_MARKER",           // **
  ITALIC_MARKER = "ITALIC_MARKER",       // *
  STRIKE_MARKER = "STRIKE_MARKER",       // ~~
  CODE_MARKER = "CODE_MARKER",           // ` (content captured in value)
  HIGHLIGHT_MARKER = "HIGHLIGHT_MARKER", // ==
  
  // Links and references
  LINK = "LINK",                   // [text](url) - value is "text|url"
  IMAGE = "IMAGE",                 // ![alt](src) - value is "alt|src"
  FOOTNOTE_REF = "FOOTNOTE_REF",   // [^name]
  FOOTNOTE_DEF = "FOOTNOTE_DEF",   // [^name]: - footnote definition
  CROSS_REF = "CROSS_REF",         // [[ref]]
  
  // Block markers
  HEADER_MARKER = "HEADER_MARKER", // #, ##, ###, etc.
  BULLET = "BULLET",               // -
  NUMBERED = "NUMBERED",           // 1., 2., a., etc.
  NUMBERED_ITEM = "NUMBERED_ITEM", // @@, @@@, @@1, @@a - value encodes level|style
  BLOCKQUOTE = "BLOCKQUOTE",       // >
  HORIZONTAL_RULE = "HORIZONTAL_RULE", // ---
  
  // Special
  HARD_BREAK = "HARD_BREAK",    // @br or two trailing spaces
  TAB = "TAB",                  // @tab
  BLANK = "BLANK",              // ___ (3+ underscores) - fill-in line
  COMMENT = "COMMENT",          // // comment
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  /** Set by lexer when token is incomplete (e.g., unclosed {{ or [^ ) */
  incomplete?: boolean;
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
