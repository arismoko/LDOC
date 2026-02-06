/**
 * Concrete Syntax Tree — Uniform Node Architecture
 *
 * Inspired by Typst's parser: one node type, kind enum identifies semantics.
 * No inline/block distinction at the CST level. Paragraph grouping happens
 * as a post-parse transform.
 *
 * Design principles:
 *   1. Every node is a `CSTNode` — uniform interface, kind discriminates.
 *   2. `[...]` (ContentBlock) and indented bodies (Body) both produce child
 *      sequences — same structure, different delimiters.
 *   3. The parser does NOT create Paragraph nodes. A separate `groupParagraphs`
 *      pass collects consecutive inline nodes between Parbreaks into Paragraphs.
 *   4. Trivia (whitespace, comments, blank lines) are real nodes.
 */

import type { SourceLocation } from "./source-location.ts";
import type { Diagnostic } from "./diagnostics.ts";

// =============================================================================
// Node Kind — flat enum, no hierarchy
// =============================================================================

export enum NodeKind {
  // -- Document root --
  Document = "Document",

  // -- Directive system --
  /** @name(...)[...] or @name with indented body */
  Directive = "Directive",
  /** (...) argument list */
  Args = "Args",
  /** name: value pair inside Args */
  NamedArg = "NamedArg",
  /** [...] bracketed content block — parsed recursively */
  ContentBlock = "ContentBlock",
  /** Indented body — children parsed recursively */
  Body = "Body",
  /** Raw YAML-like body (@document, @meta) — not parsed further */
  OpaqueBody = "OpaqueBody",

  // -- Block-level constructs (identified by leading token) --
  /** # Heading */
  Heading = "Heading",
  /** - item or * item */
  ListItem = "ListItem",
  /** 1. item or a. item or @@item */
  EnumItem = "EnumItem",
  /** > blockquote */
  Blockquote = "Blockquote",
  /** --- horizontal rule */
  Rule = "Rule",
  /** | cell | cell | table row */
  TableRow = "TableRow",
  /** Cell content within a table row */
  TableCell = "TableCell",
  /** [^label]: footnote definition */
  FootnoteDef = "FootnoteDef",

  // -- Paragraph (created by groupParagraphs, NOT the parser) --
  Paragraph = "Paragraph",

  // -- Inline constructs --
  /** Plain text leaf */
  Text = "Text",
  /** **bold** */
  Strong = "Strong",
  /** *italic* */
  Emph = "Emph",
  /** ~~strike~~ */
  Strike = "Strike",
  /** ==highlight== */
  Highlight = "Highlight",
  /** `code` */
  Code = "Code",
  /** {{expression}} */
  Interpolation = "Interpolation",
  /** [text](url) */
  Link = "Link",
  /** ![alt](src) */
  Image = "Image",
  /** [^ref] */
  FootnoteRef = "FootnoteRef",
  /** [[target]] */
  CrossRef = "CrossRef",
  /** "defined term" (string token in inline context) */
  DefinedTerm = "DefinedTerm",
  /** ___ fill-in blank */
  Blank = "Blank",
  /** @br or trailing double-space */
  Linebreak = "Linebreak",
  /** @tab */
  Tab = "Tab",

  // -- Trivia --
  /** Blank line — paragraph boundary */
  Parbreak = "Parbreak",
  /** // comment */
  Comment = "Comment",

  // -- Literals (inside Args) --
  Ident = "Ident",
  Str = "Str",
  Num = "Num",
  Len = "Len",
  Bool = "Bool",
  Expr = "Expr",

  // -- Error recovery --
  Error = "Error",
}

// =============================================================================
// The Node
// =============================================================================

/**
 * Every element in the tree is a CSTNode.
 *
 * Inner nodes have children. Leaf nodes have text.
 * The `kind` field tells you what it is.
 */
export interface CSTNode {
  kind: NodeKind;
  loc: SourceLocation;
  children: CSTNode[];
  /** Leaf content (Text, Ident, Str, Num, Len, Bool, OpaqueBody, Error) */
  text?: string;
  /** Error message (kind === Error only) */
  error?: string;
}

// =============================================================================
// Parse Result
// =============================================================================

export interface ParseResult {
  cst: CSTNode; // kind === Document
  diagnostics: Diagnostic[];
}

