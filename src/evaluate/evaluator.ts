/**
 * Main evaluator - transforms bound CST to Document IR.
 *
 * STUBBED for v3 migration (commit 9.1).
 * Will be fully rewritten in commit 15.
 */

import type { CSTDocument, CSTNode } from "../types/cst.ts";
import type {
  Document,
  DocumentMetadata,
  Block,
  Footnote,
  EvaluateResult,
} from "../types/document-ir.ts";
import type { SymbolTable } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";

/**
 * Evaluation context passed through the transform.
 */
export interface EvaluatorContext {
  symbols: SymbolTable;
  globals: Record<string, unknown>;
  locals: Record<string, unknown>;
  diagnostics: Diagnostic[];
  metadata: DocumentMetadata;
  footnotes: Footnote[];
  depth: number;
  maxDepth: number;
  maxIterations: number;
}

/**
 * Function type for recursive node transformation.
 */
export type TransformFunction = (node: CSTNode, ctx: EvaluatorContext) => Block[];

/**
 * Options for the evaluator.
 */
export interface EvaluateOptions {
  /** Initial variables */
  variables?: Record<string, unknown>;
  /** Maximum evaluation depth */
  maxDepth?: number;
  /** Maximum iterations for loops */
  maxIterations?: number;
}

/**
 * Evaluate a bound CST document.
 *
 * STUBBED — returns an empty Document IR.
 * Will be rewritten in commit 15 with Lua runtime.
 */
export function evaluate(
  _cst: CSTDocument,
  _symbols: SymbolTable,
  _options: EvaluateOptions = {}
): EvaluateResult {
  const document: Document = {
    type: "Document",
    metadata: { custom: {} },
    blocks: [],
  };

  return {
    document,
    diagnostics: [],
  };
}
