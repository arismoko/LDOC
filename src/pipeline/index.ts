/**
 * LDOC Pipeline - Complete compilation from source to DOCX.
 * 
 * Orchestrates: PARSE → BIND → EVALUATE → STYLE → EMIT
 */

import { parseSource } from "../parse/index.ts";
import { bindSync } from "../bind/index.ts";
import { evaluate } from "../evaluate/index.ts";
import { style, type StyleOptions } from "../style/index.ts";
import { emit, type EmitOptions } from "../emit/index.ts";
import type { CSTDocument } from "../types/cst.ts";
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
  cst?: CSTDocument;
  symbols?: SymbolTable;
  document?: Document;
  styledDocument?: StyledDocument;
}

type PipelineStage = "parse" | "bind" | "evaluate" | "style";

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
  const parseResult = parseSource(source);
  state.diagnostics.push(...parseResult.diagnostics);
  state.cst = parseResult.cst;
  
  const parseErrors = parseResult.diagnostics.filter(d => d.severity === "error");
  if (parseErrors.length > 0) {
    throw new Error(`Parse failed: ${parseErrors[0]?.message ?? "unknown error"}`);
  }
  
  if (stopAt === "parse") return state;

  // Phase 2: Bind
  const bindResult = bindSync(state.cst);
  state.diagnostics.push(...bindResult.diagnostics);
  state.symbols = bindResult.symbols;
  
  const bindErrors = bindResult.diagnostics.filter(d => d.severity === "error");
  if (bindErrors.length > 0) {
    throw new Error(`Binding failed: ${bindErrors[0]?.message ?? "unknown error"}`);
  }
  
  if (stopAt === "bind") return state;

  // Phase 3: Evaluate
  const evalResult = await evaluate(state.cst, state.symbols, {
    variables: options.variables,
  });
  state.diagnostics.push(...evalResult.diagnostics);
  state.document = evalResult.document;
  
  if (stopAt === "evaluate") return state;

  // Phase 4: Style
  const styleResult = style(
    state.document,
    state.symbols,
    options.style
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
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
      diagnostics: [],
    };
  }
}

// =============================================================================
// Partial Pipeline (for tooling)
// =============================================================================

/**
 * Parse and bind only (for LSP/validation).
 */
export function parseAndBind(
  source: string
): { cst: CSTDocument; symbols: SymbolTable; diagnostics: Diagnostic[] } {
  const state: PipelineState = { diagnostics: [] };

  const parseResult = parseSource(source);
  state.diagnostics.push(...parseResult.diagnostics);
  state.cst = parseResult.cst;

  const parseErrors = parseResult.diagnostics.filter((d) => d.severity === "error");
  if (parseErrors.length > 0) {
    throw new Error(`Parse failed: ${parseErrors[0]?.message ?? "unknown error"}`);
  }

  const bindResult = bindSync(state.cst);
  state.diagnostics.push(...bindResult.diagnostics);
  state.symbols = bindResult.symbols;

  const bindErrors = bindResult.diagnostics.filter((d) => d.severity === "error");
  if (bindErrors.length > 0) {
    throw new Error(`Binding failed: ${bindErrors[0]?.message ?? "unknown error"}`);
  }

  return {
    cst: state.cst!,
    symbols: state.symbols!,
    diagnostics: state.diagnostics,
  };
}

/**
 * Full pipeline up to Document IR (no DOCX generation).
 * Synchronous - useful for testing and tooling.
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
 * Synchronous - useful for testing style resolution.
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
