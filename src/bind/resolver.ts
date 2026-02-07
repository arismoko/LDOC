/**
 * Import resolution for the BIND phase.
 */

import type { Block, Document, Directive, ParseResult } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { createSymbolTable } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error, DiagnosticCode } from "../types/diagnostics.ts";
import { defaultIncludeRoot, resolveIncludeFilePath } from "../shared/include-path.ts";

/**
 * Options for import resolution.
 */
export interface ResolverOptions {
  /** Base path for resolving relative imports */
  basePath?: string;
  /** Root directory include paths must stay within */
  includeRoot?: string;
  /** Function to load and parse a file */
  loadFile: (path: string) => Promise<ParseResult>;
}

/**
 * Result of import resolution.
 */
export interface ResolveResult {
  /** Imported symbol table (currently reserved for future use) */
  symbols: SymbolTable;
  /** Diagnostics from import resolution */
  diagnostics: Diagnostic[];
  /** Resolved paths that were imported */
  importedPaths: Set<string>;
}

/**
 * Import resolver for the BIND phase.
 */
export class ImportResolver {
  private readonly options: ResolverOptions;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly symbols: SymbolTable = createSymbolTable();
  private readonly importedPaths = new Set<string>();
  private readonly visiting = new Set<string>();
  private includeRoot?: string;

  constructor(options: ResolverOptions) {
    this.options = options;
  }

  private parseIncludePath(block: Directive): string | null {
    if (!block.args) {
      if (!block.argsRaw) {
        this.diagnostics.push(
          error(
            DiagnosticCode.PARSE_ERROR,
            "@include requires args with path",
            block.loc,
          ),
        );
      }
      // If argsRaw exists but args is empty/undefined, parser already emitted diagnostic
      return null;
    }

    if (typeof block.args.path !== "string" || block.args.path.length === 0) {
      this.diagnostics.push(
        error(
          DiagnosticCode.PARSE_ERROR,
          "@include path must be a non-empty string",
          block.loc,
        ),
      );
      return null;
    }

    return block.args.path;
  }

  private async visitInclude(importPathRaw: string, includeLoc: { line: number; column: number; endLine: number; endColumn: number }, sourcePath: string): Promise<void> {
    const includeRoot = this.includeRoot ?? defaultIncludeRoot(sourcePath);
    const resolved = resolveIncludeFilePath({
      includePath: importPathRaw,
      sourcePath,
      rootPath: includeRoot,
    });
    if (!resolved.ok) {
      this.diagnostics.push(
        error(
          DiagnosticCode.IMPORT_NOT_FOUND,
          resolved.reason,
          includeLoc,
        ),
      );
      return;
    }

    const resolvedPath = resolved.path;

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
        const includePath = this.parseIncludePath(block);
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

  async resolve(cst: Document, sourcePath?: string): Promise<ResolveResult> {
    const base = sourcePath ?? this.options.basePath;
    if (base) {
      this.includeRoot = this.options.includeRoot ?? defaultIncludeRoot(base);
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
 */
export async function resolveImports(
  cst: Document,
  options: ResolverOptions
): Promise<ResolveResult> {
  const resolver = new ImportResolver(options);
  return resolver.resolve(cst, options.basePath);
}
