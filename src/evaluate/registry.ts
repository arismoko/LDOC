/**
 * Directive handler registry — maps directive names to handlers.
 * Separate registries for block and inline directives.
 */

import type { BlockDirectiveHandler, InlineDirectiveHandler } from "./handler.ts";

import { handleDocument } from "./directives/block-document.ts";
import { handleDef, handlePagebreak, handleBreak, handleParams, handleAnchor } from "./directives/block-basic.ts";
import { handleLua } from "./directives/block-lua.ts";
import { handleColumns } from "./directives/block-columns.ts";
import { handleBox } from "./directives/block-box.ts";
import { handleAlign } from "./directives/block-align.ts";
import { handleHeader, handleFooter } from "./directives/block-header-footer.ts";
import { handleInclude } from "./directives/block-include.ts";
import { handleTable } from "./directives/block-table.ts";
import { handleBlockStyle } from "./directives/block-style.ts";

import { handleInlineRef } from "./directives/inline-ref.ts";
import { handleInlineStyle } from "./directives/inline-style.ts";

const blockHandlers: Record<string, BlockDirectiveHandler> = {
  document: handleDocument,
  def: handleDef,
  pagebreak: handlePagebreak,
  anchor: handleAnchor,
  break: handleBreak,
  params: handleParams,
  lua: handleLua,
  columns: handleColumns,
  box: handleBox,
  align: handleAlign,
  header: handleHeader,
  footer: handleFooter,
  include: handleInclude,
  style: handleBlockStyle,
  table: handleTable,
};

const inlineHandlers: Record<string, InlineDirectiveHandler> = {
  ref: handleInlineRef,
  style: handleInlineStyle,
};

export const blockDefaultHandler: BlockDirectiveHandler = async (node, ctx) => {
  if (!node.body) return [];
  return ctx.evaluateBlocks(node.body.children);
};

export const inlineDefaultHandler: InlineDirectiveHandler = async (_node, bodyInlines) => {
  return bodyInlines;
};

export function getBlockDirectiveHandler(name: string): BlockDirectiveHandler {
  return blockHandlers[name] ?? blockDefaultHandler;
}

export function getInlineDirectiveHandler(name: string): InlineDirectiveHandler {
  return inlineHandlers[name] ?? inlineDefaultHandler;
}
