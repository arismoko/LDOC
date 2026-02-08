/**
 * LDOC Pipeline - Complete compilation from source to DOCX.
 * 
 * Orchestrates: PARSE → BIND → EVALUATE → STYLE → EMIT
 */

import { parseSource } from "../parse/index.ts";
import { bind, bindSync } from "../bind/index.ts";
import { evaluate, type SourceLoader } from "../evaluate/index.ts";
import { defaultIncludeRoot } from "../shared/include-path.ts";
import { style, type StyleOptions } from "../style/index.ts";
import { emit, type EmitOptions } from "../emit/index.ts";
import type * as CST from "../types/cst.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import type { Document } from "../types/document-ir.ts";
import type { StyledDocument } from "../types/styled.ts";
import type { SymbolTable } from "../types/symbols.ts";

// =============================================================================
// Pipeline Options
// =============================================================================

/**
 * Options for the compile pipeline.
 */
export interface CompileOptions {
  /** Source file path (for error messages) */
  sourcePath?: string;
  
  /** Context for variable interpolation and conditionals */
  variables?: Record<string, unknown>;

  /** Custom source loader for @include expansion */
  loadFile?: SourceLoader;

  /** Root directory include paths must stay within */
  includeRoot?: string;
  
  /** Style options */
  style?: StyleOptions;
  
  /** Emit options */
  emit?: EmitOptions;
}

/**
 * Result of a successful compilation.
 */
export interface CompileResult {
  /** The generated DOCX buffer */
  buffer: Uint8Array;
  
  /** All diagnostics (warnings, info) collected during compilation */
  diagnostics: Diagnostic[];
}

/**
 * Result of pipeline with possible failure.
 */
export type PipelineResult<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; error: Error; diagnostics: Diagnostic[] };

// =============================================================================
// Internal: Pipeline State
// =============================================================================

/**
 * Internal state passed through pipeline stages.
 * Each stage adds its result to this accumulator.
 */
interface PipelineState {
  diagnostics: Diagnostic[];
  cst?: CST.Document;
  symbols?: SymbolTable;
  document?: Document;
  styledDocument?: StyledDocument;
}

type PipelineStage = "parse" | "bind" | "evaluate" | "style";

/**
 * Error that carries accumulated diagnostics from earlier pipeline stages.
 */
class PipelineError extends Error {
  constructor(message: string, public readonly diagnostics: Diagnostic[]) {
    super(message);
    this.name = "PipelineError";
  }
}

// =============================================================================
// Internal Helpers (DRY: shared by runPipelineTo, parseAndBind, parseAndBindWithIncludes)
// =============================================================================

/**
 * Parse source and throw on errors.
 * Returns CST and all diagnostics (including non-error ones).
 */
function parseWithDiagnostics(source: string): { cst: CST.Document; diagnostics: Diagnostic[] } {
  const parseResult = parseSource(source);
  const parseErrors = parseResult.diagnostics.filter((d) => d.severity === "error");
  if (parseErrors.length > 0) {
    throw new PipelineError(
      `Parse failed: ${parseErrors[0]?.message ?? "unknown error"}`,
      parseResult.diagnostics
    );
  }
  return { cst: parseResult.cst, diagnostics: parseResult.diagnostics };
}

/**
 * Throw if any diagnostics are errors.
 */
function throwOnBindErrors(allDiagnostics: Diagnostic[], bindDiagnostics: Diagnostic[]): void {
  const bindErrors = bindDiagnostics.filter((d) => d.severity === "error");
  if (bindErrors.length > 0) {
    throw new PipelineError(
      `Binding failed: ${bindErrors[0]?.message ?? "unknown error"}`,
      allDiagnostics
    );
  }
}

/**
 * Build bind options with source loader and include root.
 */
function buildBindOptions(
  options: Pick<CompileOptions, "sourcePath" | "loadFile" | "includeRoot">
): {
  sourceLoader: SourceLoader;
  includeRoot: string | undefined;
  bindOptions: Parameters<typeof bind>[1];
} {
  const sourceLoader: SourceLoader = options.loadFile
    ?? (async (path: string) => Bun.file(path).text());
  const includeRoot = options.sourcePath
    ? (options.includeRoot ?? defaultIncludeRoot(options.sourcePath))
    : options.includeRoot;

  return {
    sourceLoader,
    includeRoot,
    bindOptions: {
      sourcePath: options.sourcePath,
      includeRoot,
      loadFile: async (path: string) => parseSource(await sourceLoader(path)),
    },
  };
}

/**
 * Run pipeline up to (and including) the specified stage.
 * Throws on errors in parse/bind stages.
 */
