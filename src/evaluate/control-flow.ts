/**
 * Control flow handling: @if, @elseif, @else, @foreach, @repeat
 *
 * LEGACY / UNUSED IN V3 - This entire module is deprecated.
 * Lua runtime will handle logic via @lua{}.
 *
 * Stub implementations that throw errors if called.
 */

import type { CSTNode, CSTDirective } from "../types/cst.ts";
import type { Block } from "../types/document-ir.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { DiagnosticCode, error } from "../types/diagnostics.ts";
import { evalCondition, truthy, resolveVariable } from "./expressions.ts";
import { cloneNodes } from "./utils.ts";
import type { EvaluatorContext, TransformFunction } from "./evaluator.ts";

/**
 * Loop variables available in @foreach.
 */
export interface LoopVariables {
  index: number;   // 0-based
  count: number;   // 1-based
  first: boolean;
  last: boolean;
  length: number;
}

/**
 * Process @if directive with optional @elseif/@else chain.
 *
 * LEGACY / UNUSED IN V3 - Stub that throws error.
 * Lua runtime will handle logic via @lua{}.
 */
export function processIf(
  _directive: any,
  _ctx: EvaluatorContext,
  _transform: TransformFunction
): Block[] {
  throw new Error("@if directive is not supported in v3. Use @lua{} instead.");
}

/**
 * Process @foreach directive.
 *
 * LEGACY / UNUSED IN V3 - Stub that throws error.
 * Lua runtime will handle logic via @lua{}.
 */
export function processForeach(
  _directive: any,
  _ctx: EvaluatorContext,
  _transform: TransformFunction
): Block[] {
  throw new Error("@foreach directive is not supported in v3. Use Lua loops instead.");
}

/**
 * Process @repeat directive.
 *
 * LEGACY / UNUSED IN V3 - Stub that throws error.
 * Lua runtime will handle logic via @lua{}.
 */
export function processRepeat(
  _directive: any,
  _ctx: EvaluatorContext,
  _transform: TransformFunction
): Block[] {
  throw new Error("@repeat directive is not supported in v3. Use Lua loops instead.");
}
