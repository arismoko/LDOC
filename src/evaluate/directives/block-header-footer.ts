/**
 * @header and @footer directive handlers.
 */

import type * as CST from "../../types/cst.ts";
import type { Directive } from "../../types/cst.ts";
import type { Block, HeaderFooter } from "../../types/document-ir.ts";
import type { BlockDirectiveHandler, EvalContext } from "../handler.ts";
import { alignmentFromRegion, applyAlignmentToBlocks } from "./shared/alignment.ts";

function isHeaderFooterRegionDirective(node: CST.Block): node is Directive & { name: "left" | "center" | "right" } {
  return node.kind === "Directive" && (node.name === "left" || node.name === "center" || node.name === "right");
}

async function evaluateHeaderFooter(node: Directive, kind: HeaderFooter["kind"], ctx: EvalContext): Promise<void> {
  const content: Block[] = [];

  if (node.body) {
    for (const child of node.body.children) {
      if (isHeaderFooterRegionDirective(child)) {
        const regionBlocks = child.body ? await ctx.evaluateBlocks(child.body.children) : [];
        content.push(...applyAlignmentToBlocks(regionBlocks, alignmentFromRegion(child.name)));
        continue;
      }

      content.push(...(await ctx.evaluateBlock(child)));
    }
  }

  const headerFooter: HeaderFooter = {
    type: "HeaderFooter",
    kind,
    content,
    loc: node.loc,
  };

  if (kind === "header") {
    ctx.metadata.headers = {
      ...(ctx.metadata.headers ?? {}),
      default: headerFooter,
    };
    return;
  }

  ctx.metadata.footers = {
    ...(ctx.metadata.footers ?? {}),
    default: headerFooter,
  };
}

export const handleHeader: BlockDirectiveHandler = async (node, ctx) => {
  await evaluateHeaderFooter(node, "header", ctx);
  return [];
};

export const handleFooter: BlockDirectiveHandler = async (node, ctx) => {
  await evaluateHeaderFooter(node, "footer", ctx);
  return [];
};
