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

  if (node.body.kind !== "RawBody") {
    // Parser rejects @lua[...] sugar and always produces RawBody for @lua{...}.
    // If we somehow get a non-RawBody, it's a pipeline invariant violation.
    ctx.diagnostics.push(
      createError(
        DiagnosticCode.PARSE_ERROR,
        `Internal invariant violation: @lua body must be RawBody, got ${node.body.kind}. Lua block was not executed.`,
        node.loc,
      ),
    );
    return;
  }

  const chunk = node.body.text;

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
