/**
 * @footnote inline directive handler.
 *
 * Handles inline @footnote{...} / @footnote[...] — converts body inlines
 * into a paragraph, queues a deferred Footnote block, and returns a
 * FootnoteRef inline pointing to the queued label.
 */

import type { Inline } from "../../types/document-ir.ts";
import type { InlineDirectiveHandler } from "../handler.ts";

export const handleInlineFootnote: InlineDirectiveHandler = async (node, bodyInlines, ctx) => {
  if (!node.body) {
    // No body — validator handles diagnostic
    return [];
  }

  // Wrap evaluated body inlines into a single paragraph block
  const content = [{
    type: "Paragraph" as const,
    content: bodyInlines,
    loc: node.loc,
  }];

  const label = ctx.queueFootnote(content, node.loc);

  return [{
    type: "FootnoteRef",
    label,
    loc: node.loc,
  }] as Inline[];
};
