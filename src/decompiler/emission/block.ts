/**
 * Block Emission
 *
 * Converts SemanticNode tree to LDOC block syntax:
 * - Headings: # H1, ## H2, @h1/@h2 blocks for multi-line
 * - Lists: - item, 1. item
 * - Paragraphs: plain text with inline formatting
 * - Groups: @style(spacing/align), @indent blocks
 * - Anchors: @anchor(name)
 */

import type {
  SemanticNode,
  SemanticParagraph,
  SemanticGroup,
  SpacingGroupAttrs,
  AlignmentGroupAttrs,
  IndentGroupAttrs,
} from "../semantic/types";
import { isParagraph, isTable, isGroup } from "../semantic/types";
import type { EmissionContext } from "./types";
import { indentContext } from "./types";
import { emitInlineContent } from "./inline";
import { emitTable } from "./table";
import { formatTwipsAsPt } from "../../shared/units";

/**
 * Format style attributes for @style directive.
 */
function formatStyleAttrs(
  attrs: Record<string, string>,
  spacing?: { spacingAfter?: number; spacingBefore?: number },
): string {
  const identRe = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  const isNumber = (v: string) => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(v);
  const isLength = (v: string) => /^(?:\d+(?:\.\d+)?|\.\d+)(?:in|pt|cm|mm|twip)$/i.test(v);

  const formatValue = (v: string) => {
    if (v === "true" || v === "false") return v;
    if (isNumber(v) || isLength(v) || identRe.test(v)) return v;
    return JSON.stringify(v);
  };

  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === "true") {
      parts.push(k);
    } else {
      parts.push(`${k}: ${formatValue(v)}`);
    }
  }

  if (spacing?.spacingAfter !== undefined) {
    parts.push(`spacing-after: ${spacing.spacingAfter}`);
  }
  if (spacing?.spacingBefore !== undefined) {
    parts.push(`spacing-before: ${spacing.spacingBefore}`);
  }

  return parts.join(", ");
}

/**
 * Emit anchors (bookmarks) as @anchor directives.
 */
function emitAnchors(anchors: string[], ctx: EmissionContext): string[] {
  return anchors.map((name) => `${ctx.indent}@anchor(${name})`);
}

/**
 * Emit a heading.
 */
function emitHeading(para: SemanticParagraph, ctx: EmissionContext): string[] {
  const lines: string[] = [];

  // Emit anchors first
  lines.push(...emitAnchors(para.anchors, ctx));

  const level = para.headingLevel ?? 1;
  const content = emitInlineContent(para.extracted.content, ctx);

  // Check for multi-line content
  if (content.includes("\n")) {
    // Multi-line heading: use @h1 block syntax
    lines.push(`${ctx.indent}@h${level}`);
    const childCtx = indentContext(ctx);
    for (const line of content.split("\n")) {
      lines.push(`${childCtx.indent}${line}`);
    }
  } else {
    // Single-line heading: use # syntax
    const hashes = "#".repeat(Math.max(1, Math.min(6, level)));
    lines.push(`${ctx.indent}${hashes} ${content}`);
  }

  return lines;
}

/**
 * Emit a list item.
 */
function emitListItem(para: SemanticParagraph, ctx: EmissionContext): string[] {
  const lines: string[] = [];

  // Emit anchors first
  lines.push(...emitAnchors(para.anchors, ctx));

  const prefix = para.listPrefix ?? "- ";
  const content = emitInlineContent(para.extracted.content, ctx);

  // Handle multi-line list items
  const contentLines = content.split("\n");
  lines.push(`${ctx.indent}${prefix}${contentLines[0] ?? ""}`);

  // Continuation lines get extra indentation
  const continuationIndent = ctx.indent + " ".repeat(prefix.length);
  for (let i = 1; i < contentLines.length; i++) {
    lines.push(`${continuationIndent}${contentLines[i]}`);
  }

  return lines;
}

/**
 * Emit a normal (non-heading, non-list, non-empty) paragraph.
 */
function emitNormalParagraph(para: SemanticParagraph, ctx: EmissionContext): string[] {
  const lines: string[] = [];

  // Emit anchors first
  lines.push(...emitAnchors(para.anchors, ctx));

  const content = emitInlineContent(para.extracted.content, ctx);

  // Handle single indented paragraph when emitIndent is enabled
  if (ctx.emitIndent && para.indentLeftTwips > 0) {
    const len = formatTwipsAsPt(para.indentLeftTwips);
    
    // Check if we need nested alignment
    if (para.alignment) {
      lines.push(`${ctx.indent}@indent(length: ${len})`);
      const childCtx = indentContext(ctx);
      lines.push(`${childCtx.indent}@style(align: ${para.alignment})`);
      const innerCtx = indentContext(childCtx);
      for (const line of content.split("\n")) {
        lines.push(`${innerCtx.indent}${line}`);
      }
      return lines;
    }
    
    // Simple inline form: @indent(length: X): content
    lines.push(`${ctx.indent}@indent(length: ${len}): ${content}`);
    return lines;
  }

  // Handle alignment for single paragraphs (not in alignment group)
  if (para.alignment && !para.isEmpty) {
    lines.push(`${ctx.indent}@style(align: ${para.alignment})`);
    const childCtx = indentContext(ctx);
    for (const line of content.split("\n")) {
      lines.push(`${childCtx.indent}${line}`);
    }
    return lines;
  }

  // Handle style attributes
  if (para.styleAttrs && Object.keys(para.styleAttrs).length > 0) {
    const attrStr = formatStyleAttrs(para.styleAttrs);
    lines.push(`${ctx.indent}@style(${attrStr})`);
    const childCtx = indentContext(ctx);
    for (const line of content.split("\n")) {
      lines.push(`${childCtx.indent}${line}`);
    }
    return lines;
  }

  // Simple paragraph - split on newlines and indent each
  for (const line of content.split("\n")) {
    lines.push(`${ctx.indent}${line}`);
  }

  return lines;
}

