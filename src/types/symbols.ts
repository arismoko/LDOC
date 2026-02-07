/**
 * Symbol Table and Bound AST types.
 * 
 * Output of the BIND phase:
 * - Symbol table with all @def bindings indexed
 * - Style table with all @style definitions indexed
 * - Bound AST where references are linked to their definitions
 */

import type { SourceLocation } from "./source-location.ts";
import type { Document, Block } from "./cst.ts";
import type { Diagnostic } from "./diagnostics.ts";

// =============================================================================
// Symbol Table
// =============================================================================

export interface SymbolTable {
  /** All @def bindings (Spec §9) */
  defs: Map<string, DefSymbol>;
  /** All style definitions */
  styles: Map<string, StyleSymbol>;
  /** All anchor definitions (for cross-references) */
  anchors: Map<string, AnchorSymbol>;
}

/**
 * A @def binding (Spec §9).
 * Keys are identifiers, values are JSON5 values or evaluated $() expressions.
 */
export interface DefSymbol {
  name: string;
  /** The value (JSON5 value or evaluated expression result) */
  value: unknown;
  /** Where the def was defined */
  definedAt: SourceLocation;
  /** All locations where this def is referenced */
  usages: SourceLocation[];
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

export interface AnchorSymbol {
  name: string;
  definedAt: SourceLocation;
  usages: SourceLocation[];
}

// =============================================================================
// Bound AST Nodes
// =============================================================================

/**
 * A style reference with its symbol resolved.
 */
export interface BoundStyleRef {
  type: "BoundStyleRef";
  symbol: StyleSymbol | null; // null if inline-only style
  /** Inline overrides */
  overrides: Record<string, unknown>[];
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

// =============================================================================
// Bind Result
// =============================================================================

export interface BindResult {
  /** The original CST (unmodified) */
  cst: Document;
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
    defs: new Map(),
    styles: new Map(),
    anchors: new Map(),
  };
}
