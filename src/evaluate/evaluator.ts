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
import type { SourceLocation } from "../types/source-location.ts";
import type * as CST from "../types/cst.ts";
import type {
  Directive,
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
  PageLayout,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  StyleRef,
  Styled,
} from "../types/document-ir.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { parseArgsObject, type ArgsObject, type ParseArgsResult } from "../shared/args.ts";
import { defaultIncludeRoot, resolveIncludeFilePath } from "../shared/include-path.ts";
import { parseLengthToTwips } from "../shared/units.ts";
import { parseSource } from "../parse/index.ts";
import { bindSync } from "../bind/index.ts";
import { createEnv, evaluate as evaluateLua, execute as executeLua } from "./lua/runtime.ts";

export type SourceLoader = (path: string) => Promise<string>;

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

export interface EvaluateOptions {
  variables?: Record<string, unknown>;
  sourcePath?: string;
  includeRoot?: string;
  loadFile?: SourceLoader;
  includeStack?: string[];
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

/**
 * Parse page layout config from @document args.
 * Supports margins (string or object), pageSize, and orientation.
 */
function parseDocumentLayout(
  args: ArgsObject,
  state: EvaluationState,
  loc: Directive["loc"],
): PageLayout | undefined {
  let hasLayout = false;
  const layout: PageLayout = {};

  // Parse margins — string shorthand or object
  if (args.margins !== undefined) {
    hasLayout = true;
    if (typeof args.margins === "string") {
      layout.margins = parseMarginsString(args.margins, state, loc);
    } else if (typeof args.margins === "object" && args.margins !== null) {
      const m = args.margins as Record<string, unknown>;
      // Only set sides that are explicitly provided — unspecified sides
      // inherit from existing style defaults during pipeline merge.
      const partial: Record<string, number> = {};
      if (m.top !== undefined) partial.top = parseSingleMargin(m.top, 1440);
      if (m.bottom !== undefined) partial.bottom = parseSingleMargin(m.bottom, 1440);
      if (m.left !== undefined) partial.left = parseSingleMargin(m.left, 1440);
      if (m.right !== undefined) partial.right = parseSingleMargin(m.right, 1440);
      if (Object.keys(partial).length > 0) {
        layout.margins = partial as PageLayout["margins"];
      }
    }
  }

  // Parse page size
  if (args.pageSize !== undefined && typeof args.pageSize === "object" && args.pageSize !== null) {
    hasLayout = true;
    const ps = args.pageSize as Record<string, unknown>;
    const width = typeof ps.width === "string" ? tryParseTwips(ps.width) : undefined;
    const height = typeof ps.height === "string" ? tryParseTwips(ps.height) : undefined;
    if (width !== undefined && height !== undefined) {
      layout.pageSize = { width, height };
    }
  }

  // Parse orientation
  if (args.orientation === "landscape" || args.orientation === "portrait") {
    hasLayout = true;
    layout.orientation = args.orientation;
  }

  return hasLayout ? layout : undefined;
}

/**
 * Parse margin shorthand string: "1in" (all), "1in 1.25in" (v h),
 * "1in 1in 1in 1.25in" (top right bottom left — CSS order).
 */
function parseMarginsString(
  raw: string,
  state: EvaluationState,
  loc: Directive["loc"],
): PageLayout["margins"] {
  const parts = raw.trim().split(/\s+/);
  try {
    if (parts.length === 1) {
      const all = parseLengthToTwips(parts[0]!);
      return { top: all, bottom: all, left: all, right: all };
    }
    if (parts.length === 2) {
      const vertical = parseLengthToTwips(parts[0]!);
      const horizontal = parseLengthToTwips(parts[1]!);
      return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
    }
    if (parts.length === 4) {
      return {
        top: parseLengthToTwips(parts[0]!),
        right: parseLengthToTwips(parts[1]!),
        bottom: parseLengthToTwips(parts[2]!),
        left: parseLengthToTwips(parts[3]!),
      };
    }
    state.diagnostics.push(
      createWarning(DiagnosticCode.PARSE_ERROR, "margins string must have 1, 2, or 4 values", loc),
    );
    return undefined;
  } catch {
    state.diagnostics.push(
      createWarning(DiagnosticCode.PARSE_ERROR, `Invalid margin value in "${raw}"`, loc),
    );
    return undefined;
  }
}

function parseSingleMargin(value: unknown, fallback: number): number {
  if (typeof value === "string") return tryParseTwips(value) ?? fallback;
  if (typeof value === "number") return value;
  return fallback;
}

function tryParseTwips(value: string): number | undefined {
  try {
    return parseLengthToTwips(value);
  } catch {
    return undefined;
  }
}

function alignmentFromRegion(name: "left" | "center" | "right"): HorizontalAlign {
  return name;
}

function isHeaderFooterRegionDirective(node: CST.Block): node is Directive & { name: "left" | "center" | "right" } {
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

function withLocationSource(location: SourceLocation, sourcePath: string): SourceLocation {
  if (location.source) {
    return location;
  }

  return {
    ...location,
    source: sourcePath,
  };
}

function withDiagnosticSource(diagnostic: Diagnostic, sourcePath: string): Diagnostic {
  return {
    ...diagnostic,
    location: withLocationSource(diagnostic.location, sourcePath),
  };
}

function toIncludeArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readParamsNames(cst: CST.Document, state: EvaluationState): string[] {
  const paramsDirective = cst.children.find(
    (block): block is Directive => block.kind === "Directive" && block.name === "params",
  );

  if (!paramsDirective) {
    return [];
  }

  const args = parseDirectiveArgs(paramsDirective.argsRaw, state, paramsDirective.loc);
  const names = args.names;
  if (!Array.isArray(names)) {
    state.diagnostics.push(
      createError(
        DiagnosticCode.PARSE_ERROR,
        "@params requires names: [\"name\", ...]",
        paramsDirective.loc,
      ),
    );
    return [];
  }

  const rawNames = names as unknown[];
  const validNames = rawNames.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (validNames.length !== rawNames.length) {
    state.diagnostics.push(
      createError(
        DiagnosticCode.PARSE_ERROR,
        "@params names must be an array of non-empty strings",
        paramsDirective.loc,
      ),
    );
    return [];
  }

  return validNames;
}

function validateIncludeParams(
  requiredNames: string[],
  args: Record<string, unknown>,
  includeLoc: Directive["loc"],
  state: EvaluationState,
): boolean {
  let valid = true;
  for (const name of requiredNames) {
    if (!(name in args)) {
      valid = false;
      state.diagnostics.push(
        createError(
          DiagnosticCode.ARITY_MISMATCH,
          `Missing include arg '${name}' required by @params(names: [...])`,
          includeLoc,
        ),
      );
    }
  }
  return valid;
}

async function evaluateIncludeDirective(node: Directive, state: EvaluationState): Promise<Block[]> {
  const args = parseDirectiveArgs(node.argsRaw, state, node.loc);
  const includePath = typeof args.path === "string" ? args.path : undefined;
  if (!includePath) {
    state.diagnostics.push(
      createError(
        DiagnosticCode.PARSE_ERROR,
        "@include requires path: \"...\"",
        node.loc,
      ),
    );
    return [];
  }

  if (!state.sourcePath) {
    state.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_NOT_FOUND,
        "@include requires sourcePath in evaluation options",
        node.loc,
      ),
    );
    return [];
  }

