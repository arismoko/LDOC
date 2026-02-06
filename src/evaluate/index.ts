/**
 * Phase 3: EVALUATE
 *
 * Transforms bound CST to Document IR by:
 * - Evaluating Lua expressions ($())
 * - Executing Lua statement blocks (@lua{})
 * - Resolving variables
 * - Processing @def bindings
 *
 * Output: Document IR with NO DIRECTIVES remaining - only content.
 *
 * LEGACY: Control flow directives (@if, @foreach, @repeat) are removed.
 * Use Lua runtime instead via @lua{} blocks.
 */

export { evaluate, type EvaluateOptions, type EvaluatorContext } from "./evaluator.ts";
export { evalCondition, truthy, resolveVariable } from "./expressions.ts";
export { resolveInterpolation, interpolateString } from "./interpolation.ts";
export { parseDocumentConfig, configToPageLayout, type DocumentConfig, type StyleConfig } from "./document-config.ts";
// parseLengthToTwips is exported from shared/units.ts — don't re-export here

// LEGACY / REMOVED - Use Lua runtime instead
// export { processIf, processForeach, processRepeat } from "./control-flow.ts";
