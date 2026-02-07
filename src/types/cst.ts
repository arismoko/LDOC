/**
 * Concrete Syntax Tree v3 — Structured shapes matching LDOC v3 spec
 *
 * The v3 spec explicitly uses paragraph blocks [...]
 * and structural bodies {...}. This CST reflects that.
 */

import type { TokenType } from "./tokens.ts";
import type { Diagnostic } from "./diagnostics.ts";
import type { SourceLocation } from "./source-location.ts";

// =============================================================================
// Core Document Structure
// =============================================================================

/** Root document node */
export interface Document {
  kind: "Document";
  loc: SourceLocation;
  children: Block[];
}

// =============================================================================
// Block Types (structural context)
// =============================================================================

/** Base block type */
export type Block =
  | ParagraphBlock
  | Directive
  | ListItemMarker
  | StructuralBody
  | Table
  | LayoutDirective
  | HeaderFooter
  | Include;

/** Paragraph block - exactly one paragraph enclosed in [...] */
export interface ParagraphBlock {
  kind: "ParagraphBlock";
  loc: SourceLocation;
  inlines: Inline[];
}

/** Directive - @name or @name(args) or @name{ body } */
export interface Directive {
  kind: "Directive";
  loc: SourceLocation;
  name: string;
  argsRaw?: string; // raw argument text or undefined
  body?: StructuralBody; // optional structural body
}

/** List marker - @- or @# with optional body */
export interface ListItemMarker {
  kind: "ListItemMarker";
  loc: SourceLocation;
  ordered: boolean; // true for @#, false for @-
  depth: number; // number of leading @ symbols
  argsRaw?: string; // optional marker args like @#(start: 5)
  body?: StructuralBody; // optional multi-paragraph body
}

/** Structural body - collection of blocks */
export interface StructuralBody {
  kind: "StructuralBody";
  loc: SourceLocation;
  children: Block[];
}

/** Table - @table{ rows } */
export interface Table {
  kind: "Table";
  loc: SourceLocation;
  rows: TableRow[];
}

/** Table row - @row(cells: [...]) */
export interface TableRow {
  kind: "TableRow";
  loc: SourceLocation;
  cells: string[]; // cell contents with merge tokens (">", "^")
}

// =============================================================================
// Layout Directives (core)
// =============================================================================

export type LayoutDirective =
  | Pagebreak
  | Columns
  | Box
  | Align;

/** Page break - @pagebreak */
export interface Pagebreak {
  kind: "Pagebreak";
  loc: SourceLocation;
}

/** Columns - @columns(count: 2, gap: "0.5in", separator: true){ body } */
export interface Columns {
  kind: "Columns";
  loc: SourceLocation;
  count: number;
  gap: string;
  separator: boolean;
  body: StructuralBody;
}

/** Box - @box{ content } */
export interface Box {
  kind: "Box";
  loc: SourceLocation;
  body: StructuralBody;
}

/** Alignment - @align(value: "center"){ content } */
export interface Align {
  kind: "Align";
  loc: SourceLocation;
  value: "left" | "center" | "right";
  body: StructuralBody;
}

// =============================================================================
// Header and Footer
// =============================================================================

export type HeaderFooter =
  | Header
  | Footer;

/** Header - @header{ left | center | right } */
export interface Header {
  kind: "Header";
  loc: SourceLocation;
  left?: ParagraphBlock;
  center?: ParagraphBlock;
  right?: ParagraphBlock;
}

/** Footer - @footer{ left | center | right } */
export interface Footer {
  kind: "Footer";
  loc: SourceLocation;
  left?: ParagraphBlock;
  center?: ParagraphBlock;
  right?: ParagraphBlock;
}

// =============================================================================
// Include Directive
// =============================================================================

/** File include - @include(path: "...", args: {...}) */
export interface Include {
  kind: "Include";
  loc: SourceLocation;
  path: string;
  args: Record<string, any>; // evaluated later
}

// =============================================================================
// Inline Types (paragraph context)
// =============================================================================

/** Base inline type */
export type Inline =
  | InlineText
  | InlineDirective
  | LuaExpr
  | InlineHardBreak;

/** Plain text content */
export interface InlineText {
  kind: "InlineText";
  loc: SourceLocation;
  text: string;
}

/** Inline directive - e.g., @style(r: { bold: true }){important} */
export interface InlineDirective {
  kind: "InlineDirective";
  loc: SourceLocation;
  name: string;
  argsRaw?: string;
  body?: Inline[]; // optional inline body inside directive
}