// =============================================================================
// Constructors
// =============================================================================

export function inner(kind: NodeKind, loc: SourceLocation, children: CSTNode[]): CSTNode {
  return { kind, loc, children };
}

export function leaf(kind: NodeKind, loc: SourceLocation, text: string): CSTNode {
  return { kind, loc, children: [], text };
}

export function errorNode(loc: SourceLocation, message: string, children: CSTNode[] = []): CSTNode {
  return { kind: NodeKind.Error, loc, children, error: message };
}

// =============================================================================
// Accessors — typed views over the uniform tree
// =============================================================================

/** Get the directive name (first Ident child). */
export function directiveName(node: CSTNode): string | undefined {
  if (node.kind !== NodeKind.Directive) return undefined;
  return node.children.find(c => c.kind === NodeKind.Ident)?.text;
}

/** Get the Args child of a Directive. */
export function directiveArgs(node: CSTNode): CSTNode | undefined {
  return node.children.find(c => c.kind === NodeKind.Args);
}

/** Get the body of a Directive — ContentBlock, Body, or OpaqueBody. */
export function directiveBody(node: CSTNode): CSTNode | undefined {
  return node.children.find(
    c => c.kind === NodeKind.ContentBlock || c.kind === NodeKind.Body || c.kind === NodeKind.OpaqueBody
  );
}

/** Get body children (unwrap ContentBlock/Body wrapper). */
export function bodyChildren(node: CSTNode): CSTNode[] {
  const body = directiveBody(node);
  if (!body) return [];
  return body.children;
}

/** Get heading level from marker. */
export function headingLevel(node: CSTNode): number {
  if (node.kind !== NodeKind.Heading) return 0;
  // First child is the marker text (e.g. "#", "##")
  const marker = node.children[0];
  return marker?.text?.length ?? 0;
}

/** Collect all text from a node tree (flattening). */
export function collectText(node: CSTNode): string {
  if (node.text !== undefined) return node.text;
  return node.children.map(collectText).join("");
}

/** Get named arg value by name from an Args node. */
export function namedArgValue(argsNode: CSTNode, name: string): CSTNode | undefined {
  for (const child of argsNode.children) {
    if (child.kind === NodeKind.NamedArg) {
      const nameNode = child.children[0];
      if (nameNode?.text === name) return child.children[1];
    }
  }
  return undefined;
}

/** Get all positional arg values from an Args node. */
export function positionalArgs(argsNode: CSTNode): CSTNode[] {
  return argsNode.children.filter(c => c.kind !== NodeKind.NamedArg);
}

// =============================================================================
// Type Guards
// =============================================================================

export function isTrivia(kind: NodeKind): boolean {
  return kind === NodeKind.Parbreak || kind === NodeKind.Comment;
}

export function isBlockLevel(kind: NodeKind): boolean {
  return (
    kind === NodeKind.Directive ||
    kind === NodeKind.Heading ||
    kind === NodeKind.ListItem ||
    kind === NodeKind.EnumItem ||
    kind === NodeKind.Blockquote ||
    kind === NodeKind.Rule ||
    kind === NodeKind.TableRow ||
    kind === NodeKind.FootnoteDef ||
    kind === NodeKind.Paragraph
  );
}

export function isInline(kind: NodeKind): boolean {
  return (
    kind === NodeKind.Text ||
    kind === NodeKind.Strong ||
    kind === NodeKind.Emph ||
    kind === NodeKind.Strike ||
    kind === NodeKind.Highlight ||
    kind === NodeKind.Code ||
    kind === NodeKind.Interpolation ||
    kind === NodeKind.Link ||
    kind === NodeKind.Image ||
    kind === NodeKind.FootnoteRef ||
    kind === NodeKind.CrossRef ||
    kind === NodeKind.DefinedTerm ||
    kind === NodeKind.Blank ||
    kind === NodeKind.Linebreak ||
    kind === NodeKind.Tab ||
    kind === NodeKind.Directive // directives with ContentBlock are inline
  );
}

export function isError(node: CSTNode): boolean {
  return node.kind === NodeKind.Error;
}

export function hasError(node: CSTNode): boolean {
  if (isError(node)) return true;
  return node.children.some(hasError);
}
