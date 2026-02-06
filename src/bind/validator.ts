/**
 * Validator for the BIND phase.
 * 
 * STUB for v3 CST migration (commit 9.1).
 * Will be rewritten in commit 10 (directive registry + validator).
 *
 * Previously validated: @use references, style references,
 * cross-references, footnote references, macro cycles.
 * In v3, macros are gone; validation will check directive contracts.
 */

import type { CSTDocument, CSTNode, CSTDirective, CSTInline } from "../types/cst.ts";
import type {
  SymbolTable,
  MacroSymbol,
  BoundUse,
  BoundArgument,
  BoundFootnoteRef,
  BoundCrossRef,
  BoundStyleRef,
} from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import type { SourceLocation } from "../types/source-location.ts";

/**
 * Binding context used during validation.
 */
export interface BindingContext {
  /** Symbol table with all definitions */
  symbols: SymbolTable;
  /** Collected diagnostics */
  diagnostics: Diagnostic[];
  /** Bound @use nodes (indexed by location string) */
  boundUses: Map<string, BoundUse>;
  /** Bound footnote refs (indexed by location string) */
  boundFootnoteRefs: Map<string, BoundFootnoteRef>;
  /** Bound cross-refs (indexed by location string) */
  boundCrossRefs: Map<string, BoundCrossRef>;
  /** Bound style refs (indexed by location string) */
  boundStyleRefs: Map<string, BoundStyleRef>;
}

/**
 * Validator for CST binding.
 *
 * STUB: Returns empty context with no diagnostics.
 * Will be rewritten in commit 10.
 */
export class Validator {
  private ctx: BindingContext;

  constructor(symbols: SymbolTable) {
    this.ctx = {
      symbols,
      diagnostics: [],
      boundUses: new Map(),
      boundFootnoteRefs: new Map(),
      boundCrossRefs: new Map(),
      boundStyleRefs: new Map(),
    };
  }

  /**
   * Validate a CST document.
   *
   * STUB: No validation in v3 migration phase.
   */
  validate(_cst: CSTDocument): BindingContext {
    // STUB: v3 CST uses different shapes (kind discriminant, no .type).
    // Validation logic will be rewritten in commit 10.
    return this.ctx;
  }
}

/**
 * Validate a CST document against a symbol table.
 */
export function validate(cst: CSTDocument, symbols: SymbolTable): BindingContext {
  return new Validator(symbols).validate(cst);
}
