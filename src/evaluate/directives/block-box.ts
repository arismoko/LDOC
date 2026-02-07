/**
 * @box directive handler.
 */

import type { BlockDirectiveHandler } from "../handler.ts";

export const handleBox: BlockDirectiveHandler = async (node, ctx) => {
  const content = node.body ? await ctx.evaluateBlocks(node.body.children) : [];
  return [{
    type: "Blockquote",
    content,
    loc: node.loc,
  }];
};
