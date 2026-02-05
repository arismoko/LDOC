/**
 * Token types produced by the lexer.
 * 
 * Design decision: Keep the lexer "dumb" - it produces simple tokens.
 * Complex parsing (like directive arguments) happens in the parser.
 */

export enum TokenType {
  // Structural
  EOF = "EOF",
  NEWLINE = "NEWLINE",
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
  
  // Inline formatting
  BOLD_START = "BOLD_START",       // **
  BOLD_END = "BOLD_END",
  ITALIC_START = "ITALIC_START",   // *
  ITALIC_END = "ITALIC_END",
  STRIKE_START = "STRIKE_START",   // ~~
  STRIKE_END = "STRIKE_END",
  CODE_START = "CODE_START",       // `
  CODE_END = "CODE_END",
  HIGHLIGHT_START = "HIGHLIGHT_START", // ==
  HIGHLIGHT_END = "HIGHLIGHT_END",
  
  // Links and references
  LINK_START = "LINK_START",     // [
  LINK_END = "LINK_END",         // ]
  LINK_URL = "LINK_URL",         // (url)
  IMAGE = "IMAGE",               // ![alt](src)
  FOOTNOTE_REF = "FOOTNOTE_REF", // [^name]
  CROSS_REF = "CROSS_REF",       // [@ref]
  
  // Block markers
  HEADER_MARKER = "HEADER_MARKER", // #, ##, ###, etc.
  BULLET = "BULLET",               // -
  NUMBERED = "NUMBERED",           // 1., 2., etc.
  BLOCKQUOTE = "BLOCKQUOTE",       // >
  HORIZONTAL_RULE = "HORIZONTAL_RULE", // ---
  
  // Special
  HARD_BREAK = "HARD_BREAK",  // @br or two trailing spaces
  TAB = "TAB",                // @tab
  BLANK = "BLANK",            // @blank
  COMMENT = "COMMENT",        // // comment
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
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
