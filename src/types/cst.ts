/**
 * Concrete Syntax Tree (CST) types.
 * 
 * The CST is a lossless representation of the source - it preserves enough
 * information to reconstruct the original text. This is what the parser produces.
 * 
 * Key design decisions:
 * 1. All nodes have source locations
 * 2. Directives are generic nodes with name + arguments + optional body
 * 3. Content is separate from control flow
 * 4. Inline content is nested within block nodes
 */

import type { SourceLocation } from "./source-location.ts";

// =============================================================================
// Base Types
// =============================================================================

interface CSTBase {
  loc: SourceLocation;
}

// =============================================================================
// Document Root
// =============================================================================

export interface CSTDocument extends CSTBase {
  type: "Document";
  children: CSTNode[];
}

// =============================================================================
// Directives (@ prefixed)
// =============================================================================

/**
 * Generic directive node: @name(args) or @name with body
 * 
 * Examples:
 *   @document(title: "My Doc")
 *   @define(myMacro, param1, param2)
 *   @if(condition)
 *   @style(bold: true)
 */
export interface CSTDirective extends CSTBase {
  type: "Directive";
  name: string;
  arguments: CSTArgument[];
  body: CSTNode[] | null;
}

/**
 * Directive argument - can be positional or named
 */
export type CSTArgument =
  | CSTPositionalArg
  | CSTNamedArg;

export interface CSTPositionalArg extends CSTBase {
  type: "PositionalArg";
  value: CSTValue;
}

export interface CSTNamedArg extends CSTBase {
  type: "NamedArg";
  name: string;
  value: CSTValue;
}

/**
 * Argument values
 */
export type CSTValue =
  | CSTStringLiteral
  | CSTNumberLiteral
  | CSTLengthLiteral
  | CSTBooleanLiteral
  | CSTIdentifier
  | CSTExpression;

export interface CSTStringLiteral extends CSTBase {
  type: "StringLiteral";
  value: string;
  raw: string; // includes quotes
}

export interface CSTNumberLiteral extends CSTBase {
  type: "NumberLiteral";
  value: number;
  raw: string;
}

export interface CSTLengthLiteral extends CSTBase {
  type: "LengthLiteral";
  value: number;
  unit: "in" | "cm" | "mm" | "pt" | "px" | "twip";
  raw: string;
}

export interface CSTBooleanLiteral extends CSTBase {
  type: "BooleanLiteral";
  value: boolean;
}

export interface CSTIdentifier extends CSTBase {
  type: "Identifier";
  name: string;
}

export interface CSTExpression extends CSTBase {
  type: "Expression";
  raw: string; // The full expression text
}

// =============================================================================
// Block Nodes
// =============================================================================

export interface CSTParagraph extends CSTBase {
  type: "Paragraph";
  content: CSTInline[];
}

export interface CSTHeader extends CSTBase {
  type: "Header";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  content: CSTInline[];
}

export interface CSTList extends CSTBase {
  type: "List";
  ordered: boolean;
  items: CSTListItem[];
}

export interface CSTListItem extends CSTBase {
  type: "ListItem";
  marker: string; // "-", "1.", "a.", etc.
  content: CSTInline[];
  children: CSTNode[]; // Nested content
}

export interface CSTTable extends CSTBase {
  type: "Table";
  rows: CSTTableRow[];
}

export interface CSTTableRow extends CSTBase {
  type: "TableRow";
  cells: CSTTableCell[];
}

export interface CSTTableCell extends CSTBase {
  type: "TableCell";
  content: CSTNode[];
}

export interface CSTBlockquote extends CSTBase {
  type: "Blockquote";
  content: CSTNode[];
}

export interface CSTHorizontalRule extends CSTBase {
  type: "HorizontalRule";
}

export interface CSTBlankLine extends CSTBase {
  type: "BlankLine";
}

// =============================================================================
// Inline Nodes
// =============================================================================

export interface CSTText extends CSTBase {
  type: "Text";
  value: string;
}

export interface CSTVariable extends CSTBase {
  type: "Variable";
  expression: string;
}

export interface CSTEmphasis extends CSTBase {
  type: "Emphasis";
  kind: "bold" | "italic" | "strikethrough" | "highlight" | "code";
  content: CSTInline[];
}

export interface CSTLink extends CSTBase {
  type: "Link";
  text: CSTInline[];
  url: string;
  title?: string;
}

export interface CSTImage extends CSTBase {
  type: "Image";
  alt: string;
  src: string;
  title?: string;
}

export interface CSTFootnoteRef extends CSTBase {
  type: "FootnoteRef";
  label: string;
}

export interface CSTCrossRef extends CSTBase {
  type: "CrossRef";
  target: string;
}

export interface CSTHardBreak extends CSTBase {
  type: "HardBreak";
}

export interface CSTTab extends CSTBase {
  type: "Tab";
}

export interface CSTDefinedTerm extends CSTBase {
  type: "DefinedTerm";
  term: string;
}

export interface CSTBlank extends CSTBase {
  type: "Blank";
  width: number; // Number of underscores
}

export interface CSTFootnoteDef extends CSTBase {
  type: "FootnoteDef";
  label: string;
  content: CSTNode[];
}

export interface CSTInlineDirective extends CSTBase {
  type: "InlineDirective";
  name: string;
  arguments: CSTArgument[];
  content: CSTInline[];
}

// =============================================================================
// Union Types
// =============================================================================

export type CSTInline =
  | CSTText
  | CSTVariable
  | CSTEmphasis
  | CSTLink
  | CSTImage
  | CSTFootnoteRef
  | CSTCrossRef
  | CSTHardBreak
  | CSTTab
  | CSTDefinedTerm
  | CSTBlank
  | CSTInlineDirective;

export type CSTBlock =
  | CSTParagraph
  | CSTHeader
  | CSTList
  | CSTTable
  | CSTBlockquote
  | CSTHorizontalRule
  | CSTBlankLine
  | CSTFootnoteDef;

export type CSTNode =
  | CSTDirective
  | CSTBlock
  | CSTInline;

// =============================================================================
// Parse Result
// =============================================================================

import type { Diagnostic } from "./diagnostics.ts";

export interface ParseResult {
  cst: CSTDocument;
  diagnostics: Diagnostic[];
}
