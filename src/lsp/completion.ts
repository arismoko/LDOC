import {
  CompletionItemKind,
  InsertTextFormat,
  type CompletionItem,
  type Position,
} from "vscode-languageserver/node";

import type { DocumentIndex, MacroSignature } from "./indexer";

export type CompletionContext =
  | { kind: "directive"; prefix: string }
  | { kind: "document_key"; prefix: string }
  | { kind: "meta_key"; prefix: string }
  | { kind: "macro_name"; prefix: string; directive: "use" | "define" }
  | { kind: "macro_param_key"; prefix: string; macroName: string }
  | { kind: "variable"; prefix: string }
  | { kind: "variable_filter"; prefix: string }
  | { kind: "cross_ref"; prefix: string }
  | { kind: "none" };

export interface CompletionOptions {
  snippetSupport: boolean;
}

export function detectCompletionContext(text: string, position: Position): CompletionContext {
  const lines = text.split("\n");
  const line = lines[position.line] ?? "";
  const before = line.slice(0, position.character);

  // variable {{ ... }}
  const varStart = before.lastIndexOf("{{");
  const varEnd = before.lastIndexOf("}}");
  const inVar = varStart !== -1 && varStart > varEnd;

  // crossref [[ ... ]]
  const refStart = before.lastIndexOf("[[");
  const refEnd = before.lastIndexOf("]]" );
  const inRef = refStart !== -1 && refStart > refEnd;

  if (inVar) {
    const inside = before.slice(varStart + 2);
    const pipe = inside.lastIndexOf("|");
    if (pipe !== -1) {
      const filterPrefix = inside.slice(pipe + 1).trimStart();
      return { kind: "variable_filter", prefix: filterPrefix };
    }
    return { kind: "variable", prefix: extractIdentPrefix(inside) };
  }

  if (inRef) {
    const inside = before.slice(refStart + 2);
    return { kind: "cross_ref", prefix: inside.trimStart() };
  }

  // macro param keys: @use Name(...
  const useCall = before.match(/@use\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)$/);
  if (useCall) {
    const macroName = useCall[1] ?? "";
    const inside = useCall[2] ?? "";
    const prefix = extractParamKeyPrefix(inside);
    return { kind: "macro_param_key", prefix, macroName };
  }

  // macro name after @use / @define
  const useName = before.match(/@use\s+([A-Za-z_][A-Za-z0-9_]*)?$/);
  if (useName) {
    return { kind: "macro_name", prefix: useName[1] ?? "", directive: "use" };
  }
  const defName = before.match(/@define\s+([A-Za-z_][A-Za-z0-9_]*)?$/);
  if (defName) {
    return { kind: "macro_name", prefix: defName[1] ?? "", directive: "define" };
  }

  // @directive
  const at = before.lastIndexOf("@");
  if (at !== -1) {
    const afterAt = before.slice(at + 1);
    if (afterAt === "" && at === before.length - 1) {
      return { kind: "directive", prefix: "" };
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(afterAt)) {
      return { kind: "directive", prefix: afterAt };
    }
  }

  // Inside @document/@meta blocks (indent-based heuristic)
  if (isInsideIndentedBlock(lines, position.line, "@document")) {
    return { kind: "document_key", prefix: extractYamlKeyPrefix(before) };
  }
  if (isInsideIndentedBlock(lines, position.line, "@meta")) {
    return { kind: "meta_key", prefix: extractYamlKeyPrefix(before) };
  }

  return { kind: "none" };
}

export function completeForContext(
  index: DocumentIndex,
  ctx: CompletionContext,
  options: CompletionOptions
): CompletionItem[] {
  switch (ctx.kind) {
    case "directive":
      return completeDirectives(ctx.prefix, options);
    case "document_key":
      return completeDocumentKeys(ctx.prefix, options);
    case "meta_key":
      return completeMetaKeys(ctx.prefix);
    case "macro_name":
      return completeMacroNames(index, ctx.prefix);
    case "macro_param_key":
      return completeMacroParamKeys(index, ctx.macroName, ctx.prefix, options);
    case "variable":
      return completeVariables(index, ctx.prefix);
    case "variable_filter":
      return completeVariableFilters(ctx.prefix);
    case "cross_ref":
      return completeCrossRefs(index, ctx.prefix);
    case "none":
      return [];
  }
}

