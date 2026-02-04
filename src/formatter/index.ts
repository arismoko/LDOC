/**
 * LDOC Formatter - Pretty prints LDOC source from AST
 *
 * This module parses LDOC source to AST, then pretty prints it back
 * with consistent formatting:
 * - Tab indentation for nested blocks (default)
 * - Aligned table columns
 * - Proper spacing between elements
 */

import { Parser } from "../parser/parser";
import type {
  Node,
  DocumentNode,
  ParagraphNode,
  HeaderNode,
  NumberedItemNode,
  BulletItemNode,
  ModifierNode,
  TableNode,
  TableRowNode,
  IfNode,
  RepeatNode,
  ForeachNode,
  DefineNode,
  UseNode,
  SetNode,
  EmptyParagraphNode,
  CommentNode,
  AnchorNode,
  DocHeaderFooterNode,
  ColumnsRegionNode,
  BlockquoteNode,
  FootnoteDefinitionNode,
  InlineNode,
  TextNode,
  VariableNode,
  EmphasisNode,
  CrossRefNode,
  DefinedTermNode,
  BlankNode,
  LinkNode,
  ImageNode,
  StrikethroughNode,
  InlineCodeNode,
  FootnoteReferenceNode,
} from "../parser/ast";

export interface FormatOptions {
  /** Indentation string (default: tab) */
  indent?: string;
  /** Use tabs for indentation (default: true). Set to false for 2 spaces. */
  useTabs?: boolean;
}

const DEFAULT_INDENT = "\t";

/**
 * Format LDOC source code
 * @param source - The LDOC source code to format
 * @param options - Formatting options
 * @returns Formatted LDOC source code
 */
export function format(source: string, options: FormatOptions = {}): string {
  const parser = new Parser();
  const ast = parser.parse(source);
  // Default to tabs; use spaces only if useTabs is explicitly false
  const useTabs = options.useTabs ?? true;
  const effectiveOptions: FormatOptions = useTabs
    ? { ...options, indent: "\t" }
    : { ...options, indent: "  " };
  return printDocument(ast, effectiveOptions);
}

/**
 * Print a DocumentNode to formatted LDOC source
 */
function printDocument(doc: DocumentNode, options: FormatOptions): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const lines: string[] = [];

  // Print @document block if present
  if (doc.document && Object.keys(doc.document).length > 0) {
    lines.push("@document");
    lines.push(...printYamlBlock(doc.document, indent, 1));
  }

  // Print @meta block if present
  if (doc.meta) {
    lines.push("@meta");
    lines.push(...printYamlBlock(doc.meta.data, indent, 1));
    if (doc.meta.hasEnd) {
      lines.push("@end");
    }
    // Preserve trailing blank lines after @meta
    for (let i = 0; i < (doc.meta.trailingBlanks ?? 0); i++) {
      lines.push("");
    }
  }

  // Print imports
  for (const imp of doc.imports) {
    lines.push(`@import ${imp.path}`);
  }

  // Print body
  const bodyLines = printNodes(doc.body, indent, 0);
  lines.push(...bodyLines);

  // Ensure single trailing newline
  let result = lines.join("\n");
  result = result.replace(/\n+$/, "\n");
  if (!result.endsWith("\n")) {
    result += "\n";
  }

  return result;
}

/**
 * Print YAML-like metadata block
 */
function printYamlBlock(
  data: Record<string, unknown>,
  indent: string,
  level: number
): string[] {
  const lines: string[] = [];
  const prefix = indent.repeat(level);

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      lines.push(`${prefix}${key}:`);
    } else if (typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      lines.push(...printYamlBlock(value as Record<string, unknown>, indent, level + 1));
    } else if (Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      for (const item of value) {
        if (typeof item === "object") {
          lines.push(...printYamlBlock(item as Record<string, unknown>, indent, level + 1));
        } else {
          lines.push(`${prefix}${indent}- ${String(item)}`);
        }
      }
    } else {
      lines.push(`${prefix}${key}: ${String(value)}`);
    }
  }

  return lines;
}

