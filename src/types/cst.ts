/**
 * Concrete Syntax Tree v3 — Structured shapes matching LDOC v3 spec
 *
 * The v3 spec explicitly uses paragraph blocks [...]
 * and structural bodies {...}. This CST reflects that.
 */

import type { Diagnostic } from "./diagnostics.ts";
import type { SourceLocation } from "./source-location.ts";
import type { ArgsObject } from "../shared/args.ts";

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
  | StructuralBody;

/** Paragraph block - exactly one paragraph enclosed in [...] */
export interface ParagraphBlock {
  kind: "ParagraphBlock";
  loc: SourceLocation;
  inlines: Inline[];
}

/** Body of a directive: either structural children or raw text (e.g. @lua) */
export type DirectiveBody = StructuralBody | RawBody;

/** Raw body — verbatim text extracted by balanced-brace scanning (Spec §7.2) */
export interface RawBody {
  kind: "RawBody";
  format: "lua";
  text: string;
  loc: SourceLocation;
}

/** Directive - @name or @name(args) or @name{ body } */
export interface Directive {
  kind: "Directive";
  loc: SourceLocation;
  name: string;
  argsRaw?: string; // raw argument text (preserved for diagnostics/LSP)
  args?: ArgsObject; // structured parsed args (populated by parser)
  body?: DirectiveBody; // optional structural or raw body
}

/** List marker - @- or @# with optional body */
export interface ListItemMarker {
  kind: "ListItemMarker";
  loc: SourceLocation;
  ordered: boolean; // true for @#, false for @-
  depth: number; // number of leading @ symbols
  argsRaw?: string; // optional marker args like @#(start: 5)
  args?: ArgsObject; // structured parsed args (populated by parser)
  body?: StructuralBody; // optional multi-paragraph body
}

/** Structural body - collection of blocks */
export interface StructuralBody {
  kind: "StructuralBody";
  loc: SourceLocation;
  children: Block[];
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
  args?: ArgsObject; // structured parsed args (populated by parser)
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
// Parse Result
// =============================================================================

export interface ParseResult {
  cst: Document;
  diagnostics: Diagnostic[];
  /** Flag for incomplete marker (EOF-close recovery) */
  incomplete?: boolean;
}
