/**
 * @blockquote directive handler.
 *
 * Emits a Blockquote IR node — quoted content with left-border indent styling.
 * Distinct from @box which uses all-four-sides border styling.
 */

import type { BlockDirectiveHandler } from "../handler.ts";

export const handleBlockquote: BlockDirectiveHandler = async (node, ctx) => {
  const content = node.body && node.body.kind === "StructuralBody" ? await ctx.evaluateBlocks(node.body.children) : [];
  return [{
    type: "Blockquote",
    content,
    loc: node.loc,
  }];
};
