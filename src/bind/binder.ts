/**
 * Main binder for Phase 2.
 * 
 * Orchestrates:
 * 1. Directive validation (via validator)
 * 2. Symbol collection (pass 1): @def bindings + @anchor definitions
 * 3. Reference validation (pass 2): @ref targets checked against anchors
 * 4. Duplicate definition diagnostics
 * 
 * Output: BindResult with CST, SymbolTable, and Diagnostics
 */

import type { Document, Block, Directive, Inline, ParseResult } from "../types/cst.ts";
import type { SymbolTable, BindResult } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error as diagError, warning as diagWarning, DiagnosticCode } from "../types/diagnostics.ts";
import { createSymbolTable, freezeSymbolTable } from "../types/symbols.ts";
import { validate } from "./validator.ts";
import { resolveImports } from "./resolver.ts";
import type { ArgsObject } from "../shared/args.ts";

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
 * - Collect @def bindings and @anchor definitions into SymbolTable
 * - Validate @ref targets against collected anchors
 * - Report duplicate definitions and undefined references
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

    collectSymbols(doc.children, symbols, diagnostics);
    validateRefs(doc.children, symbols, diagnostics);

    return { cst, symbols: freezeSymbolTable(symbols), diagnostics };
  }

  /**
   * Synchronous bind for cases without imports.
   */
  bindSync(cst: Document): BindResult {
    const doc = cst as Document;
    const symbols = createSymbolTable();
    const diagnostics: Diagnostic[] = [];

    // Pass 1: Validate directives against registry
    diagnostics.push(...validate(doc));

    // Pass 2: Collect @def bindings and @anchor definitions
    collectSymbols(doc.children, symbols, diagnostics);

    // Pass 3: Validate @ref targets against collected anchors
    validateRefs(doc.children, symbols, diagnostics);

    return { cst, symbols: freezeSymbolTable(symbols), diagnostics };
  }
}

/**
 * Walk blocks and collect @def and @anchor directives into the symbol table.
 */
function collectSymbols(blocks: Block[], symbols: SymbolTable, diagnostics: Diagnostic[]): void {
  for (const block of blocks) {
    if (block.kind === "Directive" && block.name === "def") {
      collectDefBindings(block, symbols, diagnostics);
    }

    if (block.kind === "Directive" && block.name === "anchor") {
      collectAnchor(block, symbols, diagnostics);
    }

    // Recurse into structural bodies
    if (block.kind === "Directive" && block.body && block.body.kind === "StructuralBody") {
      collectSymbols(block.body.children, symbols, diagnostics);
    }
    if (block.kind === "ListItemMarker" && block.body) {
      collectSymbols(block.body.children, symbols, diagnostics);
    }
    if (block.kind === "StructuralBody") {
      collectSymbols(block.children, symbols, diagnostics);
    }
  }
}

/**
 * Collect a @def directive's bindings from its parsed args.
 */
function collectDefBindings(dir: Directive, symbols: SymbolTable, diagnostics: Diagnostic[]): void {
  if (!dir.args || Object.keys(dir.args).length === 0) {
    if (!dir.argsRaw) {
      diagnostics.push(
        diagError(
          DiagnosticCode.PARSE_ERROR,
          `@def requires arguments: @def(key: value, ...)`,
          dir.loc,
        ),
      );
    }
    // If argsRaw exists but args is empty, the parser already emitted a parse error diagnostic
    return;
  }

  const args = dir.args;

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
 * Collect an @anchor directive into the symbol table.
 */
function collectAnchor(dir: Directive, symbols: SymbolTable, diagnostics: Diagnostic[]): void {
  const id = dir.args?.id;
  if (typeof id !== "string" || id.length === 0) {
    // @anchor without id is already caught by the evaluator; skip silently
    return;
  }

  if (symbols.anchors.has(id)) {
    const existing = symbols.anchors.get(id)!;
    diagnostics.push(
      diagError(
        DiagnosticCode.DUPLICATE_DEFINITION,
        `Duplicate anchor '${id}' (previously defined at line ${existing.definedAt.line})`,
        dir.loc,
      ),
    );
    return;
  }

  symbols.anchors.set(id, {
    name: id,
    definedAt: dir.loc,
    usages: [],
  });
}

/**
 * Pass 2: Walk inlines to validate @ref targets against collected anchors.
 */
function validateRefs(blocks: Block[], symbols: SymbolTable, diagnostics: Diagnostic[]): void {
  for (const block of blocks) {
    if (block.kind === "ParagraphBlock") {
      for (const inline of block.inlines) {
        validateRefsInInline(inline, symbols, diagnostics);
      }
    }

    // Recurse into structural bodies
    if (block.kind === "Directive" && block.body && block.body.kind === "StructuralBody") {
      validateRefs(block.body.children, symbols, diagnostics);
    }
    if (block.kind === "ListItemMarker" && block.body) {
      validateRefs(block.body.children, symbols, diagnostics);
    }
    if (block.kind === "StructuralBody") {
      validateRefs(block.children, symbols, diagnostics);
    }
  }
}

/**
 * Recursively check an inline node for @ref directives with undefined targets.
 */
function validateRefsInInline(node: Inline, symbols: SymbolTable, diagnostics: Diagnostic[]): void {
  if (node.kind === "InlineDirective") {
    if (node.name === "ref") {
      const id = node.args?.id;
      if (typeof id === "string" && id.length > 0 && !symbols.anchors.has(id)) {
        diagnostics.push(
          diagWarning(
            DiagnosticCode.UNDEFINED_ANCHOR,
            `Cross-reference target '${id}' not found`,
            node.loc,
          ),
        );
      }
    }
    // Recurse into inline directive body
    if (node.body) {
      for (const child of node.body) {
        validateRefsInInline(child, symbols, diagnostics);
      }
    }
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
