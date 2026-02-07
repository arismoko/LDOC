/**
 * Import resolution for the BIND phase.
 */

import { dirname, isAbsolute, resolve as resolvePath } from "node:path";

import type { Block, CSTDocument, ParseResult } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { createSymbolTable } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error, DiagnosticCode } from "../types/diagnostics.ts";
import { parseArgsObject, type ArgsObject, type ParseArgsResult } from "../shared/args.ts";
import { bindSync } from "./binder.ts";

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
  private readonly options: ResolverOptions;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly symbols: SymbolTable = createSymbolTable();
  private readonly importedPaths = new Set<string>();
  private readonly visiting = new Set<string>();

  constructor(options: ResolverOptions) {
    this.options = options;
  }

  private isParseError(result: ArgsObject | ParseArgsResult): result is ParseArgsResult {
    return "ok" in result && result.ok === false;
  }

  private parseIncludePath(argsRaw: string | undefined, pathLoc: { line: number; column: number; endLine: number; endColumn: number }): string | null {
    if (!argsRaw) {
      this.diagnostics.push(
        error(
          DiagnosticCode.PARSE_ERROR,
          "@include requires args with path",
          pathLoc,
        ),
      );
      return null;
    }

    const inner = argsRaw.slice(1, -1);
    const parsed = parseArgsObject(`{${inner}}`, pathLoc);
    if (this.isParseError(parsed)) {
      this.diagnostics.push(parsed.error);
      return null;
    }

    if (typeof parsed.path !== "string" || parsed.path.length === 0) {
      this.diagnostics.push(
        error(
          DiagnosticCode.PARSE_ERROR,
          "@include path must be a non-empty string",
          pathLoc,
        ),
      );
      return null;
    }

    return parsed.path;
  }

  private resolveImportPath(importPath: string, sourcePath: string): string {
    if (isAbsolute(importPath)) {
      return importPath;
    }
    return resolvePath(dirname(sourcePath), importPath);
  }

  private mergeImportedSymbols(imported: SymbolTable): void {
    for (const [name, symbol] of imported.defs) {
      if (!this.symbols.defs.has(name)) {
        this.symbols.defs.set(name, symbol);
      }
    }
    for (const [name, symbol] of imported.styles) {
      if (!this.symbols.styles.has(name)) {
        this.symbols.styles.set(name, symbol);
      }
    }
    for (const [name, symbol] of imported.anchors) {
      if (!this.symbols.anchors.has(name)) {
        this.symbols.anchors.set(name, symbol);
      }
    }
  }

  private async visitInclude(importPathRaw: string, includeLoc: { line: number; column: number; endLine: number; endColumn: number }, sourcePath: string): Promise<void> {
    const resolvedPath = this.resolveImportPath(importPathRaw, sourcePath);

    if (this.visiting.has(resolvedPath)) {
      this.diagnostics.push(
        error(
          DiagnosticCode.IMPORT_CYCLE,
          `Import cycle detected at '${resolvedPath}'`,
          includeLoc,
        ),
      );
      return;
    }

    if (this.importedPaths.has(resolvedPath)) {
      return;
    }

    this.visiting.add(resolvedPath);
    try {
      const parseResult = await this.options.loadFile(resolvedPath);
      this.diagnostics.push(...parseResult.diagnostics);

      const parseErrors = parseResult.diagnostics.filter((d) => d.severity === "error");
      if (parseErrors.length > 0) {
        return;
      }

      const bindResult = bindSync(parseResult.cst);
      this.diagnostics.push(...bindResult.diagnostics);
      this.mergeImportedSymbols(bindResult.symbols);

      await this.walkBlocks(parseResult.cst.children, resolvedPath);
      this.importedPaths.add(resolvedPath);
    } catch (cause) {
      this.diagnostics.push(
        error(
          DiagnosticCode.IMPORT_NOT_FOUND,
          `Failed to load include '${resolvedPath}': ${cause instanceof Error ? cause.message : String(cause)}`,
          includeLoc,
        ),
      );
    } finally {
      this.visiting.delete(resolvedPath);
    }
  }

  private async walkBlocks(blocks: Block[], sourcePath: string): Promise<void> {
    for (const block of blocks) {
      if (block.kind === "Directive" && block.name === "include") {
        const includePath = this.parseIncludePath(block.argsRaw, block.loc);
        if (includePath) {
          await this.visitInclude(includePath, block.loc, sourcePath);
        }
      }

      if (block.kind === "Directive" && block.body) {
        await this.walkBlocks(block.body.children, sourcePath);
      }

      if (block.kind === "ListItemMarker" && block.body) {
        await this.walkBlocks(block.body.children, sourcePath);
      }

      if (block.kind === "StructuralBody") {
        await this.walkBlocks(block.children, sourcePath);
      }
    }
  }

  async resolve(cst: CSTDocument, sourcePath?: string): Promise<ResolveResult> {
    const base = sourcePath ?? this.options.basePath;
    if (base) {
      await this.walkBlocks(cst.children, base);
    }

    return {
      symbols: this.symbols,
      diagnostics: this.diagnostics,
      importedPaths: this.importedPaths,
    };
  }
}

/**
 * Resolve imports for a CST.
 *
 * STUBBED — returns empty results.
 */
export async function resolveImports(
  cst: CSTDocument,
  options: ResolverOptions
): Promise<ResolveResult> {
  const resolver = new ImportResolver(options);
  return resolver.resolve(cst, options.basePath);
}