/**
 * Print an array of nodes
 */
function printNodes(nodes: Node[], indent: string, level: number): string[] {
  const lines: string[] = [];

  for (const node of nodes) {
    const nodeLines = printNode(node, indent, level);
    lines.push(...nodeLines);
  }

  return lines;
}

/**
 * Print a single node
 */
function printNode(node: Node, indent: string, level: number): string[] {
  const prefix = indent.repeat(level);

  switch (node.type) {
    case "paragraph":
      return printInlineNodesToLines((node as ParagraphNode).content).map((l) => `${prefix}${l}`);

    case "empty_paragraph":
      return Array((node as EmptyParagraphNode).count).fill("");

    case "header":
      return [
        `${prefix}${"#".repeat((node as HeaderNode).level)} ${printInlineNodes(
          (node as HeaderNode).content
        )}`,
      ];

    case "numbered_item":
      return printNumberedItem(node as NumberedItemNode, indent, level);

    case "bullet_item":
      return printBulletItem(node as BulletItemNode, indent, level);

    case "modifier":
      return printModifier(node as ModifierNode, indent, level);

    case "table":
      return printTable(node as TableNode, indent, level);

    case "if":
      return printIf(node as IfNode, indent, level);

    case "repeat":
      return printRepeat(node as RepeatNode, indent, level);

    case "foreach":
      return printForeach(node as ForeachNode, indent, level);

    case "define":
      return printDefine(node as DefineNode, indent, level);

    case "use":
      return printUse(node as UseNode, prefix);

    case "set":
      return [`${prefix}@set ${(node as SetNode).name} = ${(node as SetNode).expression}`];

    case "comment":
      return printComment(node as CommentNode, prefix);

    case "page_break":
      return [`${prefix}@pagebreak`];

    case "anchor":
      return [`${prefix}@anchor ${(node as AnchorNode).name}`];

    case "doc_header":
    case "doc_footer":
      return printDocHeaderFooter(node as DocHeaderFooterNode, indent, level);

    case "columns_region":
      return printColumnsRegion(node as ColumnsRegionNode, indent, level);

    case "blockquote":
      return printBlockquote(node as BlockquoteNode, indent, level);

    case "horizontal_rule":
      return [`${prefix}---`];

    case "footnote_def":
      return printFootnoteDefinition(node as FootnoteDefinitionNode, indent, level);

    default:
      // Fallback for unknown node types
      return [];
  }
}

/**
 * Print inline nodes to a string
 */
function printInlineNodes(nodes: InlineNode[]): string {
  const result = nodes.map(printInlineNode).join("");
  // Trim trailing whitespace from inline content
  return result.trimEnd();
}

function printInlineNodesToLines(nodes: InlineNode[]): string[] {
  const lines: string[] = [""];
  const endsWithHardBreak: boolean[] = [false];

  for (const node of nodes) {
    if (node.type === "hard_break") {
      // LDOC hard break syntax: Markdown-style two trailing spaces.
      lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + "  ";
      endsWithHardBreak[endsWithHardBreak.length - 1] = true;
      lines.push("");
      endsWithHardBreak.push(false);
      continue;
    }
    lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + printInlineNode(node);
  }

  // Remove trailing empty line if last thing was a hard break with no content after
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
    endsWithHardBreak.pop();
  }

  // Trim trailing whitespace on each line, except when it's meaningful hard-break spaces.
  return lines.map((l, i) => (endsWithHardBreak[i] ? l : l.trimEnd()));
}

function inlineHasHardBreak(nodes: InlineNode[]): boolean {
  return nodes.some((n) => n.type === "hard_break");
}

/**
 * Print a single inline node
 */
