/**
 * LSP Completion Provider - CST-based completion with text fallback.
 *
 * Uses error-tolerant parser's `incomplete` markers as the primary signal
 * for completion context detection.
 */

import {
  CompletionItemKind,
  InsertTextFormat,
  type CompletionItem,
  type Position,
} from "vscode-languageserver";
import type {
  CSTDocument,
  CSTNode,
  CSTDirective,
  CSTVariable,
  CSTFootnoteRef,
  CSTCrossRef,
  IncompleteMarker,
} from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { findNodeAtPosition } from "./navigation.ts";

// =============================================================================
// Completion Context Types
// =============================================================================

export type CompletionContext =
  | { kind: "directive"; prefix: string }
  | { kind: "macro_name"; prefix: string }
  | { kind: "macro_param"; prefix: string; macroName: string }
  | { kind: "variable"; prefix: string }
  | { kind: "variable_filter"; prefix: string }
  | { kind: "cross_ref"; prefix: string }
  | { kind: "footnote_ref"; prefix: string }
  | { kind: "anchor"; prefix: string }
  | { kind: "none" };

export interface CompletionOptions {
  snippetSupport: boolean;
}

// =============================================================================
// Context Detection (CST-first)
// =============================================================================

/**
 * Detect completion context using CST structure.
 * Primary method: check for incomplete nodes with missing elements.
 * Fallback: text-based detection for edge cases.
 */
export function getCompletionContext(
  cst: CSTDocument,
  position: Position,
  text: string
): CompletionContext {
  // 1. Try CST-based detection first
  const node = findNodeAtPosition(cst, position);

  if (node) {
    // Check for incomplete markers - primary completion signal
    if ("incomplete" in node && node.incomplete) {
      const ctx = contextFromIncompleteNode(node, position, text);
      if (ctx.kind !== "none") return ctx;
    }

    // Check structural context based on node type
    const structural = contextFromNodeType(node, position, text);
    if (structural.kind !== "none") return structural;
  }

  // 2. Text-based fallback for edge cases (cursor in whitespace, typing first char)
  return detectFromText(text, position);
}

/**
 * Extract completion context from a node with `incomplete` marker.
 */
function contextFromIncompleteNode(
  node: CSTNode,
  position: Position,
  text: string
): CompletionContext {
  const incomplete = (node as { incomplete?: IncompleteMarker }).incomplete;
  if (!incomplete) return { kind: "none" };

  const missing = incomplete.missing[0];
  if (!missing) return { kind: "none" };

  switch (node.type) {
    case "Directive": {
      const dir = node as CSTDirective;
      // Inside @use( - offer macro names
      if (dir.name === "use") {
        return { kind: "macro_name", prefix: getPartialArgument(dir, position, text) };
      }
      // Inside @ref( - offer anchors
      if (dir.name === "ref") {
        return { kind: "anchor", prefix: getPartialArgument(dir, position, text) };
      }
      // Missing body for block directive - no completions
      if (missing.kind === "body") {
        return { kind: "none" };
      }
      // Missing closing paren - could be completing argument
      if (missing.kind === "token" && missing.expected === ")") {
        return { kind: "macro_param", prefix: "", macroName: dir.name };
      }
      return { kind: "none" };
    }

    case "Variable": {
      const variable = node as CSTVariable;
      const expr = variable.expression.trim();
      // Check for filter context: {{ value | fil }}
      if (expr.includes("|")) {
        const parts = expr.split("|");
        const filterPrefix = parts[parts.length - 1]?.trim() ?? "";
        return { kind: "variable_filter", prefix: filterPrefix };
      }
      return { kind: "variable", prefix: expr };
    }

    case "FootnoteRef": {
      const fn = node as CSTFootnoteRef;
      return { kind: "footnote_ref", prefix: fn.label };
    }

    case "CrossRef": {
      const cr = node as CSTCrossRef;
      return { kind: "cross_ref", prefix: cr.target };
    }

    default:
      return { kind: "none" };
  }
}

/**
 * Extract context from node type when not explicitly incomplete.
 * Handles cases where cursor is inside a complete node.
 */
function contextFromNodeType(
  node: CSTNode,
  _position: Position,
  _text: string
): CompletionContext {
  switch (node.type) {
    case "Variable": {
      const variable = node as CSTVariable;
      const expr = variable.expression.trim();
      if (expr.includes("|")) {
        const parts = expr.split("|");
        const filterPrefix = parts[parts.length - 1]?.trim() ?? "";
        return { kind: "variable_filter", prefix: filterPrefix };
      }
      return { kind: "variable", prefix: expr };
    }

    case "Directive": {
      const dir = node as CSTDirective;
      // Inside @use directive - could be completing macro name
      if (dir.name === "use" && dir.arguments.length === 0) {
        return { kind: "macro_name", prefix: "" };
      }
      return { kind: "none" };
    }

    default:
      return { kind: "none" };
  }
}

