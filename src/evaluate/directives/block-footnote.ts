/**
 * @footnote block directive handler.
 *
 * Handles structural @footnote{...} — evaluates body blocks,
 * allocates a label, and returns a single Footnote block node.
 */

import type { Block, Footnote } from "../../types/document-ir.ts";
import type { BlockDirectiveHandler } from "../handler.ts";

export const handleBlockFootnote: BlockDirectiveHandler = async (node, ctx) => {
  if (!node.body || node.body.kind !== "StructuralBody") {
    return [];
  }

  const content = await ctx.evaluateBlocks(node.body.children);
  const label = ctx.allocateFootnoteLabel();

  const footnote: Footnote = {
    type: "Footnote",
    label,
    content,
    loc: node.loc,
  };

  return [footnote as Block];
};