/**
 * Emit an empty paragraph.
 */
function emitEmptyParagraph(para: SemanticParagraph, ctx: EmissionContext): string[] {
  const lines: string[] = [];

  // Emit anchors first
  lines.push(...emitAnchors(para.anchors, ctx));

  // Empty paragraphs need blank lines to trigger EmptyParagraphNode in parser
  lines.push("");
  lines.push(`${ctx.indent}`);

  return lines;
}

/**
 * Emit a page break.
 */
function emitPageBreak(para: SemanticParagraph, ctx: EmissionContext): string[] {
  const lines: string[] = [];

  // Emit anchors first
  lines.push(...emitAnchors(para.anchors, ctx));

  lines.push(`${ctx.indent}@pagebreak`);

  return lines;
}

/**
 * Emit a semantic paragraph.
 */
export function emitParagraph(para: SemanticParagraph, ctx: EmissionContext): string[] {
  switch (para.kind) {
    case "heading":
      return emitHeading(para, ctx);
    case "list":
      return emitListItem(para, ctx);
    case "empty":
      return emitEmptyParagraph(para, ctx);
    case "pageBreak":
      return emitPageBreak(para, ctx);
    case "normal":
    default:
      return emitNormalParagraph(para, ctx);
  }
}

/**
 * Emit a spacing group.
 */
function emitSpacingGroup(group: SemanticGroup, ctx: EmissionContext): string[] {
  const attrs = group.attrs as SpacingGroupAttrs;
  const lines: string[] = [];

  const styleStr = formatStyleAttrs({}, attrs);
  lines.push(`${ctx.indent}@style(${styleStr})`);

  const childCtx = indentContext(ctx);
  for (const child of group.children) {
    lines.push(...emitNode(child, childCtx));
  }

  return lines;
}

/**
 * Emit an alignment group.
 */
function emitAlignmentGroup(group: SemanticGroup, ctx: EmissionContext): string[] {
  const attrs = group.attrs as AlignmentGroupAttrs;
  const lines: string[] = [];

  lines.push(`${ctx.indent}@style(align: ${attrs.alignment})`);

  const childCtx = indentContext(ctx);
  for (let i = 0; i < group.children.length; i++) {
    const child = group.children[i]!;
    lines.push(...emitNode(child, childCtx));

    // Add separator between non-empty items
    if (isParagraph(child) && !child.isEmpty) {
      const hasMore = group.children.slice(i + 1).some(
        (c) => isParagraph(c) && !c.isEmpty
      );
      if (hasMore) {
        lines.push(`${childCtx.indent}`);
      }
    }
  }

  return lines;
}

/**
 * Emit an indent group.
 */
function emitIndentGroup(group: SemanticGroup, ctx: EmissionContext): string[] {
  const attrs = group.attrs as IndentGroupAttrs;
  const lines: string[] = [];

  const len = formatTwipsAsPt(attrs.indentTwips);
  lines.push(`${ctx.indent}@indent(length: ${len})`);

  const childCtx = indentContext(ctx);
  for (const child of group.children) {
    lines.push(...emitNode(child, childCtx));
  }

  return lines;
}

/**
 * Emit a group node.
 */
export function emitGroup(group: SemanticGroup, ctx: EmissionContext): string[] {
  switch (group.groupKind) {
    case "spacing":
      return emitSpacingGroup(group, ctx);
    case "alignment":
      return emitAlignmentGroup(group, ctx);
    case "indent":
      return emitIndentGroup(group, ctx);
    default:
      // Fallback: emit children directly
      const lines: string[] = [];
      for (const child of group.children) {
        lines.push(...emitNode(child, ctx));
      }
      return lines;
  }
}

/**
 * Emit any semantic node.
 */
export function emitNode(node: SemanticNode, ctx: EmissionContext): string[] {
  if (isParagraph(node)) {
    return emitParagraph(node, ctx);
  }
  if (isTable(node)) {
    return emitTable(node.extracted, ctx);
  }
  if (isGroup(node)) {
    return emitGroup(node, ctx);
  }
  return [];
}

/**
 * Emit an array of semantic nodes.
 */
export function emitNodes(nodes: SemanticNode[], ctx: EmissionContext): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    lines.push(...emitNode(node, ctx));
  }
  return lines;
}
