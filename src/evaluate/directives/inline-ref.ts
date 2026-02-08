/**
 * @ref inline directive handler.
 */

import type { Inline } from "../../types/document-ir.ts";
import type { InlineDirectiveHandler } from "../handler.ts";
import {
  DiagnosticCode,
  warning as createWarning,
} from "../../types/diagnostics.ts";
import { flattenInlineText } from "./shared/inline-text.ts";

export const handleInlineRef: InlineDirectiveHandler = async (node, bodyInlines, ctx) => {
  const args = node.args ?? {};
  const id = typeof args.id === "string" ? args.id : undefined;
  if (!id) {
    ctx.diagnostics.push(
      createWarning(DiagnosticCode.PARSE_ERROR, `@ref requires id argument`, node.loc),
    );
    return bodyInlines;
  }
  const text = bodyInlines.length > 0
    ? flattenInlineText(bodyInlines)
    : undefined;
  return [{
    type: "CrossRef",
    target: id,
    text: text || undefined,
    loc: node.loc,
  }] as Inline[];
};