  if (!state.loadFile) {
    state.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_NOT_FOUND,
        "@include requires a file loader in evaluation options",
        node.loc,
      ),
    );
    return [];
  }

  const includeRoot = state.includeRoot ?? defaultIncludeRoot(state.sourcePath);
  const resolved = resolveIncludeFilePath({
    includePath,
    sourcePath: state.sourcePath,
    rootPath: includeRoot,
  });
  if (!resolved.ok) {
    state.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_NOT_FOUND,
        resolved.reason,
        node.loc,
      ),
    );
    return [];
  }

  const resolvedPath = resolved.path;
  if (state.includeStack.includes(resolvedPath)) {
    state.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_CYCLE,
        `Import cycle detected at '${resolvedPath}'`,
        node.loc,
      ),
    );
    return [];
  }

  let childSource: string;
  try {
    childSource = await state.loadFile(resolvedPath);
  } catch (cause) {
    state.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_NOT_FOUND,
        `Failed to load include '${resolvedPath}': ${cause instanceof Error ? cause.message : String(cause)}`,
        node.loc,
      ),
    );
    return [];
  }

  const parsed = parseSource(childSource);
  state.diagnostics.push(...parsed.diagnostics.map((diagnostic) => withDiagnosticSource(diagnostic, resolvedPath)));
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return [];
  }

  const bindResult = bindSync(parsed.cst);
  state.diagnostics.push(...bindResult.diagnostics.map((diagnostic) => withDiagnosticSource(diagnostic, resolvedPath)));
  if (bindResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return [];
  }

  const includeArgs = toIncludeArgs(args.args);
  const requiredNames = readParamsNames(parsed.cst, state);
  if (!validateIncludeParams(requiredNames, includeArgs, node.loc, state)) {
    return [];
  }

  const childVariables = {
    ...state.variables,
    ...includeArgs,
  };

  const childResult = await evaluate(parsed.cst, bindResult.symbols, {
    variables: childVariables,
    sourcePath: resolvedPath,
    includeRoot,
    loadFile: state.loadFile,
    includeStack: [...state.includeStack, resolvedPath],
  });
  state.diagnostics.push(...childResult.diagnostics);

  return childResult.document.blocks;
}

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
    case "InlineDirective":
      return evaluateInlineDirective(node, state);
    case "InlineCrossRef":
      return [{
        type: "CrossRef",
        target: node.target,
        loc: node.loc,
      }];
    default:
      return [];
  }
}

