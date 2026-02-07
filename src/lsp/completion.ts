/**
 * LSP Completion Provider — directive and symbol completion.
 */

import {
  CompletionItemKind,
  InsertTextFormat,
  type CompletionItem,
  type Position,
} from "vscode-languageserver";
import type { Document } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { knownDirectiveNames } from "../bind/contracts.ts";

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
 */
export function getCompletionContext(
  _cst: Document,
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

  for (const name of knownDirectiveNames()) {
    if (prefix && !name.startsWith(prefix)) continue;
    const metadata = DIRECTIVE_INFO[name];
    const kind = metadata?.kind ?? CompletionItemKind.Keyword;
    const detail = metadata?.detail ?? "LDOC directive";
    const directiveSnippet = metadata?.snippet;

    const useSnippet = Boolean(directiveSnippet && snippet);
    items.push({
      label: `@${name}`,
      kind,
      detail,
      insertText: useSnippet ? directiveSnippet : `@${name}`,
      insertTextFormat: useSnippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    });
  }

  return items;
}

// =============================================================================
// Constants
// =============================================================================

interface DirectiveInfo {
  kind: CompletionItemKind;
  detail: string;
  snippet?: string;
}

const DIRECTIVE_INFO: Record<string, DirectiveInfo> = {
  document: { kind: CompletionItemKind.Struct, detail: "Document configuration" },
  def: { kind: CompletionItemKind.Function, detail: "Define bindings" },
  include: { kind: CompletionItemKind.Module, detail: "Include another .ldoc file" },
  style: { kind: CompletionItemKind.Operator, detail: "Apply styling" },
  lua: { kind: CompletionItemKind.Keyword, detail: "Lua statement block" },
  pagebreak: { kind: CompletionItemKind.Keyword, detail: "Page break" },
  columns: {
    kind: CompletionItemKind.Keyword,
    detail: "Columns region",
    snippet: '@columns(count: ${1:2}, gap: "${2:0.5in}"){\n  $0\n}',
  },
  break: { kind: CompletionItemKind.Keyword, detail: "Column break" },
  header: {
    kind: CompletionItemKind.Keyword,
    detail: "Page header",
    snippet: "@header{\n  @left[$1]\n}",
  },
  footer: {
    kind: CompletionItemKind.Keyword,
    detail: "Page footer",
    snippet: "@footer{\n  @center[$1]\n}",
  },
  anchor: { kind: CompletionItemKind.Reference, detail: "Cross-reference anchor" },
  table: {
    kind: CompletionItemKind.Keyword,
    detail: "Table block",
    snippet: "@table{\n  @row(cells: [\"$1\"])\n}",
  },
  box: { kind: CompletionItemKind.Keyword, detail: "Box block" },
  align: { kind: CompletionItemKind.Keyword, detail: "Alignment block" },
  params: { kind: CompletionItemKind.Keyword, detail: "Declare include parameters" },
  row: { kind: CompletionItemKind.Keyword, detail: "Table row" },
  left: { kind: CompletionItemKind.Keyword, detail: "Header/footer left region" },
  center: { kind: CompletionItemKind.Keyword, detail: "Header/footer center region" },
  right: { kind: CompletionItemKind.Keyword, detail: "Header/footer right region" },
};
