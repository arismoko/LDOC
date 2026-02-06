/**
 * Main binder for Phase 2.
 * 
 * Orchestrates:
 * 1. Import resolution
 * 2. Symbol collection
 * 3. Reference validation
 * 
 * Output: BindResult with CST, SymbolTable, and Diagnostics
 *
 * NOTE: This module is stubbed for v3 CST migration (commit 9.1).
 * Logic will be rewritten in commits 10-12.
 */

import type { Document, CSTDocument, ParseResult } from "../types/cst.ts";
import type { SymbolTable, BindResult } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { createSymbolTable } from "../types/symbols.ts";
import { validate } from "./validator.ts";

/**
 * Options for the binder.
 */
export interface BinderOptions {
  /** Source path of the entry document (for import resolution) */
  sourcePath?: string;
  /** Function to load and parse a file */
  loadFile?: (path: string) => Promise<ParseResult>;
}

/**
 * Main binder class.
 *
 * STUB: Returns empty symbol table + no diagnostics.
 * Will be rewritten in commits 10-12.
 */
export class Binder {
  private options: BinderOptions;

  constructor(options: BinderOptions = {}) {
    this.options = options;
  }

  /**
   * Bind a CST document.
   */
  async bind(cst: CSTDocument): Promise<BindResult> {
    // Run directive validation against registry
    const validationDiags = validate(cst as Document);
    return {
      cst,
      symbols: createSymbolTable(),
      diagnostics: validationDiags,
    };
  }

  /**
   * Synchronous bind for cases without imports.
   */
  bindSync(cst: CSTDocument): BindResult {
    // Run directive validation against registry
    const validationDiags = validate(cst as Document);
    return {
      cst,
      symbols: createSymbolTable(),
      diagnostics: validationDiags,
    };
  }
}

/**
 * Bind a CST document.
 */
export async function bind(cst: CSTDocument, options?: BinderOptions): Promise<BindResult> {
  return new Binder(options).bind(cst);
}

/**
 * Bind a CST document synchronously (no imports).
 */
export function bindSync(cst: CSTDocument, options?: BinderOptions): BindResult {
  return new Binder(options).bindSync(cst);
}
