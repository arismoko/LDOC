/**
 * Shared container directive handler factory.
 *
 * Eliminates DRY violation between @box and @blockquote handlers,
 * which are structurally identical except for the emitted IR type.
 */

import type { Block } from "../../types/document-ir.ts";
import type { BlockDirectiveHandler } from "../handler.ts";

/**
 * Create a block directive handler that wraps body content in a container IR node.
 * Used by @box (emits "Box") and @blockquote (emits "Blockquote").
 */
export function makeContainerHandler(type: "Box" | "Blockquote"): BlockDirectiveHandler {
  return async (node, ctx) => {
    const content = node.body && node.body.kind === "StructuralBody"
      ? await ctx.evaluateBlocks(node.body.children)
      : [];
    return [{ type, content, loc: node.loc } as Block];
  };
}