function printInlineNode(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return (node as TextNode).value;

    case "variable": {
      const v = node as VariableNode;
      // The name field already contains the full path (e.g., "user.email")
      let name = v.name;
      if (v.filters.length > 0) {
        name += " | " + v.filters.join(" | ");
      }
      return `{{${name}}}`;
    }

    case "emphasis": {
      const e = node as EmphasisNode;
      const inner = printInlineNodes(e.content);
      switch (e.style) {
        case "bold":
          return `**${inner}**`;
        case "italic":
          return `*${inner}*`;
        case "bold_italic":
          return `***${inner}***`;
        default:
          return inner;
      }
    }

    case "cross_ref":
      return `[[${(node as CrossRefNode).target}]]`;

    case "defined_term": {
      const dt = node as DefinedTermNode;
      return dt.isDefinition ? `"${dt.term}"` : `"${dt.term}"`;
    }

    case "blank":
      return "_".repeat((node as BlankNode).length);

    case "link": {
      const l = node as LinkNode;
      return `[${l.text}](${l.url})`;
    }

    case "image": {
      const i = node as ImageNode;
      return `![${i.alt}](${i.src})`;
    }

    case "strikethrough": {
      const s = node as StrikethroughNode;
      return `~~${printInlineNodes(s.content)}~~`;
    }

    case "inline_code":
      return `\`${(node as InlineCodeNode).value}\``;

    case "footnote_ref":
      return `[^${(node as FootnoteReferenceNode).label}]`;

    case "hard_break":
      // Hard breaks are printed by printInlineNodesToLines.
      return "";

    default:
      return "";
  }
}

/**
 * Print a numbered item
 */
function printNumberedItem(
  node: NumberedItemNode,
  indent: string,
  level: number
): string[] {
  const prefix = indent.repeat(level);
  const atCount = "@".repeat(node.level);
  const style = getNumberingStyleMarker(node);
  const contentLines = printInlineNodesToLines(node.content);
  const first = contentLines[0] ?? "";

  const lines: string[] = [`${prefix}${atCount}${style} ${first}`];
  for (let i = 1; i < contentLines.length; i++) {
    lines.push(`${prefix}${contentLines[i] ?? ""}`);
  }

  // Print children with incremented level
  if (node.children.length > 0) {
    const childLines = printNodes(node.children, indent, level);
    lines.push(...childLines);
  }

  return lines;
}

/**
 * Get the style marker for a numbered item (1, a, i, etc.)
 */
function getNumberingStyleMarker(node: NumberedItemNode): string {
  const style = node.style;
  if (style.type === "auto") {
    return "";
  }
  if (style.type === "decimal") {
    return style.start?.toString() ?? "1";
  }
  if (style.type === "decimal_sub") {
    return style.pattern;
  }
  if (style.type === "alpha_lower") {
    return style.start ?? "a";
  }
  if (style.type === "alpha_upper") {
    return style.start ?? "A";
  }
  if (style.type === "roman_lower") {
    return style.start ?? "i";
  }
  if (style.type === "roman_upper") {
    return style.start ?? "I";
  }
  return "";
}

/**
 * Print a bullet item
 */
function printBulletItem(
  node: BulletItemNode,
  indent: string,
  level: number
): string[] {
  const prefix = indent.repeat(level);
  const atCount = "@".repeat(node.level);
  const contentLines = printInlineNodesToLines(node.content);
  const first = contentLines[0] ?? "";

  const lines: string[] = [`${prefix}${atCount}- ${first}`];
  for (let i = 1; i < contentLines.length; i++) {
    lines.push(`${prefix}${contentLines[i] ?? ""}`);
  }

  // Print children
  if (node.children.length > 0) {
    const childLines = printNodes(node.children, indent, level);
    lines.push(...childLines);
  }

  return lines;
}

/**
 * Print a modifier block
 */
