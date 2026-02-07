/**
 * Symbol Table and Bound AST types.
 * 
 * Output of the BIND phase:
 * - Symbol table with all @def bindings indexed
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

export interface AnchorSymbol {
  name: string;
  definedAt: SourceLocation;
  usages: SourceLocation[];
}

// =============================================================================
// Bound AST Nodes
// =============================================================================

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
  /** Frozen symbol table — immutable after bind phase */
  symbols: Readonly<SymbolTable>;
  /** Binding diagnostics (undefined refs, cycles, etc.) */
  diagnostics: Diagnostic[];
}

// =============================================================================
// Helper Functions
// =============================================================================

export function createSymbolTable(): SymbolTable {
  return {
    defs: new Map(),
    anchors: new Map(),
  };
}

/**
 * Freeze a symbol table so downstream phases cannot mutate it.
 *
 * Maps are sealed by replacing mutating methods (`set`, `delete`, `clear`)
 * with throwing stubs. The table object itself is frozen.
 */
export function freezeSymbolTable(symbols: SymbolTable): Readonly<SymbolTable> {
  for (const symbol of symbols.defs.values()) {
    Object.freeze(symbol.usages);
    Object.freeze(symbol);
  }
  for (const symbol of symbols.anchors.values()) {
    Object.freeze(symbol.usages);
    Object.freeze(symbol);
  }
  freezeMap(symbols.defs);
  freezeMap(symbols.anchors);
  return Object.freeze(symbols);
}

function freezeMap<K, V>(map: Map<K, V>): void {
  const name = "SymbolTable";
  map.set = () => { throw new Error(`Cannot mutate frozen ${name}`); };
  map.delete = () => { throw new Error(`Cannot mutate frozen ${name}`); };
  map.clear = () => { throw new Error(`Cannot mutate frozen ${name}`); };
}
