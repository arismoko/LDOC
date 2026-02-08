/**
 * @header and @footer directive handlers.
 */

import type * as CST from "../../types/cst.ts";
import type { Directive } from "../../types/cst.ts";
import type { Block, HeaderFooter } from "../../types/document-ir.ts";
import type { BlockDirectiveHandler, EvalContext } from "../handler.ts";
import { DiagnosticCode, warning as createWarning } from "../../types/diagnostics.ts";
import { alignmentFromRegion, applyAlignmentToBlocks } from "./shared/alignment.ts";

type HeaderFooterVariant = "default" | "first" | "even";

function resolveVariant(node: Directive, ctx: EvalContext): HeaderFooterVariant {
  const value = node.args?.variant;
  if (value === undefined) {
    return "default";
  }

  if (value === "default" || value === "first" || value === "even") {
    return value;
  }

  ctx.diagnostics.push(
    createWarning(
      DiagnosticCode.PARSE_ERROR,
      `@${node.name} variant must be one of: \"default\", \"first\", \"even\". Falling back to \"default\"`,
      node.loc,
    ),
  );
  return "default";
}

function warnDuplicateSlot(kind: HeaderFooter["kind"], variant: HeaderFooterVariant, node: Directive, ctx: EvalContext): void {
  const existing = kind === "header"
    ? ctx.metadata.headers?.[variant]
    : ctx.metadata.footers?.[variant];

  if (!existing) {
    return;
  }

  const existingAt = `line ${existing.loc?.line ?? "?"}`;
  ctx.diagnostics.push(
    createWarning(
      DiagnosticCode.PARSE_ERROR,
      `Duplicate @${kind}(variant: \"${variant}\") overrides previous value from ${existingAt}`,
      node.loc,
    ),
  );
}

function isHeaderFooterRegionDirective(node: CST.Block): node is Directive & { name: "left" | "center" | "right" } {
  return node.kind === "Directive" && (node.name === "left" || node.name === "center" || node.name === "right");
}

async function evaluateHeaderFooter(node: Directive, kind: HeaderFooter["kind"], ctx: EvalContext): Promise<void> {
  const variant = resolveVariant(node, ctx);
  const content: Block[] = [];

  if (node.body && node.body.kind === "StructuralBody") {
    for (const child of node.body.children) {
      if (isHeaderFooterRegionDirective(child)) {
        const regionBlocks = child.body && child.body.kind === "StructuralBody" ? await ctx.evaluateBlocks(child.body.children) : [];
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

  warnDuplicateSlot(kind, variant, node, ctx);

  if (kind === "header") {
    ctx.metadata.headers = {
      ...(ctx.metadata.headers ?? {}),
      [variant]: headerFooter,
    };
    return;
  }

  ctx.metadata.footers = {
    ...(ctx.metadata.footers ?? {}),
    [variant]: headerFooter,
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
