/**
 * Main evaluator — thin orchestrator that delegates directive handling
 * to modular handlers via the registry.
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
  type Diagnostic,
} from "../types/diagnostics.ts";
import type * as CST from "../types/cst.ts";
import type {
  ListItemMarker,
  ParagraphBlock,
} from "../types/cst.ts";
import type {
  Block,
  Document,
  DocumentMetadata,
  EvaluateResult,
  Inline,
  List,
  ListItem,
  Paragraph,
} from "../types/document-ir.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { defaultIncludeRoot } from "../shared/include-path.ts";
import { createEnv, evaluate as evaluateLua } from "./lua/runtime.ts";
import type { EvalContext, EvaluateOptions, SourceLoader } from "./handler.ts";
import { getBlockDirectiveHandler, getInlineDirectiveHandler } from "./registry.ts";
import {
  warning as createWarning,
} from "../types/diagnostics.ts";

export type { EvaluateOptions, SourceLoader };

interface EvaluationState {
  diagnostics: Diagnostic[];
  metadata: DocumentMetadata;
  defs: Record<string, unknown>;
  styles: Record<string, unknown>;
  luaEngine: Awaited<ReturnType<typeof createEnv>>;
  variables: Record<string, unknown>;
  sourcePath?: string;
  includeRoot?: string;
  loadFile?: SourceLoader;
  includeStack: string[];
}

// ---------------------------------------------------------------------------
// Context factory — bridges private EvaluationState to public EvalContext
// ---------------------------------------------------------------------------

function createContext(state: EvaluationState): EvalContext {
  const ctx: EvalContext = {
    // Mutable shared state
    diagnostics: state.diagnostics,
    metadata: state.metadata,
    defs: state.defs,

    // Read-mostly state
    styles: state.styles,
    luaEngine: state.luaEngine,
    variables: state.variables,
    sourcePath: state.sourcePath,
    includeRoot: state.includeRoot,
    loadFile: state.loadFile,
    includeStack: state.includeStack,

    // Recursive evaluation hooks
    evaluateBlock: (node) => evaluateBlock(node, state),
    evaluateBlocks: (nodes) => evaluateBlocks(nodes, state),
    evaluateInline: (node) => evaluateInline(node, state),
    evaluateInlines: async (nodes) => {
      const result: Inline[] = [];
      for (const node of nodes) {
        result.push(...(await evaluateInline(node, state)));
      }
      return result;
    },

    // Re-entry point for @include (breaks circular dependency)
    evaluateSubdocument: (cst, symbols, options) => evaluate(cst, symbols, options),
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// Inline evaluation
// ---------------------------------------------------------------------------

async function evaluateInline(node: CST.Inline, state: EvaluationState): Promise<Inline[]> {
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
    case "InlineDirective": {
      const bodyInlines: Inline[] = [];
      if (node.body) {
        for (const child of node.body) {
          bodyInlines.push(...(await evaluateInline(child, state)));
        }
      }
      const handler = getInlineDirectiveHandler(node.name);
      const ctx = createContext(state);
      return handler(node, bodyInlines, ctx);
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Paragraph & list evaluation
// ---------------------------------------------------------------------------

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

async function evaluateListRun(blocks: CST.Block[], start: number, state: EvaluationState): Promise<{ list: List; nextIndex: number }> {
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

  // Parse list marker args (start, continue) from first item
  const args = first.args ?? {};
  const listStart = typeof args.start === "number" ? args.start : undefined;
  const listContinue = typeof args.continue === "boolean" ? args.continue : undefined;

  // Spec §11.3: start and continue are mutually exclusive
  if (listStart !== undefined && listContinue !== undefined) {
    state.diagnostics.push(
      createWarning(
        DiagnosticCode.PARSE_ERROR,
        "List args 'start' and 'continue' are mutually exclusive (Spec §11.3)",
        first.loc,
      ),
    );
  }

  return {
    list: {
      type: "List",
      ordered: first.ordered,
      items,
      numberFormat: "decimal",
      start: listStart,
      continue: listContinue,
      loc: first.loc,
    },
    nextIndex: index,
  };
}

// ---------------------------------------------------------------------------
// Block evaluation — dispatch via registry
// ---------------------------------------------------------------------------

async function evaluateBlock(node: CST.Block, state: EvaluationState): Promise<Block[]> {
  switch (node.kind) {
    case "ParagraphBlock":
      return [await evaluateParagraph(node, state)];
    case "Directive": {
      const handler = getBlockDirectiveHandler(node.name);
      const ctx = createContext(state);
      return handler(node, ctx);
    }
    case "StructuralBody":
      return evaluateBlocks(node.children, state);
    case "ListItemMarker":
      // Grouped by evaluateBlocks to avoid one-list-item-per-list-node output.
      return [];
    default:
      return [];
  }
}

async function evaluateBlocks(nodes: CST.Block[], state: EvaluationState): Promise<Block[]> {
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

// ---------------------------------------------------------------------------
// Symbol table helpers
// ---------------------------------------------------------------------------

function defsFromSymbols(symbols: SymbolTable): Record<string, unknown> {
  const defs: Record<string, unknown> = {};
  for (const [name, symbol] of symbols.defs) {
    // Deep-clone so evaluator gets mutable copies of frozen bind-phase values
    // (Spec §18.1.1: runtime defs must be mutable, symbol table is immutable)
    defs[name] = structuredClone(symbol.value);
  }
  return defs;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function evaluate(
  cst: CST.Document,
  symbols: SymbolTable,
  options: EvaluateOptions = {},
): Promise<EvaluateResult> {
  const diagnostics: Diagnostic[] = [];

  const metadata: DocumentMetadata = {
    custom: {},
  };

  const defs = defsFromSymbols(symbols);
  const styles: Record<string, unknown> = {};
  const data = options.variables ?? {};
  const luaEngine = await createEnv(data, defs, styles);

  const state: EvaluationState = {
    diagnostics,
    metadata,
    defs,
    styles,
    luaEngine,
    variables: data,
    sourcePath: options.sourcePath,
    includeRoot: options.includeRoot ?? (options.sourcePath ? defaultIncludeRoot(options.sourcePath) : undefined),
    loadFile: options.loadFile,
    includeStack: options.includeStack ?? (options.sourcePath ? [options.sourcePath] : []),
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