function printModifier(
  node: ModifierNode,
  indent: string,
  level: number
): string[] {
  const prefix = indent.repeat(level);
  let modifierStr = `@${node.modifier}`;

  if (node.count !== undefined && node.count > 1) {
    modifierStr += `:${node.count}`;
  }
  if (node.length !== undefined) {
    modifierStr += `=${node.length}`;
  }

  // Check if content is a single paragraph (inline modifier)
  // Only use inline form if there's no @end and no hard breaks
  if (
    !node.hasEnd &&
    node.content.length === 1 &&
    node.content[0]?.type === "paragraph"
  ) {
    const para = node.content[0] as ParagraphNode;
    if (!inlineHasHardBreak(para.content)) {
      return [`${prefix}${modifierStr} ${printInlineNodes(para.content)}`];
    }
  }

  // Block modifier with indented content
  const lines: string[] = [`${prefix}${modifierStr}`];
  const contentLines = printNodes(node.content, indent, level + 1);
  lines.push(...contentLines);

  // Preserve @end if it was in the original source
  if (node.hasEnd) {
    lines.push(`${prefix}@end`);
  }

  return lines;
}

/**
 * Print a table with aligned columns
 */
function printTable(
  node: TableNode,
  indent: string,
  level: number
): string[] {
  const prefix = indent.repeat(level);
  const rowPrefix = indent.repeat(level + 1);
  const lines: string[] = [`${prefix}@table`];

  // Calculate column widths
  const columnWidths = calculateColumnWidths(node.rows);

  // Print each row
  for (const row of node.rows) {
    const cells: string[] = [];
    for (let i = 0; i < row.cells.length; i++) {
      const cell = row.cells[i];
      if (!cell) continue;

      const cellContent = printInlineNodes(cell.content);
      const targetWidth = columnWidths[i] ?? cellContent.length;
      const paddedContent = cellContent.padEnd(targetWidth);
      cells.push(paddedContent);
    }

    lines.push(`${rowPrefix}[${cells.join(", ")}]`);
  }

  if (node.hasEnd) {
    lines.push(`${prefix}@end`);
  }

  return lines;
}

/**
 * Calculate max width for each column
 */
function calculateColumnWidths(rows: TableRowNode[]): number[] {
  const widths: number[] = [];

  for (const row of rows) {
    for (let i = 0; i < row.cells.length; i++) {
      const cell = row.cells[i];
      if (!cell) continue;

      const content = printInlineNodes(cell.content);
      const currentWidth = widths[i] ?? 0;
      widths[i] = Math.max(currentWidth, content.length);
    }
  }

  return widths;
}

/**
 * Print an @if block
 */
function printIf(node: IfNode, indent: string, level: number): string[] {
  const prefix = indent.repeat(level);
  const lines: string[] = [`${prefix}@if ${node.condition}`];

  // Then branch
  const thenLines = printNodes(node.thenBranch, indent, level + 1);
  lines.push(...thenLines);

  // Else branch
  if (node.elseBranch.length > 0) {
    lines.push(`${prefix}@else`);
    const elseLines = printNodes(node.elseBranch, indent, level + 1);
    lines.push(...elseLines);
  }

  if (node.hasEnd) {
    lines.push(`${prefix}@end`);
  }
  return lines;
}

/**
 * Print a @repeat block
 */
function printRepeat(node: RepeatNode, indent: string, level: number): string[] {
  const prefix = indent.repeat(level);
  const lines: string[] = [`${prefix}@repeat ${node.count}`];

  const bodyLines = printNodes(node.body, indent, level + 1);
  lines.push(...bodyLines);

  if (node.hasEnd) {
    lines.push(`${prefix}@end`);
  }
  return lines;
}

/**
 * Print a @foreach block
 */
function printForeach(node: ForeachNode, indent: string, level: number): string[] {
  const prefix = indent.repeat(level);
  const lines: string[] = [`${prefix}@foreach ${node.item} in ${node.iterable}`];

  const bodyLines = printNodes(node.body, indent, level + 1);
  lines.push(...bodyLines);

  if (node.hasEnd) {
    lines.push(`${prefix}@end`);
  }
  return lines;
}

/**
 * Print a @define block
 */
