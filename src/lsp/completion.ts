/**
 * LSP Completion Provider — directive and symbol completion.
 *
 * STUBBED for v3 migration (commit 9.1).
 * Context detection is simplified; old CST types removed.
 * Will be enhanced once core stabilizes.
 */

import {
  CompletionItemKind,
  InsertTextFormat,
  type CompletionItem,
  type Position,
} from "vscode-languageserver";
import type { CSTDocument } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";

// =============================================================================
// Completion Context Types
// =============================================================================

export type CompletionContext =
  | { kind: "directive"; prefix: string }
  | { kind: "none" };

export interface CompletionOptions {
  snippetSupport: boolean;
}

// =============================================================================
// Context Detection
// =============================================================================

/**
 * Detect completion context using text-based heuristics.
 *
 * SIMPLIFIED for v3 stub — only detects directive completion.
 */
export function getCompletionContext(
  _cst: CSTDocument,
  position: Position,
  text: string
): CompletionContext {
  return detectFromText(text, position);
}

/**
 * Text-based detection for completion context.
 */
function detectFromText(text: string, position: Position): CompletionContext {
  const lines = text.split("\n");
  const line = lines[position.line] ?? "";
  const before = line.slice(0, position.character);

  // Directive: @ at line start or after whitespace
  const atMatch = before.match(/@([A-Za-z_][A-Za-z0-9_]*)?$/);
  if (atMatch) {
    return { kind: "directive", prefix: atMatch[1] ?? "" };
  }

  return { kind: "none" };
}

// =============================================================================
// Completion Item Generation
// =============================================================================

/**
 * Generate completion items for a given context.
 */
export function getCompletionItems(
  ctx: CompletionContext,
  _symbols: SymbolTable,
  options: CompletionOptions
): CompletionItem[] {
  switch (ctx.kind) {
    case "directive":
      return completeDirectives(ctx.prefix, options);
    case "none":
      return [];
  }
}

function completeDirectives(prefix: string, options: CompletionOptions): CompletionItem[] {
  const items: CompletionItem[] = [];
  const snippet = options.snippetSupport;

  for (const d of DIRECTIVES) {
    if (prefix && !d.name.startsWith(prefix)) continue;

    const useSnippet = d.snippet && snippet;
    items.push({
      label: `@${d.name}`,
      kind: d.kind,
      detail: d.detail,
      insertText: useSnippet ? d.snippet : `@${d.name}`,
      insertTextFormat: useSnippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    });
  }

  return items;
}

// =============================================================================
// Constants
// =============================================================================

interface DirectiveInfo {
  name: string;
  kind: CompletionItemKind;
  detail: string;
  snippet?: string;
}

const DIRECTIVES: DirectiveInfo[] = [
  // Structure
  { name: "document", kind: CompletionItemKind.Struct, detail: "Document configuration" },
  { name: "def", kind: CompletionItemKind.Function, detail: "Define bindings" },
  { name: "include", kind: CompletionItemKind.Module, detail: "Include another .ldoc file" },
  { name: "style", kind: CompletionItemKind.Operator, detail: "Apply styling" },
  { name: "lua", kind: CompletionItemKind.Keyword, detail: "Lua statement block" },

  // Layout
  { name: "pagebreak", kind: CompletionItemKind.Keyword, detail: "Page break" },
  { name: "columns", kind: CompletionItemKind.Keyword, detail: "Columns region" },
  { name: "break", kind: CompletionItemKind.Keyword, detail: "Column break" },
  { name: "header", kind: CompletionItemKind.Keyword, detail: "Page header" },
  { name: "footer", kind: CompletionItemKind.Keyword, detail: "Page footer" },
  { name: "anchor", kind: CompletionItemKind.Reference, detail: "Cross-reference anchor" },
  { name: "table", kind: CompletionItemKind.Keyword, detail: "Table block" },
  { name: "box", kind: CompletionItemKind.Keyword, detail: "Box block" },
  { name: "align", kind: CompletionItemKind.Keyword, detail: "Alignment block" },
];
