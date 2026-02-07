/**
 * @lua directive handler.
 */

import type { Directive } from "../../types/cst.ts";
import type { BlockDirectiveHandler, EvalContext } from "../handler.ts";
import {
  DiagnosticCode,
  error as createError,
  warning as createWarning,
} from "../../types/diagnostics.ts";
import { execute as executeLua } from "../lua/runtime.ts";

async function executeLuaDirective(node: Directive, ctx: EvalContext): Promise<void> {
  if (!node.body || node.body.children.length === 0) {
    return;
  }

  if (
    node.body.children.length !== 1 ||
    node.body.children[0]?.kind !== "ParagraphBlock"
  ) {
    ctx.diagnostics.push(
      createWarning(
        DiagnosticCode.PARSE_ERROR,
        "@lua body could not be interpreted as a Lua chunk",
        node.loc,
      ),
    );
    return;
  }

  const paragraph = node.body.children[0];
  const chunk = paragraph.inlines
    .map((inline) => (inline.kind === "InlineText" ? inline.text : ""))
    .join("");

  try {
    await executeLua(ctx.luaEngine, chunk);
  } catch (cause) {
    ctx.diagnostics.push(
      createError(
        DiagnosticCode.EXPRESSION_ERROR,
        `Lua chunk failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        node.loc,
      ),
    );
  }
}

export const handleLua: BlockDirectiveHandler = async (node, ctx) => {
  await executeLuaDirective(node, ctx);
  return [];
};
