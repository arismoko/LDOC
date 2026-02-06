/**
 * Main binder for Phase 2.
 * 
 * Orchestrates:
 * 1. Import resolution
 * 2. Symbol collection
 * 3. Reference validation
 * 
 * Output: BindResult with CST, SymbolTable, and Diagnostics
 */

import type { CSTDocument, CSTDirective, ParseResult } from "../types/cst.ts";
import type { SymbolTable, BindResult } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { createSymbolTable } from "../types/symbols.ts";
import { ImportResolver, type ResolverOptions } from "./resolver.ts";
import { Validator } from "./validator.ts";

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
 */
export class Binder {
  private options: BinderOptions;

  constructor(options: BinderOptions = {}) {
    this.options = options;
  }

  /**
   * Bind a CST document.
   * 
   * This is the main entry point for Phase 2.
   */
  async bind(cst: CSTDocument): Promise<BindResult> {
    const diagnostics: Diagnostic[] = [];
    let symbols = createSymbolTable();

    // Step 1: Resolve imports and collect external symbols
    if (this.options.loadFile && this.options.sourcePath) {
      const resolverOptions: ResolverOptions = {
        basePath: this.options.sourcePath,
        loadFile: this.options.loadFile,
      };
      
      const resolver = new ImportResolver(resolverOptions);
      const resolveResult = await resolver.resolve(cst, this.options.sourcePath);
      
      // Use imported symbols as base
      symbols = resolveResult.symbols;
      diagnostics.push(...resolveResult.diagnostics);
    } else {
      // No imports - just collect local symbols
      this.collectLocalSymbols(cst, symbols);
    }

    // Step 2: Validate references
    const validator = new Validator(symbols);
    const validationResult = validator.validate(cst);
    diagnostics.push(...validationResult.diagnostics);

    return {
      cst,
      symbols,
      diagnostics,
    };
  }

  /**
   * Synchronous bind for cases without imports.
   */
  bindSync(cst: CSTDocument): BindResult {
    const diagnostics: Diagnostic[] = [];
    const symbols = createSymbolTable();

    // Collect local symbols only
    this.collectLocalSymbols(cst, symbols);

    // Validate references
    const validator = new Validator(symbols);
    const validationResult = validator.validate(cst);
    diagnostics.push(...validationResult.diagnostics);

    return {
      cst,
      symbols,
      diagnostics,
    };
  }

  private collectLocalSymbols(cst: CSTDocument, symbols: SymbolTable): void {
    for (const node of cst.children) {
      // Skip error nodes - they have no symbols to collect
      if (node.type === "Error") {
        continue;
      }

      if (node.type !== "Directive") {
        // Handle footnote definitions
        if (node.type === "FootnoteDef") {
          if (symbols.footnotes.has(node.label)) {
            // Already collected or duplicate - skip
          } else {
            symbols.footnotes.set(node.label, {
              label: node.label,
              content: node.content,
              definedAt: node.loc,
              usages: [],
            });
          }
        }
        continue;
      }

      const directive = node;
      switch (directive.name) {
        case "define":
          this.collectDefine(directive, symbols);
          break;
        case "style":
          this.collectStyle(directive, symbols);
          break;
        case "set":
          this.collectVariable(directive, symbols);
          break;
        case "anchor":
          this.collectAnchor(directive, symbols);
          break;
      }
    }
  }

  private collectDefine(
    directive: CSTDirective,
    symbols: SymbolTable
  ): void {
    const args = directive.arguments;
    if (args.length === 0) return;

    const firstArg = args[0]!;
    let name: string;

    if (firstArg.type === "PositionalArg" && firstArg.value.type === "Identifier") {
      name = firstArg.value.name;
    } else {
      return;
    }

    // Skip if already defined (imported symbol takes precedence)
    if (symbols.macros.has(name)) {
      return;
    }

    const parameters = args.slice(1).map((arg, index) => {
      if (arg.type === "PositionalArg" && arg.value.type === "Identifier") {
        return { name: arg.value.name };
      }
      if (arg.type === "NamedArg") {
        return {
          name: arg.name,
          defaultValue: this.extractValue(arg.value),
        };
      }
      return { name: `param${index}` };
    });

    symbols.macros.set(name, {
      name,
      parameters,
      body: directive.body ?? [],
      definedAt: directive.loc,
      usages: [],
    });
  }

  private collectStyle(
    directive: CSTDirective,
    symbols: SymbolTable
  ): void {
    const args = directive.arguments;
    if (args.length === 0) return;

    const firstArg = args[0]!;
    let name: string;

    if (firstArg.type === "PositionalArg" && firstArg.value.type === "Identifier") {
      name = firstArg.value.name;
    } else if (firstArg.type === "PositionalArg" && firstArg.value.type === "StringLiteral") {
      name = firstArg.value.value;
    } else {
      return;
    }

    if (symbols.styles.has(name)) {
      return;
    }

    const properties: Record<string, unknown> = {};
    let extendsStyle: string | undefined;

    for (const arg of args.slice(1)) {
      if (arg.type === "NamedArg") {
        if (arg.name === "extends") {
          extendsStyle = this.extractValue(arg.value) as string;
        } else {
          properties[arg.name] = this.extractValue(arg.value);
        }
      }
    }

    symbols.styles.set(name, {
      name,
      properties,
      extends: extendsStyle,
      definedAt: directive.loc,
      usages: [],
    });
  }

  private collectVariable(
    directive: CSTDirective,
    symbols: SymbolTable
  ): void {
    const args = directive.arguments;
    if (args.length === 0) return;

    const firstArg = args[0]!;
    let name: string;
    let value: unknown;

    if (firstArg.type === "NamedArg") {
      name = firstArg.name;
      value = this.extractValue(firstArg.value);
    } else if (firstArg.type === "PositionalArg" && firstArg.value.type === "Identifier") {
      name = firstArg.value.name;
      if (args.length > 1 && args[1]?.type === "PositionalArg") {
        value = this.extractValue(args[1].value);
      }
    } else {
      return;
    }

    symbols.variables.set(name, {
      name,
      value,
      definedAt: directive.loc,
      usages: [],
    });
  }

  private collectAnchor(
    directive: CSTDirective,
    symbols: SymbolTable
  ): void {
    const args = directive.arguments;
    if (args.length === 0) return;

    const firstArg = args[0]!;
    let name: string | undefined;

    if (firstArg.type === "PositionalArg" && firstArg.value.type === "Identifier") {
      name = firstArg.value.name;
    } else if (firstArg.type === "PositionalArg" && firstArg.value.type === "StringLiteral") {
      name = firstArg.value.value;
    }

    if (!name) return;
    if (symbols.anchors.has(name)) return;

    symbols.anchors.set(name, {
      name,
      definedAt: directive.loc,
      usages: [],
    });
  }

  private extractValue(value: { type: string }): unknown {
    const v = value as { type: string; value?: unknown; name?: string; raw?: string };
    switch (v.type) {
      case "StringLiteral":
        return v.value;
      case "NumberLiteral":
        return v.value;
      case "BooleanLiteral":
        return v.value;
      case "Identifier":
        // Coerce boolean-like identifiers
        if (v.name === "true") return true;
        if (v.name === "false") return false;
        return v.name;
      case "Expression":
        return v.raw;
      default:
        return undefined;
    }
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
