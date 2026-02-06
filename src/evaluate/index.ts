/**
 * Phase 3: EVALUATE
 * 
 * Transforms bound CST to Document IR by:
 * - Expanding @use macros
 * - Evaluating @if/@elseif/@else conditions
 * - Expanding @foreach/@repeat loops
 * - Resolving {{variable}} interpolations
 * - Processing @set directives
 * 
 * Output: Document IR with NO DIRECTIVES remaining - only content.
 */

export { Evaluator, evaluate, type EvaluateOptions, type EvaluatorContext } from "./evaluator.ts";
export { evalCondition, truthy, resolveVariable } from "./expressions.ts";
export { resolveInterpolation, interpolateString } from "./interpolation.ts";
export { parseDocumentConfig, configToPageLayout, parseLengthToTwips, type DocumentConfig, type StyleConfig } from "./document-config.ts";
