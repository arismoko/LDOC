export enum TokenType {
  // Structure
  DOCUMENT = "DOCUMENT",
  META = "META",
  IMPORT = "IMPORT",
  DEFINE = "DEFINE",
  USE = "USE",

  // Control flow
  IF = "IF",
  ELSEIF = "ELSEIF",
  ELSE = "ELSE",
  END = "END",
  REPEAT = "REPEAT",
  FOREACH = "FOREACH",
  SET = "SET",

  // Numbered items: @, @@, @@@, @@@@
  NUMBERED_ITEM = "NUMBERED_ITEM",

  // Modifiers
  MODIFIER = "MODIFIER",

  // Bullets
  BULLET = "BULLET",

  // Content
  HEADER = "HEADER",
  BLOCKQUOTE = "BLOCKQUOTE",
  HORIZONTAL_RULE = "HORIZONTAL_RULE",
  TEXT = "TEXT",
  VARIABLE = "VARIABLE",
  DEFINED_TERM = "DEFINED_TERM",
  LINK = "LINK",
  CROSS_REF = "CROSS_REF",
  BLANK = "BLANK",

  // Formatting
  BOLD = "BOLD",
  ITALIC = "ITALIC",
  BOLD_ITALIC = "BOLD_ITALIC",
  STRIKETHROUGH = "STRIKETHROUGH",
  HIGHLIGHT = "HIGHLIGHT",
  INLINE_CODE = "INLINE_CODE",
  INLINE_STYLE = "INLINE_STYLE",  // @style(attrs)[content]
  INLINE_HIGHLIGHT = "INLINE_HIGHLIGHT",  // @highlight(color)[content]
  FOOTNOTE_REF = "FOOTNOTE_REF",
  FOOTNOTE_DEF = "FOOTNOTE_DEF",
  IMAGE = "IMAGE",
  HARD_BREAK = "HARD_BREAK",
  NBSP = "NBSP",
  TAB = "TAB",

  // Table
  TABLE = "TABLE",
  ROW = "ROW",
  CELL = "CELL",

  // Control
  PAGEBREAK = "PAGEBREAK",
  COLUMN_BREAK = "COLUMN_BREAK",
  DOC_HEADER = "DOC_HEADER",
  DOC_FOOTER = "DOC_FOOTER",
  DOC_FIRSTPAGE = "DOC_FIRSTPAGE",
  DOC_EVENPAGE = "DOC_EVENPAGE",
  DOC_COLUMNS = "DOC_COLUMNS",
  DOC_ANCHOR = "DOC_ANCHOR",
  COMMENT = "COMMENT",
  TODO = "TODO",

  // Structure
  INDENT = "INDENT",
  DEDENT = "DEDENT",
  NEWLINE = "NEWLINE",

  // v2 directive arguments
  LPAREN = "LPAREN",
  RPAREN = "RPAREN",
  COMMA = "COMMA",
  COLON_ARG = "COLON_ARG",
  LBRACKET_ARG = "LBRACKET_ARG",
  RBRACKET_ARG = "RBRACKET_ARG",
  NUMBER = "NUMBER",
  LENGTH = "LENGTH",
  STRING_LITERAL = "STRING_LITERAL",
  BOOLEAN = "BOOLEAN",
  IDENTIFIER_ARG = "IDENTIFIER_ARG",
  EXPRESSION = "EXPRESSION",

  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  /** End line (1-based). For single-line tokens, same as line. */
  endLine: number;
  /** End column (1-based, exclusive - points to position after last char). */
  endColumn: number;
  indent: number;
  // For modifiers
  count?: number; // e.g. @indent:2
  length?: string; // e.g. @indent=36pt
  // For numbered items
  level?: number; // Number of @ symbols
  style?: string; // '1', 'a', 'i', 'A', 'I', '1.1', etc.
  marker?: string; // The full marker like '@@a'
  // For @style modifier with key=value pairs
  attributes?: Record<string, string>;
  // For INLINE_STYLE: unparsed content between [ ]
  rawContent?: string;
}

export const MODIFIERS = new Set([
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
  "slot",
  "style",
  "highlight",
]);

// Legacy directives that are now errors (must use @document block)
export const LEGACY_DOCUMENT_DIRECTIVES = new Set([
  "margins",
  "spacing",
  "landscape",
  "numbering",
  "styles",
]);

export const KEYWORDS = new Set([
  "document",
  "meta",
  "import",
  "define",
  "use",
  "table",
  "row",
  "cell",
  "pagebreak",
  "break",
  "br",
  "nbsp",
  "tab",
  "todo",
  "header",
  "footer",
  "firstpage",
  "evenpage",
  "columns",
  "anchor",
  "if",
  "elseif",
  "else",
  "end",
  "repeat",
  "foreach",
  "set",
  "params",
  "template",
]);
