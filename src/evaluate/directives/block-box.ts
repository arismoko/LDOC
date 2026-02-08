/**
 * @box directive handler.
 *
 * Emits a Box IR node — a visual container with borders on all four sides.
 * Distinct from @blockquote which uses left-border-only quote styling.
 */

import type { BlockDirectiveHandler } from "../handler.ts";

export const handleBox: BlockDirectiveHandler = async (node, ctx) => {
  const content = node.body && node.body.kind === "StructuralBody" ? await ctx.evaluateBlocks(node.body.children) : [];
  return [{
    type: "Box",
    content,
    loc: node.loc,
  }];
};
