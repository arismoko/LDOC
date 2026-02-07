/**
 * Main evaluator - transforms bound CST to Document IR.
 *
 * LDOC v3 evaluator responsibilities:
 * - create one Lua runtime per document
 * - expose data/defs/styles globals
 * - evaluate $(...) expressions
 * - execute @lua{...} chunks
 */

import {
  DiagnosticCode,
  error as createError,
  warning as createWarning,
  type Diagnostic,
} from "../types/diagnostics.ts";
import type {
  Block as CSTBlock,
  CSTDocument,
  Directive,
  Inline as CSTInline,
  InlineDirective as CSTInlineDirective,
  ListItemMarker,
  ParagraphBlock,
} from "../types/cst.ts";
import type {
  Block,
  Document,
  DocumentMetadata,
  EvaluateResult,
  Inline,
  InlineStyleProps,
  List,
  ListItem,
  Paragraph,
  StyleRef,
  Styled,
} from "../types/document-ir.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { parseArgsObject, type ArgsObject, type ParseArgsResult } from "../shared/args.ts";
import { createEnv, evaluate as evaluateLua, execute as executeLua } from "./lua/runtime.ts";

interface EvaluationState {
  diagnostics: Diagnostic[];
  metadata: DocumentMetadata;
  defs: Record<string, unknown>;
  styles: Record<string, unknown>;
  luaEngine: Awaited<ReturnType<typeof createEnv>>;
}

export interface EvaluateOptions {
  variables?: Record<string, unknown>;
}

function isArgsParseError(result: ArgsObject | ParseArgsResult): result is ParseArgsResult {
  return "ok" in result && result.ok === false;
}

function parseDirectiveArgs(argsRaw: string | undefined, state: EvaluationState, loc: Directive["loc"]): ArgsObject {
  if (!argsRaw) {
    return {};
  }

  const inner = argsRaw.slice(1, -1);
  const parsed = parseArgsObject(`{${inner}}`, loc);
  if (isArgsParseError(parsed)) {
    state.diagnostics.push(parsed.error);
    return {};
  }

  return parsed;
}

function inlineStyleFromRunChannel(value: unknown): InlineStyleProps {
  if (!value || typeof value !== "object") {
    return {};
  }

  const run = value as Record<string, unknown>;
  const style: InlineStyleProps = {};

  if (typeof run.bold === "boolean") style.bold = run.bold;
  if (typeof run.italic === "boolean") style.italic = run.italic;
  if (typeof run.underline === "boolean") style.underline = run.underline;
  if (typeof run.strikethrough === "boolean") style.strikethrough = run.strikethrough;
  if (typeof run.color === "string") style.color = run.color;
  if (typeof run.fontFamily === "string") style.fontFamily = run.fontFamily;
  if (typeof run.size === "number") style.fontSize = run.size;
  if (typeof run.fontSize === "number") style.fontSize = run.fontSize;

  return style;
}

function paragraphStyleRefFromArgs(args: ArgsObject): StyleRef | undefined {
  const ref = typeof args.ref === "string" ? args.ref : undefined;
  const p = args.p;
  const r = args.r;

  const styleRef: StyleRef = {};
  if (ref) {
    styleRef.name = ref;
  }

  if (p && typeof p === "object") {
    const pObj = p as Record<string, unknown>;
    if (!styleRef.name && typeof pObj.use === "string") {
      styleRef.name = pObj.use;
    }
  }

  const inline = inlineStyleFromRunChannel(r);
  if (Object.keys(inline).length > 0) {
    styleRef.inline = inline;
  }

  if (!styleRef.name && !styleRef.inline) {
    return undefined;
  }

  return styleRef;
}

