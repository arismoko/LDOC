/**
 * Macro expansion: @use, @slot, @set
 *
 * STUBBED for v3 migration (commit 9.1).
 * Will be rewritten when evaluator is rewritten (commit 15).
 */

import type { CSTDirective } from "../types/cst.ts";
import type { Block } from "../types/document-ir.ts";
import type { EvaluatorContext, TransformFunction } from "./evaluator.ts";

/**
 * Process @use directive - expand macro.
 *
 * STUBBED — throws error. Macros replaced by @def in v3.
 */
export function processUse(
  _directive: CSTDirective,
  _ctx: EvaluatorContext,
  _transform: TransformFunction
): Block[] {
  throw new Error("@use directive is not supported in v3. Use @def instead.");
}

/**
 * Process @slot directive - inject children from @use.
 *
 * STUBBED — throws error.
 */
export function processSlot(
  _directive: CSTDirective,
  _ctx: EvaluatorContext,
  _transform: TransformFunction
): Block[] {
  throw new Error("@slot directive is not supported in v3.");
}

/**
 * Process @set directive - update context variables.
 *
 * STUBBED — no-op.
 */
export function processSet(
  _directive: CSTDirective,
  _ctx: EvaluatorContext
): void {
  // No-op in v3 stub
}
