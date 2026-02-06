/**
 * Import resolution for the BIND phase.
 * 
 * Resolves @import directives by:
 * 1. Resolving relative paths
 * 2. Loading and parsing imported files
 * 3. Detecting import cycles
 * 4. Collecting symbols from imported modules
 */

import { dirname, resolve, isAbsolute, extname } from "node:path";

import type { CSTDocument, CSTDirective, ParseResult } from "../types/cst.ts";
import type { SymbolTable, MacroSymbol, StyleSymbol, AnchorSymbol } from "../types/symbols.ts";
import { createSymbolTable } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error, DiagnosticCode } from "../types/diagnostics.ts";
import { loc } from "../types/source-location.ts";

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
 * Strips quotes from a string literal.
 */
function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Normalizes an import path (adds .ldoc extension if missing).
 */
function normalizeImportPath(raw: string): string {
  const p = stripQuotes(raw);
  if (!p) return p;
  if (extname(p) === "") return `${p}.ldoc`;
  return p;
}

/**
 * Resolves an import path relative to the importer.
 */
function resolveImportPath(importerPath: string, specifier: string): string {
  const normalized = normalizeImportPath(specifier);
  if (isAbsolute(normalized)) return normalized;
  return resolve(dirname(importerPath), normalized);
}

/**
 * Extracts @import directives from a CST.
 */
function extractImports(cst: CSTDocument): Array<{ path: string; directive: CSTDirective }> {
  const imports: Array<{ path: string; directive: CSTDirective }> = [];
  
  for (const node of cst.children) {
    if (node.type === "Directive" && node.name === "import") {
      const directive = node as CSTDirective;
      // Get the first positional argument as the path
      const firstArg = directive.arguments[0];
      if (firstArg?.type === "PositionalArg") {
        const value = firstArg.value;
        let path: string | undefined;
        
        if (value.type === "StringLiteral") {
          path = value.value;
        } else if (value.type === "Identifier") {
          path = value.name;
        }
        
        if (path) {
          imports.push({ path, directive });
        }
      }
    }
  }
  
  return imports;
}

/**
 * Import resolver for the BIND phase.
 */
export class ImportResolver {
  private options: ResolverOptions;
  private importedFiles = new Set<string>();
  private importStack: string[] = [];
  private diagnostics: Diagnostic[] = [];

  constructor(options: ResolverOptions) {
    this.options = options;
  }

  /**
   * Resolve all imports in a document and build a merged symbol table.
   */
  async resolve(cst: CSTDocument, sourcePath?: string): Promise<ResolveResult> {
    const symbols = createSymbolTable();
    
    const entryPath = sourcePath ?? this.options.basePath;
    if (!entryPath) {
      // No source path - can't resolve relative imports
      return {
        symbols,
        diagnostics: this.diagnostics,
        importedPaths: this.importedFiles,
      };
    }

    // Process imports from entry file
    await this.processFile(cst, entryPath, symbols);

    return {
      symbols,
      diagnostics: this.diagnostics,
      importedPaths: this.importedFiles,
    };
  }

  private async processFile(cst: CSTDocument, filePath: string, symbols: SymbolTable): Promise<void> {
    // Check for cycles
    if (this.importStack.includes(filePath)) {
      const cycle = [...this.importStack, filePath].join(" -> ");
      this.diagnostics.push(
        error(
          DiagnosticCode.IMPORT_CYCLE,
          `Import cycle detected: ${cycle}`,
          loc(1, 0) // We don't have exact location here
        )
      );
      return;
    }

    // Skip already imported files
    if (this.importedFiles.has(filePath)) {
      return;
    }

    this.importedFiles.add(filePath);
    this.importStack.push(filePath);

    try {
      // Extract imports from this file
      const imports = extractImports(cst);

      // Process each import
      for (const { path, directive } of imports) {
        const resolvedPath = resolveImportPath(filePath, path);
        
        try {
          const result = await this.options.loadFile(resolvedPath);
          
          // Add parse diagnostics
          this.diagnostics.push(...result.diagnostics);
          
          // Recursively process the imported file
          await this.processFile(result.cst, resolvedPath, symbols);
        } catch (err) {
          this.diagnostics.push(
            error(
              DiagnosticCode.IMPORT_NOT_FOUND,
              `Import not found: ${resolvedPath}`,
              directive.loc
            )
          );
        }
      }

      // Collect symbols from this file (after imports, so local overrides work)
      // Pass filePath so symbols get their source location tagged
      this.collectSymbols(cst, filePath, symbols);
      
    } finally {
      this.importStack.pop();
    }
  }

