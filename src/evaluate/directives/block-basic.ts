/**
 * Basic block directive handlers — tiny directives grouped together.
 * Handles: @def, @pagebreak, @break, @params, @anchor
 */

import type { Block } from "../../types/document-ir.ts";
import type { BlockDirectiveHandler } from "../handler.ts";
import {
  DiagnosticCode,
  warning as createWarning,
} from "../../types/diagnostics.ts";

export const handleDef: BlockDirectiveHandler = async (node, ctx) => {
  const args = node.args ?? {};
  for (const [key, value] of Object.entries(args)) {
    // Deep-clone: CST args may share frozen refs with the symbol table
    ctx.defs[key] = structuredClone(value);
  }
  return [];
};

export const handlePagebreak: BlockDirectiveHandler = async (node) => {
  return [{ type: "PageBreak", loc: node.loc }];
};

export const handleBreak: BlockDirectiveHandler = async (node) => {
  return [{ type: "ColumnBreak", loc: node.loc }];
};

export const handleParams: BlockDirectiveHandler = async () => {
  return [];
};

export const handleAnchor: BlockDirectiveHandler = async (node, ctx) => {
  const args = node.args ?? {};
  const id = typeof args.id === "string" ? args.id : undefined;
  if (!id) {
    ctx.diagnostics.push(
      createWarning(DiagnosticCode.PARSE_ERROR, '@anchor requires id: "..."', node.loc),
    );
    return [];
  }
  return [{ type: "Anchor", id, loc: node.loc }];
};