/**
 * Text-based fallback for edge cases.
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

  // Variable: inside {{ }}
  const varStart = before.lastIndexOf("{{");
  const varEnd = before.lastIndexOf("}}");
  if (varStart !== -1 && varStart > varEnd) {
    const inside = before.slice(varStart + 2);
    const pipeIdx = inside.lastIndexOf("|");
    if (pipeIdx !== -1) {
      return { kind: "variable_filter", prefix: inside.slice(pipeIdx + 1).trim() };
    }
    return { kind: "variable", prefix: extractIdentPrefix(inside) };
  }

  // Cross-ref: inside [[ ]]
  const refStart = before.lastIndexOf("[[");
  const refEnd = before.lastIndexOf("]]");
  if (refStart !== -1 && refStart > refEnd) {
    return { kind: "cross_ref", prefix: before.slice(refStart + 2).trim() };
  }

  // Footnote ref: after [^
  const fnMatch = before.match(/\[\^([A-Za-z0-9_]*)$/);
  if (fnMatch) {
    return { kind: "footnote_ref", prefix: fnMatch[1] ?? "" };
  }

  // @use macro name
  const useMatch = before.match(/@use\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)?$/);
  if (useMatch) {
    return { kind: "macro_name", prefix: useMatch[1] ?? "" };
  }

  return { kind: "none" };
}

/**
 * Extract the partial argument being typed in a directive.
 */
function getPartialArgument(dir: CSTDirective, position: Position, text: string): string {
  const lines = text.split("\n");
  const line = lines[position.line] ?? "";
  const before = line.slice(0, position.character);

  // Find content after @name( or last comma
  const parenMatch = before.match(/@\w+\s*\(\s*([^,)]*)$/);
  if (parenMatch) {
    return parenMatch[1]?.trim() ?? "";
  }

  const commaMatch = before.match(/,\s*([^,)]*)$/);
  if (commaMatch) {
    return commaMatch[1]?.trim() ?? "";
  }

  return "";
}

function extractIdentPrefix(s: string): string {
  const m = s.match(/([A-Za-z_][A-Za-z0-9_.]*)$/);
  return m?.[1] ?? "";
}

// =============================================================================
// Completion Item Generation
// =============================================================================

/**
 * Generate completion items for a given context.
 */