function printDefine(node: DefineNode, indent: string, level: number): string[] {
  const prefix = indent.repeat(level);

  // Build params string - params contains all param names in order,
  // optionalParams contains the default values for optional ones
  let paramsStr = "";
  if (node.params.length > 0) {
    const allParams: string[] = node.params.map((paramName) => {
      const defaultValue = node.optionalParams[paramName];
      if (defaultValue !== undefined) {
        return `${paramName}=${JSON.stringify(defaultValue)}`;
      }
      return paramName;
    });
    paramsStr = `(${allParams.join(", ")})`;
  }

  const lines: string[] = [`${prefix}@define ${node.name}${paramsStr}`];

  const templateLines = printNodes(node.template, indent, level + 1);
  lines.push(...templateLines);

  // Preserve @end if it was in the original source
  if (node.hasEnd) {
    lines.push(`${prefix}@end`);
  }

  return lines;
}

/**
 * Print a @use directive
 */
function printUse(node: UseNode, prefix: string): string[] {
  let argsStr = "";
  const argEntries = Object.entries(node.args);
  if (argEntries.length > 0) {
    const argParts = argEntries.map(([k, v]) => `${k}="${v}"`);
    argsStr = `(${argParts.join(", ")})`;
  }

  let labelStr = "";
  if (node.label) {
    labelStr = ` as ${node.label}`;
  }

  return [`${prefix}@use ${node.name}${argsStr}${labelStr}`];
}

/**
 * Print a comment
 */
function printComment(node: CommentNode, prefix: string): string[] {
  const marker = node.isTodo ? "// TODO:" : "//";
  return [`${prefix}${marker} ${node.value}`];
}

/**
 * Print a @header or @footer block
 */
function printDocHeaderFooter(
  node: DocHeaderFooterNode,
  indent: string,
  level: number
): string[] {
  const prefix = indent.repeat(level);
  const lines: string[] = [];

  // Build directive
  let directive = "";
  if (node.scope === "first") {
    directive = "@firstpage ";
  } else if (node.scope === "even") {
    directive = "@evenpage ";
  }

  const headerFooter = node.type === "doc_header" ? "@header" : "@footer";
  lines.push(`${prefix}${directive}${headerFooter}`);

  const contentLines = printNodes(node.content, indent, level + 1);
  lines.push(...contentLines);

  if (node.hasEnd) {
    lines.push(`${prefix}@end`);
  }

  return lines;
}

/**
 * Print a @columns region
 */
function printColumnsRegion(
  node: ColumnsRegionNode,
  indent: string,
  level: number
): string[] {
  const prefix = indent.repeat(level);

  // Build options string
  const options: string[] = [];
  if (node.gapTwip !== 720) {
    // 720 twips = 0.5in default
    const gapInch = node.gapTwip / 1440;
    options.push(`gap=${gapInch}in`);
  }
  if (node.separator) {
    options.push("separator");
  }

  const optionsStr = options.length > 0 ? " " + options.join(" ") : "";
  const lines: string[] = [`${prefix}@columns ${node.columnCount}${optionsStr}`];

  const childLines = printNodes(node.children, indent, level + 1);
  lines.push(...childLines);

  if (node.hasEnd) {
    lines.push(`${prefix}@end`);
  }
  return lines;
}

/**
 * Print a blockquote
 */
function printBlockquote(
  node: BlockquoteNode,
  indent: string,
  level: number
): string[] {
  const prefix = indent.repeat(level);
  const lines: string[] = [];

  for (const child of node.content) {
    const childLines = printNode(child, indent, level);
    for (const line of childLines) {
      lines.push(`${prefix}> ${line.trim()}`);
    }
  }

  return lines;
}

/**
 * Print a footnote definition
 */
function printFootnoteDefinition(
  node: FootnoteDefinitionNode,
  indent: string,
  level: number
): string[] {
  const prefix = indent.repeat(level);
  const lines: string[] = [`${prefix}[^${node.label}]:`];

  const contentLines = printNodes(node.content, indent, level + 1);
  lines.push(...contentLines);

  if (node.hasEnd) {
    lines.push(`${prefix}@end`);
  }

  return lines;
}

export { format as formatLdoc };
