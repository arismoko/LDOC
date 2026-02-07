/**
 * @lua directive handler.
 */

import type { Directive } from "../../types/cst.ts";
import type { BlockDirectiveHandler, EvalContext } from "../handler.ts";
import {
  DiagnosticCode,
  error as createError,
} from "../../types/diagnostics.ts";
import { execute as executeLua } from "../lua/runtime.ts";

async function executeLuaDirective(node: Directive, ctx: EvalContext): Promise<void> {
  if (!node.body) {
    return;
  }

  let chunk: string;

  if (node.body.kind === "RawBody") {
    // Raw body — text was extracted by balanced-brace scanner (Spec §7.2)
    chunk = node.body.text;
  } else {
    // Structural body fallback (shouldn't happen with registry-driven parsing,
    // but handle gracefully for forward compatibility)
    if (
      node.body.children.length !== 1 ||
      node.body.children[0]?.kind !== "ParagraphBlock"
    ) {
      return;
    }
    chunk = node.body.children[0].inlines
      .map((inline) => (inline.kind === "InlineText" ? inline.text : ""))
      .join("");
  }

  if (!chunk.trim()) {
    return;
  }

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
