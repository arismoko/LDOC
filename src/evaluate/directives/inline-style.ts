/**
 * @style inline directive handler.
 */

import type { Inline, Styled } from "../../types/document-ir.ts";
import type { InlineDirectiveHandler } from "../handler.ts";
import { resolveStyleRef, inlineStyleFromRunChannel } from "./shared/style.ts";

export const handleInlineStyle: InlineDirectiveHandler = async (node, bodyInlines, ctx) => {
  const args = node.args ?? {};

  // Resolve ref from @def bindings (Spec §10.4)
  const { runChannel } = resolveStyleRef(args, ctx, node.loc);

  const inlineStyle = inlineStyleFromRunChannel(runChannel);
  if (Object.keys(inlineStyle).length === 0) {
    return bodyInlines;
  }

  const styled: Styled = {
    type: "Styled",
    content: bodyInlines,
    style: inlineStyle,
    loc: node.loc,
  };

  return [styled];
};
