/**
 * Main binder for Phase 2.
 * 
 * Orchestrates:
 * 1. Directive validation (via validator)
 * 2. @def symbol collection
 * 3. Duplicate definition diagnostics
 * 
 * Output: BindResult with CST, SymbolTable, and Diagnostics
 */

import type { Document, Block, Directive, ParseResult } from "../types/cst.ts";
import type { SymbolTable, BindResult } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error as diagError, DiagnosticCode } from "../types/diagnostics.ts";
import { createSymbolTable } from "../types/symbols.ts";
import { validate } from "./validator.ts";
import { resolveImports } from "./resolver.ts";
import { parseArgsObject, type ArgsObject, type ParseArgsResult } from "../shared/args.ts";

function isParseError(result: ArgsObject | ParseArgsResult): result is ParseArgsResult {
  return "ok" in result && result.ok === false;
}

/**
 * Options for the binder.
 */
export interface BinderOptions {
  /** Source path of the entry document (for import resolution) */
  sourcePath?: string;
  /** Root directory include paths must stay within */
  includeRoot?: string;
  /** Function to load and parse a file */
  loadFile?: (path: string) => Promise<ParseResult>;
}

/**
 * Main binder class.
 *
 * Walks v3 CST to:
 * - Validate directives against registry
 * - Collect @def bindings into SymbolTable
 * - Report duplicate definitions
 */
export class Binder {
  private options: BinderOptions;

  constructor(options: BinderOptions = {}) {
    this.options = options;
  }

  /**
   * Bind a CST document.
   */
  async bind(cst: Document): Promise<BindResult> {
    const doc = cst as Document;
    const symbols = createSymbolTable();
    const diagnostics: Diagnostic[] = [];

    diagnostics.push(...validate(doc));

    if (this.options.loadFile && this.options.sourcePath) {
      const importResult = await resolveImports(doc, {
        basePath: this.options.sourcePath,
        includeRoot: this.options.includeRoot,
        loadFile: this.options.loadFile,
      });
      diagnostics.push(...importResult.diagnostics);
    }

    collectDefs(doc.children, symbols, diagnostics);

    return { cst, symbols, diagnostics };
  }

  /**
   * Synchronous bind for cases without imports.
   */
  bindSync(cst: Document): BindResult {
    const doc = cst as Document;
    const symbols = createSymbolTable();
    const diagnostics: Diagnostic[] = [];

    // Phase 1: Validate directives against registry
    diagnostics.push(...validate(doc));

    // Phase 2: Collect @def bindings
    collectDefs(doc.children, symbols, diagnostics);

    return { cst, symbols, diagnostics };
  }
}

/**
 * Walk blocks and collect @def directives into the symbol table.
 */
function collectDefs(blocks: Block[], symbols: SymbolTable, diagnostics: Diagnostic[]): void {
  for (const block of blocks) {
    if (block.kind === "Directive" && block.name === "def") {
      collectDefBindings(block, symbols, diagnostics);
    }

    // Recurse into structural bodies
    if (block.kind === "Directive" && block.body) {
      collectDefs(block.body.children, symbols, diagnostics);
    }
    if (block.kind === "ListItemMarker" && block.body) {
      collectDefs(block.body.children, symbols, diagnostics);
    }
    if (block.kind === "StructuralBody") {
      collectDefs(block.children, symbols, diagnostics);
    }
  }
}

/**
 * Parse a @def directive's args and add bindings to the symbol table.
 */
function collectDefBindings(dir: Directive, symbols: SymbolTable, diagnostics: Diagnostic[]): void {
  if (!dir.argsRaw) {
    diagnostics.push(
      diagError(
        DiagnosticCode.PARSE_ERROR,
        `@def requires arguments: @def(key: value, ...)`,
        dir.loc,
      ),
    );
    return;
  }

  // argsRaw includes parens: "(key: value, ...)"
  // Strip parens, wrap in braces for JSON5 parsing (Spec §6.1)
  const inner = dir.argsRaw.slice(1, -1);
  const wrapped = `{${inner}}`;
  const parsed = parseArgsObject(wrapped, dir.loc);

  // Check for parse failure
  if (isParseError(parsed)) {
    diagnostics.push(parsed.error);
    return;
  }

  // parsed is an ArgsObject (Record<string, JSON5Value>)
  const args = parsed;

  for (const [name, value] of Object.entries(args)) {
    if (symbols.defs.has(name)) {
      const existing = symbols.defs.get(name)!;
      diagnostics.push(
        diagError(
          DiagnosticCode.DUPLICATE_DEFINITION,
          `Duplicate definition '${name}' (previously defined at line ${existing.definedAt.line})`,
          dir.loc,
        ),
      );
      continue;
    }

    symbols.defs.set(name, {
      name,
      value,
      definedAt: dir.loc,
      usages: [],
    });
  }
}

/**
 * Bind a CST document.
 */
export async function bind(cst: Document, options?: BinderOptions): Promise<BindResult> {
  return new Binder(options).bind(cst);
}

/**
 * Bind a CST document synchronously (no imports).
 */
export function bindSync(cst: Document, options?: BinderOptions): BindResult {
  return new Binder(options).bindSync(cst);
}
