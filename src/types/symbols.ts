/**
 * Symbol Table and Bound AST types.
 * 
 * Output of the BIND phase:
 * - Symbol table with all @define macros indexed
 * - Style table with all @style definitions indexed
 * - Bound AST where @use references are linked to their definitions
 */

import type { SourceLocation } from "./source-location.ts";
import type { CSTDocument, CSTNode, CSTArgument, Document, Block } from "./cst.ts";
import type { Diagnostic } from "./diagnostics.ts";

// =============================================================================
// Symbol Table
// =============================================================================

export interface SymbolTable {
  /** All macro definitions */
  macros: Map<string, MacroSymbol>;
  /** All style definitions */
  styles: Map<string, StyleSymbol>;
  /** All footnote definitions */
  footnotes: Map<string, FootnoteSymbol>;
  /** All anchor definitions (for cross-references) */
  anchors: Map<string, AnchorSymbol>;
  /** Variables from @document or @set */
  variables: Map<string, VariableSymbol>;
}

export interface MacroSymbol {
  name: string;
  /** Parameter names */
  parameters: ParameterDef[];
  /** The macro body (CST nodes to expand) */
  body: CSTNode[];
  /** Where the macro was defined */
  definedAt: SourceLocation;
  /** All locations where this macro is used (for unused detection) */
  usages: SourceLocation[];
}

export interface ParameterDef {
  name: string;
  /** Default value (if any) */
  defaultValue?: unknown;
  /** Is this a rest parameter? */
  rest?: boolean;
}

export interface StyleSymbol {
  name: string;
  /** Style properties */
  properties: Record<string, unknown>;
  /** Parent style (for inheritance) */
  extends?: string;
  /** Where the style was defined */
  definedAt: SourceLocation;
  usages: SourceLocation[];
}

export interface FootnoteSymbol {
  label: string;
  /** The footnote content */
  content: CSTNode[];
  definedAt: SourceLocation;
  usages: SourceLocation[];
}

export interface AnchorSymbol {
  name: string;
  definedAt: SourceLocation;
  usages: SourceLocation[];
}

export interface VariableSymbol {
  name: string;
  value: unknown;
  definedAt: SourceLocation;
  usages: SourceLocation[];
}

// =============================================================================
// Bound AST Nodes
// =============================================================================

/**
 * A @use node with its symbol resolved.
 */
export interface BoundUse {
  type: "BoundUse";
  /** The resolved macro symbol */
  symbol: MacroSymbol;
  /** The arguments passed to the macro */
  arguments: BoundArgument[];
  loc: SourceLocation;
}

export interface BoundArgument {
  /** Parameter name (resolved from position or explicit name) */
  parameterName: string;
  /** The value CST node */
  value: CSTArgument;
}

/**
 * A style reference with its symbol resolved.
 */
export interface BoundStyleRef {
  type: "BoundStyleRef";
  symbol: StyleSymbol | null; // null if inline-only style
  /** Inline overrides */
  overrides: CSTArgument[];
  loc: SourceLocation;
}

/**
 * A cross-reference with its target resolved.
 */
export interface BoundCrossRef {
  type: "BoundCrossRef";
  symbol: AnchorSymbol | null; // null if target not found (error)
  target: string;
  loc: SourceLocation;
}

/**
 * A footnote reference with its definition resolved.
 */
export interface BoundFootnoteRef {
  type: "BoundFootnoteRef";
  symbol: FootnoteSymbol | null;
  label: string;
  loc: SourceLocation;
}

// =============================================================================
// Bind Result
// =============================================================================

export interface BindResult {
  /** The original CST (unmodified) */
  cst: CSTDocument;
  /** Symbol table with all definitions */
  symbols: SymbolTable;
  /** Binding diagnostics (undefined refs, cycles, etc.) */
  diagnostics: Diagnostic[];
}

// =============================================================================
// Helper Functions
// =============================================================================

export function createSymbolTable(): SymbolTable {
  return {
    macros: new Map(),
    styles: new Map(),
    footnotes: new Map(),
    anchors: new Map(),
    variables: new Map(),
  };
}
