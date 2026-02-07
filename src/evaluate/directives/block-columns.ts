/**
 * @columns directive handler.
 */

import type { Directive } from "../../types/cst.ts";
import type { BlockDirectiveHandler, EvalContext } from "../handler.ts";
import type { ArgsObject } from "../../shared/args.ts";
import {
  DiagnosticCode,
  warning as createWarning,
} from "../../types/diagnostics.ts";
import { parseLengthToTwips } from "../../shared/units.ts";

const DEFAULT_COLUMNS_COUNT = 2;
const DEFAULT_COLUMN_GAP_TWIPS = 720;

function parseColumnsArgs(args: ArgsObject, ctx: EvalContext, loc: Directive["loc"]): { count: number; space: number } {
  let count = DEFAULT_COLUMNS_COUNT;
  if (typeof args.count === "number" && Number.isFinite(args.count) && args.count >= 1) {
    count = Math.floor(args.count);
  } else if (args.count !== undefined) {
    ctx.diagnostics.push(
      createWarning(
        DiagnosticCode.PARSE_ERROR,
        "@columns count must be a positive number",
        loc,
      ),
    );
  }

  let space = DEFAULT_COLUMN_GAP_TWIPS;
  const rawGap = args.gap ?? args.space;
  if (typeof rawGap === "number" && Number.isFinite(rawGap) && rawGap >= 0) {
    space = Math.round(rawGap);
  } else if (typeof rawGap === "string") {
    try {
      space = parseLengthToTwips(rawGap);
    } catch {
      ctx.diagnostics.push(
        createWarning(
          DiagnosticCode.PARSE_ERROR,
          "@columns gap must be a valid length string (for example \"0.5in\")",
          loc,
        ),
      );
    }
  } else if (rawGap !== undefined) {
    ctx.diagnostics.push(
      createWarning(
        DiagnosticCode.PARSE_ERROR,
        "@columns gap must be a number (twips) or length string",
        loc,
      ),
    );
  }

  return { count, space };
}

export const handleColumns: BlockDirectiveHandler = async (node, ctx) => {
  const args = node.args ?? {};
  const { count, space } = parseColumnsArgs(args, ctx, node.loc);
  const content = node.body ? await ctx.evaluateBlocks(node.body.children) : [];
  return [{
    type: "Section",
    columns: { count, space },
    content,
    loc: node.loc,
  }];
};