/** Lua expression - $(...) */
export interface LuaExpr {
  kind: "LuaExpr";
  loc: SourceLocation;
  expr: string; // content inside $(...)
}

/** Hard line break (from blank lines in paragraphs) */
export interface InlineHardBreak {
  kind: "InlineHardBreak";
  loc: SourceLocation;
}

// =============================================================================
// Other (reserved for future use)
// =============================================================================

/** Anchor - @anchor(id: "...") */
export interface Anchor {
  kind: "Anchor";
  loc: SourceLocation;
  id: string;
}

/** Def - @def(...) */
export interface Def {
  kind: "Def";
  loc: SourceLocation;
  bindings: Record<string, any>; // name -> value
}

/** Style application - @style(...) */
export interface Style {
  kind: "Style";
  loc: SourceLocation;
  channel: "p" | "r"; // p for paragraph, r for run
  argsRaw?: string;
}

/** Document config - @document(...) */
export interface DocumentConfig {
  kind: "DocumentConfig";
  loc: SourceLocation;
  argsRaw?: string;
}

// =============================================================================
// Parse Result
// =============================================================================

export interface ParseResult {
  cst: Document;
  diagnostics: Diagnostic[];
  /** Flag for incomplete marker (EOF-close recovery) */
  incomplete?: boolean;
}

// =============================================================================
// Constructors
// =============================================================================

export function document(loc: SourceLocation, children: Block[]): Document {
  return { kind: "Document", loc, children };
}

export function paragraphBlock(loc: SourceLocation, inlines: Inline[]): ParagraphBlock {
  return { kind: "ParagraphBlock", loc, inlines };
}

export function directive(loc: SourceLocation, name: string, argsRaw?: string, body?: StructuralBody): Directive {
  return { kind: "Directive", loc, name, argsRaw, body };
}

export function listItemMarker(loc: SourceLocation, ordered: boolean, depth: number, argsRaw?: string, body?: StructuralBody): ListItemMarker {
  return { kind: "ListItemMarker", loc, ordered, depth, argsRaw, body };
}

export function structuralBody(loc: SourceLocation, children: Block[]): StructuralBody {
  return { kind: "StructuralBody", loc, children };
}

export function table(loc: SourceLocation, rows: TableRow[]): Table {
  return { kind: "Table", loc, rows };
}

export function tableRow(loc: SourceLocation, cells: string[]): TableRow {
  return { kind: "TableRow", loc, cells };
}

export function pagebreak(loc: SourceLocation): Pagebreak {
  return { kind: "Pagebreak", loc };
}

export function columns(loc: SourceLocation, count: number, gap: string, separator: boolean, body: StructuralBody): Columns {
  return { kind: "Columns", loc, count, gap, separator, body };
}

export function box(loc: SourceLocation, body: StructuralBody): Box {
  return { kind: "Box", loc, body };
}

export function align(loc: SourceLocation, value: "left" | "center" | "right", body: StructuralBody): Align {
  return { kind: "Align", loc, value, body };
}

export function header(loc: SourceLocation, left?: ParagraphBlock, center?: ParagraphBlock, right?: ParagraphBlock): Header {
  return { kind: "Header", loc, left, center, right };
}

export function footer(loc: SourceLocation, left?: ParagraphBlock, center?: ParagraphBlock, right?: ParagraphBlock): Footer {
  return { kind: "Footer", loc, left, center, right };
}

export function include(loc: SourceLocation, path: string, args: Record<string, any>): Include {
  return { kind: "Include", loc, path, args };
}

export function inlineText(loc: SourceLocation, text: string): InlineText {
  return { kind: "InlineText", loc, text };
}

export function inlineDirective(loc: SourceLocation, name: string, argsRaw?: string, body?: Inline[]): InlineDirective {
  return { kind: "InlineDirective", loc, name, argsRaw, body };
}

export function luaExpr(loc: SourceLocation, expr: string): LuaExpr {
  return { kind: "LuaExpr", loc, expr };
}

export function inlineHardBreak(loc: SourceLocation): InlineHardBreak {
  return { kind: "InlineHardBreak", loc };
}

export function anchor(loc: SourceLocation, id: string): Anchor {
  return { kind: "Anchor", loc, id };
}

export function def(loc: SourceLocation, bindings: Record<string, any>): Def {
  return { kind: "Def", loc, bindings };
}

export function style(loc: SourceLocation, channel: "p" | "r", argsRaw?: string): Style {
  return { kind: "Style", loc, channel, argsRaw };
}

export function documentConfig(loc: SourceLocation, argsRaw?: string): DocumentConfig {
  return { kind: "DocumentConfig", loc, argsRaw };
}