function completeDirectives(prefix: string, options: CompletionOptions): CompletionItem[] {
  const snippet = options.snippetSupport;
  const out: CompletionItem[] = [];

  for (const d of DIRECTIVES) {
    if (prefix && !d.name.startsWith(prefix)) continue;

    const wantsSnippet = d.insertTextFormat === InsertTextFormat.Snippet;
    const insertText = wantsSnippet && !snippet ? `@${d.name}` : (d.insertText ?? `@${d.name}`);
    const insertTextFormat = wantsSnippet && !snippet
      ? InsertTextFormat.PlainText
      : (d.insertTextFormat ?? (snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText));

    out.push({
      label: `@${d.name}`,
      kind: d.kind,
      detail: d.detail,
      documentation: d.documentation,
      insertText,
      insertTextFormat,
    });
  }

  return out;
}

function completeDocumentKeys(prefix: string, options: CompletionOptions): CompletionItem[] {
  const out: CompletionItem[] = [];
  const snippet = options.snippetSupport;

  for (const k of DOCUMENT_KEYS) {
    if (prefix && !k.key.startsWith(prefix)) continue;
    out.push({
      label: k.key,
      kind: CompletionItemKind.Property,
      detail: k.detail,
      documentation: k.documentation,
      insertText: snippet && k.snippet ? k.snippet : k.insertText,
      insertTextFormat: snippet && k.snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    });
  }

  return out;
}

function completeMetaKeys(prefix: string): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const k of META_COMMON_KEYS) {
    if (prefix && !k.startsWith(prefix)) continue;
    out.push({
      label: k,
      kind: CompletionItemKind.Property,
      detail: "Common @meta key",
      insertText: k,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }
  return out;
}

function completeMacroNames(index: DocumentIndex, prefix: string): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const [name, sig] of index.macros) {
    if (prefix && !name.startsWith(prefix)) continue;
    out.push({
      label: name,
      kind: CompletionItemKind.Function,
      detail: macroDetail(sig),
      insertText: name,
      insertTextFormat: InsertTextFormat.PlainText,
      data: { kind: "macro", name, uri: index.uri },
    });
  }
  return out;
}

function completeMacroParamKeys(
  index: DocumentIndex,
  macroName: string,
  prefix: string,
  options: CompletionOptions
): CompletionItem[] {
  const sig = index.macros.get(macroName);
  if (!sig) return [];

  const out: CompletionItem[] = [];
  const snippet = options.snippetSupport;
  const params = [...sig.requiredParams, ...sig.optionalParams];
  for (const p of params) {
    if (prefix && !p.startsWith(prefix)) continue;
    out.push({
      label: p,
      kind: CompletionItemKind.Property,
      detail: `${macroName} parameter`,
      insertText: snippet ? `${p}=$1` : `${p}=`,
      insertTextFormat: snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    });
  }
  return out;
}

