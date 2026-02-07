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
  HeaderFooter,
  Inline,
  InlineStyleProps,
  List,
  ListItem,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  StyleRef,
  Styled,
} from "../types/document-ir.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { parseArgsObject, type ArgsObject, type ParseArgsResult } from "../shared/args.ts";
import { parseLengthToTwips } from "../shared/units.ts";
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

type HorizontalAlign = "left" | "center" | "right";

const DEFAULT_COLUMNS_COUNT = 2;
const DEFAULT_COLUMN_GAP_TWIPS = 720;

function withTextAlign(styleRef: StyleRef | undefined, align: HorizontalAlign): StyleRef {
  return {
    ...(styleRef ?? {}),
    inline: {
      ...(styleRef?.inline ?? {}),
      textAlign: align,
    },
  };
}

function applyAlignmentToBlock(block: Block, align: HorizontalAlign): Block {
  switch (block.type) {
    case "Paragraph":
      return { ...block, style: withTextAlign(block.style, align) };
    case "Heading":
      return { ...block, style: withTextAlign(block.style, align) };
    case "Blockquote":
      return {
        ...block,
        content: block.content.map((child) => applyAlignmentToBlock(child, align)),
      };
    case "Section":
      return {
        ...block,
        content: block.content.map((child) => applyAlignmentToBlock(child, align)),
      };
    case "List":
      return {
        ...block,
        style: withTextAlign(block.style, align),
        items: block.items.map((item) => ({
          ...item,
          style: withTextAlign(item.style, align),
          children: item.children.map((child) => applyAlignmentToBlock(child, align)),
        })),
      };
    case "Table":
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            content: cell.content.map((child) => applyAlignmentToBlock(child, align)),
          })),
        })),
      };
    default:
      return block;
  }
}

function applyAlignmentToBlocks(blocks: Block[], align: HorizontalAlign): Block[] {
  return blocks.map((block) => applyAlignmentToBlock(block, align));
}

function parseColumnsArgs(args: ArgsObject, state: EvaluationState, loc: Directive["loc"]): { count: number; space: number } {
  let count = DEFAULT_COLUMNS_COUNT;
  if (typeof args.count === "number" && Number.isFinite(args.count) && args.count >= 1) {
    count = Math.floor(args.count);
  } else if (args.count !== undefined) {
    state.diagnostics.push(
      createWarning(
        DiagnosticCode.PARSE_ERROR,
        "@columns count must be a positive number",
        loc,
      ),
    );
  }

  let space = DEFAULT_COLUMN_GAP_TWIPS;
  const rawGap = args.gap ?? args.space;
  if (typeof rawGap === "number" && Number.isFinite(rawGap) && rawGap >= 0) {
    space = Math.round(rawGap);
  } else if (typeof rawGap === "string") {
    try {
      space = parseLengthToTwips(rawGap);
    } catch {
      state.diagnostics.push(
        createWarning(
          DiagnosticCode.PARSE_ERROR,
          "@columns gap must be a valid length string (for example \"0.5in\")",
          loc,
        ),
      );
    }
  } else if (rawGap !== undefined) {
    state.diagnostics.push(
      createWarning(
        DiagnosticCode.PARSE_ERROR,
        "@columns gap must be a number (twips) or length string",
        loc,
      ),
    );
  }

  return { count, space };
}

function alignmentFromRegion(name: "left" | "center" | "right"): HorizontalAlign {
  return name;
}

function isHeaderFooterRegionDirective(node: CSTBlock): node is Directive & { name: "left" | "center" | "right" } {
  return node.kind === "Directive" && (node.name === "left" || node.name === "center" || node.name === "right");
}