async function runPipelineTo(
  source: string,
  stopAt: PipelineStage,
  options: CompileOptions = {}
): Promise<PipelineState> {
  const state: PipelineState = { diagnostics: [] };

  // Phase 1: Parse
  const { cst, diagnostics: parseDiagnostics } = parseWithDiagnostics(source);
  state.diagnostics.push(...parseDiagnostics);
  state.cst = cst;
  
  if (stopAt === "parse") return state;

  // Phase 2: Bind
  const { sourceLoader, includeRoot, bindOptions } = buildBindOptions(options);
  const bindResult = await bind(state.cst, bindOptions);
  state.diagnostics.push(...bindResult.diagnostics);
  state.symbols = bindResult.symbols;
  throwOnBindErrors(state.diagnostics, bindResult.diagnostics);
  
  if (stopAt === "bind") return state;

  // Phase 3: Evaluate
  const evalResult = await evaluate(state.cst, state.symbols, {
    variables: options.variables,
    sourcePath: options.sourcePath,
    includeRoot,
    loadFile: sourceLoader,
  });
  state.diagnostics.push(...evalResult.diagnostics);
  state.document = evalResult.document;
  
  if (stopAt === "evaluate") return state;

  // Phase 4: Style
  // Merge @document layout metadata into style options (document wins over caller defaults)
  const layout = state.document.metadata.layout;
  const mergedStyleOptions: StyleOptions = {
    ...options.style,
    ...(layout?.pageSize?.width ? { pageWidth: layout.pageSize.width } : {}),
    ...(layout?.pageSize?.height ? { pageHeight: layout.pageSize.height } : {}),
    ...(layout?.margins ? {
      margins: {
        ...options.style?.margins,
        ...layout.margins,
      },
    } : {}),
    ...(layout?.orientation ? { orientation: layout.orientation } : {}),
  };
  const styleResult = style(
    state.document,
    mergedStyleOptions
  );
  state.diagnostics.push(...styleResult.diagnostics);
  state.styledDocument = styleResult.styledDocument;

  return state;
}

// =============================================================================
// Main Pipeline Functions
// =============================================================================

/**
 * Compile LDOC source to DOCX buffer.
 * 
 * This is the high-level API for the full pipeline.
 * 
 * @param source - LDOC source code
 * @param options - Compilation options
 * @returns DOCX buffer and diagnostics
 * @throws Error if compilation fails
 */
export async function compile(
  source: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  // Run pipeline through style phase
  const state = await runPipelineTo(source, "style", options);
  
  // Phase 5: Emit (async)
  const emitResult = await emit(state.styledDocument!, options.emit);
  state.diagnostics.push(...emitResult.diagnostics);
  
  return {
    buffer: emitResult.buffer,
    diagnostics: state.diagnostics,
  };
}

/**
 * Try to compile, returning a result object instead of throwing.
 * 
 * Useful for CLI/LSP where you want to handle errors gracefully.
 */
export async function tryCompile(
  source: string,
  options: CompileOptions = {}
): Promise<PipelineResult<CompileResult>> {
  try {
    const result = await compile(source, options);
    return { ok: true, value: result, diagnostics: result.diagnostics };
  } catch (error) {
    const diagnostics = error instanceof PipelineError ? error.diagnostics : [];
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
      diagnostics,
    };
  }
}

// =============================================================================
// Partial Pipeline (for tooling)
// =============================================================================

/**
 * Parse and bind only (single-document, no include loading).
 */
export function parseAndBind(
  source: string
): { cst: CST.Document; symbols: SymbolTable; diagnostics: Diagnostic[] } {
  const { cst, diagnostics } = parseWithDiagnostics(source);

  const bindResult = bindSync(cst);
  diagnostics.push(...bindResult.diagnostics);
  throwOnBindErrors(diagnostics, bindResult.diagnostics);

  return {
    cst,
    symbols: bindResult.symbols,
    diagnostics,
  };
}

/**
 * Parse and bind with include resolution.
 *
 * Use this for file-backed workflows (CLI/LSP) where @include diagnostics
 * should match full compile behavior.
 */
export async function parseAndBindWithIncludes(
  source: string,
  options: Pick<CompileOptions, "sourcePath" | "loadFile" | "includeRoot"> = {},
): Promise<{ cst: CST.Document; symbols: SymbolTable; diagnostics: Diagnostic[] }> {
  const { cst, diagnostics } = parseWithDiagnostics(source);

  const { bindOptions } = buildBindOptions(options);
  const bindResult = await bind(cst, bindOptions);
  diagnostics.push(...bindResult.diagnostics);
  throwOnBindErrors(diagnostics, bindResult.diagnostics);

  return {
    cst,
    symbols: bindResult.symbols,
    diagnostics,
  };
}

/**
 * Full pipeline up to Document IR (no DOCX generation).
 * Useful for testing and tooling.
 */
export async function compileToDocument(
  source: string,
  options: CompileOptions = {}
): Promise<{ document: Document; diagnostics: Diagnostic[] }> {
  const state = await runPipelineTo(source, "evaluate", options);
  return {
    document: state.document!,
    diagnostics: state.diagnostics,
  };
}

/**
 * Full pipeline up to StyledDocument (no DOCX packing).
 * Useful for testing style resolution.
 */
export async function compileToStyledDocument(
  source: string,
  options: CompileOptions = {}
): Promise<{ styledDocument: StyledDocument; diagnostics: Diagnostic[] }> {
  const state = await runPipelineTo(source, "style", options);
  return {
    styledDocument: state.styledDocument!,
    diagnostics: state.diagnostics,
  };
}