  /**
   * Collect @define, @style, and other symbols from a CST.
   * Tags each symbol's definedAt location with the source file path.
   */
  private collectSymbols(cst: CSTDocument, filePath: string, symbols: SymbolTable): void {
    for (const node of cst.children) {
      if (node.type !== "Directive") continue;
      
      const directive = node as CSTDirective;
      
      switch (directive.name) {
        case "define":
          this.collectDefine(directive, filePath, symbols);
          break;
        case "style":
          this.collectStyle(directive, filePath, symbols);
          break;
        case "set":
          this.collectVariable(directive, filePath, symbols);
          break;
        case "anchor":
          this.collectAnchor(directive, filePath, symbols);
          break;
        // Note: footnote definitions are handled separately (they're CSTFootnoteDef, not directives)
      }
    }
    
    // Collect footnote definitions (they're block-level, not directives)
    for (const node of cst.children) {
      if (node.type === "FootnoteDef") {
        const fn = node;
        if (symbols.footnotes.has(fn.label)) {
          this.diagnostics.push(
            error(
              DiagnosticCode.DUPLICATE_DEFINITION,
              `Duplicate footnote definition: [^${fn.label}]`,
              fn.loc
            )
          );
        } else {
          symbols.footnotes.set(fn.label, {
            label: fn.label,
            content: fn.content,
            definedAt: { ...fn.loc, source: filePath },
            usages: [],
          });
        }
      }
    }
  }

  private collectDefine(directive: CSTDirective, filePath: string, symbols: SymbolTable): void {
    // @define(macroName, param1, param2, ...)
    const args = directive.arguments;
    if (args.length === 0) return;
    
    const firstArg = args[0]!;
    let name: string;
    
    if (firstArg.type === "PositionalArg" && firstArg.value.type === "Identifier") {
      name = firstArg.value.name;
    } else {
      // Can't determine macro name
      return;
    }

    // Extract parameters (remaining positional args)
    const parameters = args.slice(1).map((arg, index) => {
      if (arg.type === "PositionalArg" && arg.value.type === "Identifier") {
        return { name: arg.value.name };
      }
      // Named arg with default value
      if (arg.type === "NamedArg") {
        return {
          name: arg.name,
          defaultValue: this.extractValue(arg.value),
        };
      }
      return { name: `param${index}` };
    });

    // Check for duplicate
    if (symbols.macros.has(name)) {
      this.diagnostics.push(
        error(
          DiagnosticCode.DUPLICATE_DEFINITION,
          `Duplicate @define '${name}'`,
          directive.loc
        )
      );
      return;
    }

    const symbol: MacroSymbol = {
      name,
      parameters,
      body: directive.body ?? [],
      definedAt: { ...directive.loc, source: filePath },
      usages: [],
    };

    symbols.macros.set(name, symbol);
  }

  private collectStyle(directive: CSTDirective, filePath: string, symbols: SymbolTable): void {
    // @style(styleName, property: value, ...)
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

    // Extract properties
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

    if (symbols.styles.has(name)) {
      this.diagnostics.push(
        error(
          DiagnosticCode.DUPLICATE_DEFINITION,
          `Duplicate @style '${name}'`,
          directive.loc
        )
      );
      return;
    }

    const symbol: StyleSymbol = {
      name,
      properties,
      extends: extendsStyle,
      definedAt: { ...directive.loc, source: filePath },
      usages: [],
    };

    symbols.styles.set(name, symbol);
  }

  private collectVariable(directive: CSTDirective, filePath: string, symbols: SymbolTable): void {
    // @set(name, value) or @set(name: value)
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
      // Get value from second arg
      if (args.length > 1 && args[1]?.type === "PositionalArg") {
        value = this.extractValue(args[1].value);
      }
    } else {
      return;
    }

    // Variables can be redefined (last definition wins)
    symbols.variables.set(name, {
      name,
      value,
      definedAt: { ...directive.loc, source: filePath },
      usages: [],
    });
  }

  private collectAnchor(directive: CSTDirective, filePath: string, symbols: SymbolTable): void {
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

    if (symbols.anchors.has(name)) {
      this.diagnostics.push(
        error(
          DiagnosticCode.DUPLICATE_DEFINITION,
          `Duplicate @anchor '${name}'`,
          directive.loc
        )
      );
      return;
    }

    const symbol: AnchorSymbol = {
      name,
      definedAt: { ...directive.loc, source: filePath },
      usages: [],
    };

    symbols.anchors.set(name, symbol);
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
 * Resolve imports for a CST.
 */
export async function resolveImports(
  cst: CSTDocument,
  options: ResolverOptions
): Promise<ResolveResult> {
  const resolver = new ImportResolver(options);
  return resolver.resolve(cst, options.basePath);
}
