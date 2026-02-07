/**
 * @align directive handler.
 */

import type { BlockDirectiveHandler } from "../handler.ts";
import { applyAlignmentToBlocks, type HorizontalAlign } from "./shared/alignment.ts";
import {
  DiagnosticCode,
  warning as createWarning,
} from "../../types/diagnostics.ts";

export const handleAlign: BlockDirectiveHandler = async (node, ctx) => {
  const args = node.args ?? {};
  const value = args.value;
  const align: HorizontalAlign = value === "left" || value === "center" || value === "right"
    ? value
    : "left";

  if (value !== undefined && value !== "left" && value !== "center" && value !== "right") {
    ctx.diagnostics.push(
      createWarning(
        DiagnosticCode.PARSE_ERROR,
        "@align value must be one of: left, center, right",
        node.loc,
      ),
    );
  }

  const inner = node.body ? await ctx.evaluateBlocks(node.body.children) : [];
  return applyAlignmentToBlocks(inner, align);
};