export function getCompletionItems(
  ctx: CompletionContext,
  symbols: SymbolTable,
  options: CompletionOptions
): CompletionItem[] {
  switch (ctx.kind) {
    case "directive":
      return completeDirectives(ctx.prefix, options);
    case "macro_name":
      return completeMacroNames(symbols, ctx.prefix);
    case "macro_param":
      return completeMacroParams(symbols, ctx.macroName, ctx.prefix, options);
    case "variable":
      return completeVariables(symbols, ctx.prefix);
    case "variable_filter":
      return completeFilters(ctx.prefix);
    case "cross_ref":
    case "anchor":
      return completeAnchors(symbols, ctx.prefix);
    case "footnote_ref":
      return completeFootnotes(symbols, ctx.prefix);
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

function completeMacroNames(symbols: SymbolTable, prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const [name, macro] of symbols.macros) {
    if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    const params = macro.parameters.map((p) => p.name).join(", ");
    items.push({
      label: name,
      kind: CompletionItemKind.Function,
      detail: `@define(${name}${params ? ", " + params : ""})`,
      insertText: name,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  return items;
}

function completeMacroParams(
  symbols: SymbolTable,
  macroName: string,
  prefix: string,
  options: CompletionOptions
): CompletionItem[] {
  const macro = symbols.macros.get(macroName);
  if (!macro) return [];

  const items: CompletionItem[] = [];
  const snippet = options.snippetSupport;

  for (const param of macro.parameters) {
    if (prefix && !param.name.startsWith(prefix)) continue;

    items.push({
      label: param.name,
      kind: CompletionItemKind.Property,
      detail: `${macroName} parameter`,
      insertText: snippet ? `${param.name}: $1` : `${param.name}: `,
      insertTextFormat: snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    });
  }

  return items;
}

function completeVariables(symbols: SymbolTable, prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  // Variables from symbol table
  for (const [name] of symbols.variables) {
    if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    items.push({
      label: name,
      kind: CompletionItemKind.Variable,
      detail: "Variable",
      insertText: name,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  // Built-in loop variables
  for (const builtin of BUILTIN_VARIABLES) {
    if (prefix && !builtin.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    items.push({
      label: builtin,
      kind: CompletionItemKind.Constant,
      detail: "Built-in",
      insertText: builtin,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  return items;
}

function completeFilters(prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const filter of VARIABLE_FILTERS) {
    if (prefix && !filter.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    items.push({
      label: filter,
      kind: CompletionItemKind.Function,
      detail: "Filter",
      insertText: filter,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  return items;
}

function completeAnchors(symbols: SymbolTable, prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const [name] of symbols.anchors) {
    if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    items.push({
      label: name,
      kind: CompletionItemKind.Reference,
      detail: "Anchor",
      insertText: name,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  return items;
}

function completeFootnotes(symbols: SymbolTable, prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const [label] of symbols.footnotes) {
    if (prefix && !label.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    items.push({
      label,
      kind: CompletionItemKind.Reference,
      detail: "Footnote",
      insertText: label,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  return items;
}

// =============================================================================
// Constants
// =============================================================================

const BUILTIN_VARIABLES = [
  "loop.index",
  "loop.first",
  "loop.last",
  "loop.count",
];

const VARIABLE_FILTERS = ["upper", "lower", "capitalize"];

interface DirectiveInfo {
  name: string;
  kind: CompletionItemKind;
  detail: string;
  snippet?: string;
}

const DIRECTIVES: DirectiveInfo[] = [
  // Structure
  { name: "document", kind: CompletionItemKind.Struct, detail: "Document configuration", snippet: "@document\n\ttitle: \"${1:Title}\"\n\t$0" },
  { name: "meta", kind: CompletionItemKind.Struct, detail: "Metadata block", snippet: "@meta\n\t$0" },
  { name: "import", kind: CompletionItemKind.Module, detail: "Import another .ldoc file" },
  { name: "define", kind: CompletionItemKind.Function, detail: "Define a macro", snippet: "@define(${1:Name})\n\t$0\n@end" },
  { name: "use", kind: CompletionItemKind.Function, detail: "Use a macro", snippet: "@use(${1:Name}$0)" },

  // Control flow
  { name: "if", kind: CompletionItemKind.Keyword, detail: "Conditional block", snippet: "@if(${1:condition})\n\t$0\n@end" },
  { name: "elseif", kind: CompletionItemKind.Keyword, detail: "Else-if branch" },
  { name: "else", kind: CompletionItemKind.Keyword, detail: "Else branch" },
  { name: "end", kind: CompletionItemKind.Keyword, detail: "End block" },
  { name: "foreach", kind: CompletionItemKind.Keyword, detail: "Iterate over items", snippet: "@foreach(${1:item}, in: ${2:items})\n\t$0\n@end" },
  { name: "repeat", kind: CompletionItemKind.Keyword, detail: "Repeat block", snippet: "@repeat(${1:count})\n\t$0\n@end" },
  { name: "set", kind: CompletionItemKind.Variable, detail: "Assign a variable", snippet: "@set(${1:name}, value: ${0:expr})" },

  // Layout
  { name: "pagebreak", kind: CompletionItemKind.Keyword, detail: "Page break" },
  { name: "columns", kind: CompletionItemKind.Keyword, detail: "Columns region" },
  { name: "break", kind: CompletionItemKind.Keyword, detail: "Column break" },
  { name: "header", kind: CompletionItemKind.Keyword, detail: "Page header" },
  { name: "footer", kind: CompletionItemKind.Keyword, detail: "Page footer" },
  { name: "anchor", kind: CompletionItemKind.Reference, detail: "Cross-reference anchor", snippet: "@anchor(${1:name})" },
  { name: "table", kind: CompletionItemKind.Keyword, detail: "Table block" },
  { name: "box", kind: CompletionItemKind.Keyword, detail: "Box block" },

  // Modifiers
  { name: "center", kind: CompletionItemKind.Operator, detail: "Center alignment" },
  { name: "right", kind: CompletionItemKind.Operator, detail: "Right alignment" },
  { name: "indent", kind: CompletionItemKind.Operator, detail: "Indent" },
  { name: "outdent", kind: CompletionItemKind.Operator, detail: "Outdent" },
  { name: "bold", kind: CompletionItemKind.Operator, detail: "Bold text" },
  { name: "italic", kind: CompletionItemKind.Operator, detail: "Italic text" },
  { name: "small", kind: CompletionItemKind.Operator, detail: "Small text" },
  { name: "caps", kind: CompletionItemKind.Operator, detail: "All caps" },

  // Headings
  { name: "h1", kind: CompletionItemKind.Operator, detail: "Heading 1" },
  { name: "h2", kind: CompletionItemKind.Operator, detail: "Heading 2" },
  { name: "h3", kind: CompletionItemKind.Operator, detail: "Heading 3" },
  { name: "h4", kind: CompletionItemKind.Operator, detail: "Heading 4" },
  { name: "h5", kind: CompletionItemKind.Operator, detail: "Heading 5" },
  { name: "h6", kind: CompletionItemKind.Operator, detail: "Heading 6" },

  // Other
  { name: "slot", kind: CompletionItemKind.Variable, detail: "Macro slot" },
];
