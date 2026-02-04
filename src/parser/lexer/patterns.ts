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

  // Control
  PAGEBREAK = "PAGEBREAK",
  DOC_HEADER = "DOC_HEADER",
  DOC_FOOTER = "DOC_FOOTER",
  DOC_FIRSTPAGE = "DOC_FIRSTPAGE",
  DOC_EVENPAGE = "DOC_EVENPAGE",
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
  length?: string; // e.g. @indent=36pt
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
  "pagebreak",
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
  "params",
  "template",
]);
