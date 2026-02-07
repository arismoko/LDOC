/**
 * @style block directive handler.
 */

import type { Block } from "../../types/document-ir.ts";
import type { ArgsObject } from "../../shared/args.ts";
import type { JSON5Value } from "../../shared/args.ts";
import type { BlockDirectiveHandler } from "../handler.ts";
import { resolveStyleRef, paragraphStyleRefFromArgs } from "./shared/style.ts";

export const handleBlockStyle: BlockDirectiveHandler = async (node, ctx) => {
  const inner = node.body && node.body.kind === "StructuralBody" ? await ctx.evaluateBlocks(node.body.children) : [];
  const args = node.args ?? {};

  // Resolve ref from @def bindings (Spec §10.4)
  const { runChannel, pChannel, refResolved } = resolveStyleRef(args, ctx, node.loc);

  // Build the StyleRef with resolved channels.
  // When ref resolved to a @def, omit ref so p.use can provide the style name.
  // When ref didn't resolve (no def found), keep it as a named style reference.
  const resolvedArgs: ArgsObject = {
    ...args,
    r: runChannel as JSON5Value,
    p: pChannel as JSON5Value,
  };
  if (refResolved) {
    delete resolvedArgs.ref;
  }
  const styleRef = paragraphStyleRefFromArgs(resolvedArgs);
  if (!styleRef) {
    return inner;
  }

  return inner.map((block) => {
    if (block.type !== "Paragraph" && block.type !== "Heading") {
      return block;
    }

    return {
      ...block,
      style: styleRef,
    };
  });
};