function completeVariables(index: DocumentIndex, prefix: string): CompletionItem[] {
  const out: CompletionItem[] = [];

  // Meta paths
  for (const p of index.meta.paths) {
    if (prefix && !p.startsWith(prefix)) continue;
    out.push({
      label: p,
      kind: CompletionItemKind.Variable,
      detail: "@meta",
      insertText: p,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  // @document paths
  for (const p of index.document.paths) {
    if (prefix && !p.startsWith(prefix)) continue;
    out.push({
      label: `document.${p}`,
      kind: CompletionItemKind.Variable,
      detail: "@document",
      insertText: `document.${p}`,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  // @set vars
  for (const name of index.setVariables.keys()) {
    if (prefix && !name.startsWith(prefix)) continue;
    out.push({
      label: name,
      kind: CompletionItemKind.Variable,
      detail: "@set",
      insertText: name,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  // foreach vars
  for (const name of index.foreachItems.keys()) {
    if (prefix && !name.startsWith(prefix)) continue;
    out.push({
      label: name,
      kind: CompletionItemKind.Variable,
      detail: "@foreach item",
      insertText: name,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  // Builtins (best-effort)
  for (const b of BUILTIN_VARIABLES) {
    if (prefix && !b.startsWith(prefix)) continue;
    out.push({
      label: b,
      kind: CompletionItemKind.Constant,
      detail: "Built-in",
      insertText: b,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }

  return out;
}

function completeVariableFilters(prefix: string): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const f of VARIABLE_FILTERS) {
    if (prefix && !f.startsWith(prefix)) continue;
    out.push({
      label: f,
      kind: CompletionItemKind.Function,
      detail: "Filter",
      insertText: f,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }
  return out;
}

function completeCrossRefs(index: DocumentIndex, prefix: string): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const [name] of index.anchors) {
    if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    out.push({
      label: name,
      kind: CompletionItemKind.Reference,
      detail: "Anchor",
      insertText: name,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }
  return out;
}

function macroDetail(sig: MacroSignature): string {
  const req = sig.requiredParams.length ? sig.requiredParams.join(", ") : "";
  const opt = sig.optionalParams.length ? `, ${sig.optionalParams.join(", ")}` : "";
  return `@define ${sig.name}(${req}${opt})`;
}

function extractIdentPrefix(s: string): string {
  const m = s.match(/([A-Za-z_][A-Za-z0-9_.]*)$/);
  return m?.[1] ?? "";
}

function extractParamKeyPrefix(s: string): string {
  // After last comma or opening paren, grab identifier prefix before '='
  const lastComma = s.lastIndexOf(",");
  const tail = lastComma === -1 ? s : s.slice(lastComma + 1);
  const m = tail.match(/\s*([A-Za-z_][A-Za-z0-9_]*)$/);
  return m?.[1] ?? "";
}

function extractYamlKeyPrefix(before: string): string {
  const m = before.match(/(^|\s)([A-Za-z_][A-Za-z0-9_]*)$/);
  return m?.[2] ?? "";
}

function isInsideIndentedBlock(lines: string[], lineIndex: number, directive: "@document" | "@meta"): boolean {
  let start = -1;
  for (let i = lineIndex; i >= 0; i--) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === directive) {
      start = i;
      break;
    }
  }
  if (start === -1) return false;

  const baseIndent = indentWidth(lines[start] ?? "");
  for (let i = start + 1; i <= lineIndex; i++) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "") continue;
    const ind = indentWidth(raw);
    if (ind <= baseIndent) return false;
  }
  return true;
}

function indentWidth(line: string): number {
  // tabs count as 1; this is heuristic only.
  let n = 0;
  for (const ch of line) {
    if (ch === " " || ch === "\t") n++;
    else break;
  }
  return n;
}

const BUILTIN_VARIABLES = [
  "loop.index",
  "loop.first",
  "loop.last",
  "loop.count",
];

const VARIABLE_FILTERS = ["upper", "lower", "capitalize"];

const META_COMMON_KEYS = [
  "title",
  "author",
  "date",
  "version",
  "status",
  "parties",
  "seller",
  "buyer",
  "items",
];

const DOCUMENT_KEYS: Array<{
  key: string;
  detail: string;
  documentation?: string;
  insertText: string;
  snippet?: string;
}> = [
  {
    key: "title",
    detail: "Document title",
    insertText: "title: ",
    snippet: 'title: "$1"',
  },
  {
    key: "short_title",
    detail: "Short title for headers",
    insertText: "short_title: ",
    snippet: 'short_title: "$1"',
  },
  {
    key: "author",
    detail: "Author",
    insertText: "author: ",
    snippet: 'author: "$1"',
  },
  {
    key: "numbering",
    detail: "Numbering scheme",
    documentation: "`default` or `decimal`",
    insertText: "numbering: ",
    snippet: "numbering: ${1|default,decimal|}",
  },
  {
    key: "page_size",
    detail: "Page size",
    documentation: "`letter` or `a4`",
    insertText: "page_size: ",
    snippet: "page_size: ${1|letter,a4|}",
  },
  {
    key: "orientation",
    detail: "Page orientation",
    documentation: "`portrait` or `landscape`",
    insertText: "orientation: ",
    snippet: "orientation: ${1|portrait,landscape|}",
  },
  {
    key: "margins",
    detail: "Page margins",
    insertText: "margins:",
  },
  {
    key: "spacing",
    detail: "Paragraph spacing",
    insertText: "spacing:",
  },
  {
    key: "styles",
    detail: "Typography styles",
    insertText: "styles:",
  },
];

const DIRECTIVES: Array<{
  name: string;
  kind: CompletionItemKind;
  detail: string;
  documentation?: string;
  insertText?: string;
  insertTextFormat?: InsertTextFormat;
}> = [
  // Structure
  {
    name: "document",
    kind: CompletionItemKind.Struct,
    detail: "Document configuration block",
    insertText: "@document\n\ttitle: \"${1:Title}\"\n\t$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    name: "meta",
    kind: CompletionItemKind.Struct,
    detail: "Metadata block",
    insertText: "@meta\n\t$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    name: "import",
    kind: CompletionItemKind.Module,
    detail: "Import another .ldoc file",
  },
  {
    name: "define",
    kind: CompletionItemKind.Function,
    detail: "Define a macro template",
    insertText: "@define ${1:Name}(${2:params})\n\t$0\n@end",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    name: "use",
    kind: CompletionItemKind.Function,
    detail: "Use a macro",
    insertText: "@use ${1:Name}($0)",
    insertTextFormat: InsertTextFormat.Snippet,
  },

  // Control flow
  {
    name: "if",
    kind: CompletionItemKind.Keyword,
    detail: "Conditional block",
    insertText: "@if ${1:condition}\n\t$0\n@end",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    name: "elseif",
    kind: CompletionItemKind.Keyword,
    detail: "Else-if branch",
  },
  {
    name: "else",
    kind: CompletionItemKind.Keyword,
    detail: "Else branch",
  },
  {
    name: "end",
    kind: CompletionItemKind.Keyword,
    detail: "End block",
  },
  {
    name: "repeat",
    kind: CompletionItemKind.Keyword,
    detail: "Repeat block",
    insertText: "@repeat ${1:count}\n\t$0\n@end",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    name: "foreach",
    kind: CompletionItemKind.Keyword,
    detail: "Iterate over items",
    insertText: "@foreach ${1:item} in ${2:items}\n\t$0\n@end",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    name: "set",
    kind: CompletionItemKind.Variable,
    detail: "Assign a variable",
    insertText: "@set ${1:name} = ${0:expr}",
    insertTextFormat: InsertTextFormat.Snippet,
  },

  // Layout/content
  { name: "columns", kind: CompletionItemKind.Keyword, detail: "Columns region" },
  { name: "break", kind: CompletionItemKind.Keyword, detail: "Column break" },
  { name: "pagebreak", kind: CompletionItemKind.Keyword, detail: "Page break" },
  { name: "header", kind: CompletionItemKind.Keyword, detail: "Header" },
  { name: "footer", kind: CompletionItemKind.Keyword, detail: "Footer" },
  { name: "firstpage", kind: CompletionItemKind.Keyword, detail: "First page header/footer" },
  { name: "evenpage", kind: CompletionItemKind.Keyword, detail: "Even page header/footer" },
  { name: "anchor", kind: CompletionItemKind.Reference, detail: "Anchor" },
  { name: "table", kind: CompletionItemKind.Keyword, detail: "Table block" },
  { name: "box", kind: CompletionItemKind.Keyword, detail: "Box block" },
  { name: "center", kind: CompletionItemKind.Operator, detail: "Center modifier" },
  { name: "right", kind: CompletionItemKind.Operator, detail: "Right modifier" },
  { name: "indent", kind: CompletionItemKind.Operator, detail: "Indent modifier" },
  { name: "outdent", kind: CompletionItemKind.Operator, detail: "Outdent modifier" },
  { name: "bold", kind: CompletionItemKind.Operator, detail: "Bold modifier" },
  { name: "italic", kind: CompletionItemKind.Operator, detail: "Italic modifier" },
  { name: "small", kind: CompletionItemKind.Operator, detail: "Small modifier" },
  { name: "caps", kind: CompletionItemKind.Operator, detail: "Caps modifier" },
  { name: "h1", kind: CompletionItemKind.Operator, detail: "Heading 1" },
  { name: "h2", kind: CompletionItemKind.Operator, detail: "Heading 2" },
  { name: "h3", kind: CompletionItemKind.Operator, detail: "Heading 3" },
  { name: "h4", kind: CompletionItemKind.Operator, detail: "Heading 4" },
  { name: "h5", kind: CompletionItemKind.Operator, detail: "Heading 5" },
  { name: "h6", kind: CompletionItemKind.Operator, detail: "Heading 6" },
  { name: "slot", kind: CompletionItemKind.Variable, detail: "Macro slot" },
];