async function evaluateInlineDirective(node: CST.InlineDirective, state: EvaluationState): Promise<Inline[]> {
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

  // Resolve ref from @def bindings (Spec §10.4)
  let runChannel: unknown = args.r;
  if (typeof args.ref === "string") {
    const def = state.defs[args.ref];
    if (def && typeof def === "object") {
      const defObj = def as Record<string, unknown>;
      // Merge: def provides the base, call-site overrides win
      if (defObj.r && typeof defObj.r === "object" && runChannel && typeof runChannel === "object") {
        runChannel = { ...(defObj.r as Record<string, unknown>), ...(runChannel as Record<string, unknown>) };
      } else {
        runChannel = defObj.r ?? runChannel;
      }
    } else if (def === undefined) {
      state.diagnostics.push(
        createWarning(DiagnosticCode.PARSE_ERROR, `@style ref "${args.ref}" not found in @def bindings`, node.loc),
      );
    }
  }

  const inlineStyle = inlineStyleFromRunChannel(runChannel);
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
  const args = parseDirectiveArgs(first.argsRaw, state, first.loc);
  const listStart = typeof args.start === "number" ? args.start : undefined;
  const listContinue = typeof args.continue === "boolean" ? args.continue : undefined;

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

      // Parse page layout config (Spec §6)
      const layout = parseDocumentLayout(args, state, node.loc);
      if (layout) {
        state.metadata.layout = layout;
      }

      // Parse numbering mode (Spec §11.2)
      const numbering = args.numbering;
      if (numbering && typeof numbering === "object") {
        const mode = (numbering as Record<string, unknown>).mode;
        if (typeof mode === "string") {
          state.metadata.custom.numberingMode = mode;
        }
      }

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
    case "anchor": {
      const args = parseDirectiveArgs(node.argsRaw, state, node.loc);
      const id = typeof args.id === "string" ? args.id : undefined;
      if (!id) {
        state.diagnostics.push(
          createWarning(DiagnosticCode.PARSE_ERROR, '@anchor requires id: "..."', node.loc),
        );
        return [];
      }
      // Bookmark is an Inline node; wrap in an empty paragraph to anchor it in block flow
      return [{
        type: "Paragraph",
        content: [{ type: "Bookmark", name: id, loc: node.loc }],
        loc: node.loc,
      }];
    }
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
    case "params":
      return [];
    case "include":
      return evaluateIncludeDirective(node, state);
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

async function evaluateBlock(node: CST.Block, state: EvaluationState): Promise<Block[]> {
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
  cst: CST.Document,
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