async function evaluateHeaderFooter(node: Directive, kind: HeaderFooter["kind"], state: EvaluationState): Promise<void> {
  const content: Block[] = [];

  if (node.body) {
    for (const child of node.body.children) {
      if (isHeaderFooterRegionDirective(child)) {
        const regionBlocks = child.body ? await evaluateBlocks(child.body.children, state) : [];
        content.push(...applyAlignmentToBlocks(regionBlocks, alignmentFromRegion(child.name)));
        continue;
      }

      content.push(...(await evaluateBlock(child, state)));
    }
  }

  const headerFooter: HeaderFooter = {
    type: "HeaderFooter",
    kind,
    content,
    loc: node.loc,
  };

  if (kind === "header") {
    state.metadata.headers = {
      ...(state.metadata.headers ?? {}),
      default: headerFooter,
    };
    return;
  }

  state.metadata.footers = {
    ...(state.metadata.footers ?? {}),
    default: headerFooter,
  };
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

function toCellText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function createTextCell(value: string, loc: Directive["loc"]): TableCell {
  return {
    type: "TableCell",
    content: [{
      type: "Paragraph",
      content: value.length > 0 ? [{ type: "Text", value, loc }] : [],
      loc,
    }],
    loc,
  };
}

function evaluateTableDirective(node: Directive, state: EvaluationState): Table {
  const rowNodes = node.body?.children.filter(
    (child): child is Directive => child.kind === "Directive" && child.name === "row",
  ) ?? [];
  const rows: TableRow[] = [];
  const rowColumnOwners: TableCell[][] = [];

  for (const rowNode of rowNodes) {
    const args = parseDirectiveArgs(rowNode.argsRaw, state, rowNode.loc);
    const values = Array.isArray(args.cells) ? args.cells : [];
    const cells: TableCell[] = [];
    const columnOwners: TableCell[] = [];
    let column = 0;

    for (const rawValue of values) {
      const cellValue = toCellText(rawValue);

      if (cellValue === ">") {
        const leftCell = columnOwners[column - 1];
        if (leftCell) {
          leftCell.colspan = (leftCell.colspan ?? 1) + 1;
          columnOwners[column] = leftCell;
        }
        column += 1;
        continue;
      }

      if (cellValue === "^") {
        const aboveCell = rowColumnOwners[rowColumnOwners.length - 1]?.[column];
        if (aboveCell) {
          aboveCell.rowspan = (aboveCell.rowspan ?? 1) + 1;
        }
        column += 1;
        continue;
      }

      const cell = createTextCell(cellValue, rowNode.loc);
      cells.push(cell);
      columnOwners[column] = cell;
      column += 1;
    }

    rows.push({
      type: "TableRow",
      cells,
      loc: rowNode.loc,
    });
    rowColumnOwners.push(columnOwners);
  }

  return {
    type: "Table",
    rows,
    loc: node.loc,
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
    case "columns": {
      const args = parseDirectiveArgs(node.argsRaw, state, node.loc);
      const { count, space } = parseColumnsArgs(args, state, node.loc);
      const content = node.body ? await evaluateBlocks(node.body.children, state) : [];
      return [{
        type: "Section",
        columns: { count, space },
        content,
        loc: node.loc,
      }];
    }
    case "box": {
      const content = node.body ? await evaluateBlocks(node.body.children, state) : [];
      return [{
        type: "Blockquote",
        content,
        loc: node.loc,
      }];
    }
    case "align": {
      const args = parseDirectiveArgs(node.argsRaw, state, node.loc);
      const value = args.value;
      const align: HorizontalAlign = value === "left" || value === "center" || value === "right"
        ? value
        : "left";

      if (value !== undefined && value !== "left" && value !== "center" && value !== "right") {
        state.diagnostics.push(
          createWarning(
            DiagnosticCode.PARSE_ERROR,
            "@align value must be one of: left, center, right",
            node.loc,
          ),
        );
      }

      const inner = node.body ? await evaluateBlocks(node.body.children, state) : [];
      return applyAlignmentToBlocks(inner, align);
    }
    case "header":
      await evaluateHeaderFooter(node, "header", state);
      return [];
    case "footer":
      await evaluateHeaderFooter(node, "footer", state);
      return [];
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
    case "table":
      return [evaluateTableDirective(node, state)];
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