async function evaluateInline(node: CSTInline, state: EvaluationState): Promise<Inline[]> {
  switch (node.kind) {
    case "InlineText":
      return [{ type: "Text", value: node.text, loc: node.loc }];
    case "InlineHardBreak":
      return [{ type: "HardBreak", loc: node.loc }];
    case "LuaExpr": {
      try {
        const value = await evaluateLua(state.luaEngine, node.expr);
        const text = value == null ? "" : String(value);
        return [{ type: "Text", value: text, loc: node.loc }];
      } catch (cause) {
        state.diagnostics.push(
          createError(
            DiagnosticCode.EXPRESSION_ERROR,
            `Lua expression failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            node.loc,
          ),
        );
        return [{ type: "Text", value: "", loc: node.loc }];
      }
    }
    case "InlineDirective":
      return evaluateInlineDirective(node, state);
    default:
      return [];
  }
}

async function evaluateInlineDirective(node: CSTInlineDirective, state: EvaluationState): Promise<Inline[]> {
  const bodyInlines: Inline[] = [];
  if (node.body) {
    for (const child of node.body) {
      bodyInlines.push(...(await evaluateInline(child, state)));
    }
  }

  if (node.name !== "style") {
    return bodyInlines;
  }

  const args = parseDirectiveArgs(node.argsRaw, state, node.loc);
  const inlineStyle = inlineStyleFromRunChannel(args.r);
  if (Object.keys(inlineStyle).length === 0) {
    return bodyInlines;
  }

  const styled: Styled = {
    type: "Styled",
    content: bodyInlines,
    style: inlineStyle,
    loc: node.loc,
  };

  return [styled];
}

async function evaluateParagraph(block: ParagraphBlock, state: EvaluationState): Promise<Paragraph> {
  const content: Inline[] = [];
  for (const inline of block.inlines) {
    content.push(...(await evaluateInline(inline, state)));
  }

  return {
    type: "Paragraph",
    content,
    loc: block.loc,
  };
}

async function evaluateListItem(marker: ListItemMarker, state: EvaluationState): Promise<ListItem> {
  if (!marker.body) {
    return {
      type: "ListItem",
      content: [],
      children: [],
      loc: marker.loc,
    };
  }

  const blocks = await evaluateBlocks(marker.body.children, state);
  const first = blocks[0];

  if (first?.type === "Paragraph") {
    return {
      type: "ListItem",
      content: first.content,
      children: blocks.slice(1),
      loc: marker.loc,
    };
  }

  return {
    type: "ListItem",
    content: [],
    children: blocks,
    loc: marker.loc,
  };
}

async function evaluateListRun(blocks: CSTBlock[], start: number, state: EvaluationState): Promise<{ list: List; nextIndex: number }> {
  const first = blocks[start] as ListItemMarker;
  const items: ListItem[] = [];
  let index = start;

  while (index < blocks.length) {
    const node = blocks[index];
    if (!node) {
      break;
    }
    if (node.kind !== "ListItemMarker" || node.ordered !== first.ordered || node.depth !== first.depth) {
      break;
    }

    items.push(await evaluateListItem(node, state));
    index += 1;
  }

  return {
    list: {
      type: "List",
      ordered: first.ordered,
      items,
      numberFormat: "decimal",
      loc: first.loc,
    },
    nextIndex: index,
  };
}

async function executeLuaDirective(node: Directive, state: EvaluationState): Promise<void> {
  if (!node.body || node.body.children.length === 0) {
    return;
  }

  if (
    node.body.children.length !== 1 ||
    node.body.children[0]?.kind !== "ParagraphBlock"
  ) {
    state.diagnostics.push(
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
    await executeLua(state.luaEngine, chunk);
  } catch (cause) {
    state.diagnostics.push(
      createError(
        DiagnosticCode.EXPRESSION_ERROR,
        `Lua chunk failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        node.loc,
      ),
    );
  }
}

async function evaluateDirective(node: Directive, state: EvaluationState): Promise<Block[]> {
  switch (node.name) {
    case "document": {
      const args = parseDirectiveArgs(node.argsRaw, state, node.loc);
      if (typeof args.title === "string") state.metadata.title = args.title;
      if (typeof args.author === "string") state.metadata.author = args.author;
      if (typeof args.date === "string") state.metadata.date = args.date;
      for (const [key, value] of Object.entries(args)) {
        state.metadata.custom[key] = value;
      }
      return [];
    }
    case "def": {
      const args = parseDirectiveArgs(node.argsRaw, state, node.loc);
      for (const [key, value] of Object.entries(args)) {
        state.defs[key] = value;
      }
      return [];
    }
    case "lua": {
      await executeLuaDirective(node, state);
      return [];
    }
    case "pagebreak":
      return [{ type: "PageBreak", loc: node.loc }];
    case "break":
      return [{ type: "ColumnBreak", loc: node.loc }];
    case "style": {
      const inner = node.body ? await evaluateBlocks(node.body.children, state) : [];
      const args = parseDirectiveArgs(node.argsRaw, state, node.loc);
      const styleRef = paragraphStyleRefFromArgs(args);
      if (!styleRef) {
        return inner;
      }

      return inner.map((block) => {
        if (block.type !== "Paragraph" && block.type !== "Heading") {
          return block;
        }

        return {
          ...block,
          style: styleRef,
        };
      });
    }
    default:
      if (!node.body) {
        return [];
      }
      return evaluateBlocks(node.body.children, state);
  }
}

async function evaluateBlock(node: CSTBlock, state: EvaluationState): Promise<Block[]> {
  switch (node.kind) {
    case "ParagraphBlock":
      return [await evaluateParagraph(node, state)];
    case "Directive":
      return evaluateDirective(node, state);
    case "StructuralBody":
      return evaluateBlocks(node.children, state);
    case "ListItemMarker":
      // Grouped by evaluateBlocks to avoid one-list-item-per-list-node output.
      return [];
    default:
      return [];
  }
}

async function evaluateBlocks(nodes: CSTBlock[], state: EvaluationState): Promise<Block[]> {
  const output: Block[] = [];
  let index = 0;

  while (index < nodes.length) {
    const node = nodes[index];
    if (!node) {
      break;
    }

    if (node.kind === "ListItemMarker") {
      const { list, nextIndex } = await evaluateListRun(nodes, index, state);
      output.push(list);
      index = nextIndex;
      continue;
    }

    output.push(...(await evaluateBlock(node, state)));
    index += 1;
  }

  return output;
}

function defsFromSymbols(symbols: SymbolTable): Record<string, unknown> {
  const defs: Record<string, unknown> = {};
  for (const [name, symbol] of symbols.defs) {
    defs[name] = symbol.value;
  }
  return defs;
}

function stylesFromSymbols(symbols: SymbolTable): Record<string, unknown> {
  const styles: Record<string, unknown> = {};
  for (const [name, symbol] of symbols.styles) {
    styles[name] = symbol.properties;
  }
  return styles;
}

export async function evaluate(
  cst: CSTDocument,
  symbols: SymbolTable,
  options: EvaluateOptions = {},
): Promise<EvaluateResult> {
  const diagnostics: Diagnostic[] = [];

  const metadata: DocumentMetadata = {
    custom: {},
  };

  const defs = defsFromSymbols(symbols);
  const styles = stylesFromSymbols(symbols);
  const data = options.variables ?? {};
  const luaEngine = await createEnv(data, defs, styles);

  const state: EvaluationState = {
    diagnostics,
    metadata,
    defs,
    styles,
    luaEngine,
  };

  const blocks = await evaluateBlocks(cst.children, state);

  const document: Document = {
    type: "Document",
    metadata,
    blocks,
  };

  return {
    document,
    diagnostics,
  };
}
