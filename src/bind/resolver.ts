/**
 * Import resolution for the BIND phase.
 *
 * STUBBED for v3 migration (commit 9.1).
 * Will be rewritten when import resolution is needed.
 */

import type { CSTDocument, ParseResult } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { createSymbolTable } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";

/**
 * Options for import resolution.
 */
export interface ResolverOptions {
  /** Base path for resolving relative imports */
  basePath?: string;
  /** Function to load and parse a file */
  loadFile: (path: string) => Promise<ParseResult>;
}

/**
 * Result of import resolution.
 */
export interface ResolveResult {
  /** Merged symbol table from all imports */
  symbols: SymbolTable;
  /** Diagnostics from import resolution */
  diagnostics: Diagnostic[];
  /** Resolved paths that were imported */
  importedPaths: Set<string>;
}

/**
 * Import resolver for the BIND phase.
 *
 * STUBBED — returns empty results. Will be rewritten for v3.
 */
export class ImportResolver {
  constructor(_options: ResolverOptions) {}

  async resolve(_cst: CSTDocument, _sourcePath?: string): Promise<ResolveResult> {
    return {
      symbols: createSymbolTable(),
      diagnostics: [],
      importedPaths: new Set(),
    };
  }
}

/**
 * Resolve imports for a CST.
 *
 * STUBBED — returns empty results.
 */
export async function resolveImports(
  _cst: CSTDocument,
  options: ResolverOptions
): Promise<ResolveResult> {
  const resolver = new ImportResolver(options);
  return resolver.resolve(_cst, options.basePath);
}
