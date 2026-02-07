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
 */

export { evaluate, type EvaluateOptions, type SourceLoader } from "./evaluator.ts";
export { parseDocumentConfig, configToPageLayout, type DocumentConfig, type StyleConfig } from "./document-config.ts";
