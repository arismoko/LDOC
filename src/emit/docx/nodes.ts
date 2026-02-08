/**
 * DOCX Node Emission
 * 
 * Converts Document IR Block/Inline nodes to docx Paragraph/Table/TextRun objects.
 */

import {
  Paragraph,
  TextRun,
  ImageRun,
  ExternalHyperlink,
  InternalHyperlink,
  Bookmark,
  PageBreak,
  ColumnBreak,
  FootnoteReferenceRun,
  Tab as DocxTab,
  PageNumber,
  BorderStyle,
  Table as DocxTableClass,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  TableLayoutType,
} from "docx";
import type { Table as DocxTable, IRunOptions, IParagraphOptions } from "docx";

import type {
  Block,
  Inline,
  Paragraph as ParagraphNode,
  List,
  ListItem,
  Table,
  TableRow,
  TableCell,
  Blockquote,
  Box,
  Section,
  PageBreak as PageBreakNode,
  ColumnBreak as ColumnBreakNode,
  HorizontalRule,
  Footnote,
  Text,
  Styled,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlight,
  Code,
  Link,
  Image,
  FootnoteRef,
  CrossRef,
  Anchor,
  HardBreak,
  Tab,
  Field,
  StyleRef,
} from "../../types/document-ir.ts";
import type { ComputedStyle, NumberingDefinition, StyleResolver } from "../../types/styled.ts";
import type { Diagnostic } from "../../types/diagnostics.ts";
import type { SourceLocation } from "../../types/source-location.ts";
import { toRunOptions, toParagraphOptions } from "./styles.ts";
import { getNumberingReference } from "./numbering.ts";
import { emitTable } from "./tables.ts";
import { bookmarkSafeName } from "../../shared/bookmarks.ts";
import { type Mutable } from "./utils.ts";

/** Synthetic location for diagnostics when node has no source location */
const SYNTHETIC_LOC: SourceLocation = { line: 1, column: 0, endLine: 1, endColumn: 0 };

// =============================================================================
// Emit Context
// =============================================================================

export interface EmitContext {
  /** Resolve StyleRef to ComputedStyle */
  resolveStyle: StyleResolver;
  /** Numbering definitions from STYLE phase */
  numberingDefinitions: NumberingDefinition[];
  /** Collected footnotes (label → content) */
  footnotes: Map<string, Block[]>;
  /** Footnote ID assignment (label → numeric ID) */
  footnoteIds: Map<string, number>;
  /** Image data cache (src → data) */
  imageData: Map<string, Uint8Array>;
  /** Used bookmark names */
  bookmarks: Set<string>;
  /** Diagnostics collected during emission */
  diagnostics: Diagnostic[];
  /** Base path for resolving relative image paths */
  basePath?: string;
  /** Current list nesting level */
  listLevel: number;
  /** Numbering mode (e.g., "tiered" or "legal") */
  numberingMode?: string;
  /** Tracks next instance ID per numbering reference (for start/continue) */
  numberingInstances: Map<string, number>;
  /** Tracks the last instance used per continuation key (for continue) */
  lastNumberingInstance: Map<string, number>;
  /** Tracks the last reference used per continuation key (for continue after start) */
  lastNumberingReference: Map<string, string>;
  /** Current blockquote nesting level (0 = not in blockquote) */
  blockquoteLevel: number;
}

/**
 * Options for inline emission.
 */
interface InlineEmitOptions {
  /** Word character style to apply (e.g., "Hyperlink") */
  runStyle?: string;
}

// =============================================================================
// Block Emission
// =============================================================================

/** Result type for block emission */
export type DocxBlock = Paragraph | DocxTable;

/**
 * Emit a Block node to docx Paragraph/Table array.
 */
export function emitBlock(block: Block, ctx: EmitContext): DocxBlock[] {
  switch (block.type) {
    case "Paragraph":
      return emitParagraph(block, ctx);
    case "List":
      return emitList(block, ctx);
    case "Table":
      return [emitTable(block, ctx)];
    case "Blockquote":
      return emitBlockquote(block, ctx);
    case "Box":
      return emitBox(block, ctx);
    case "Section":
      return emitSection(block, ctx);
    case "PageBreak":
      return emitPageBreak();
    case "ColumnBreak":
      return emitColumnBreak();
    case "HorizontalRule":
      return emitHorizontalRule();
    case "Footnote":
      return emitFootnote(block, ctx);
    case "Anchor":
      return emitAnchor(block, ctx);
    default:
      const _exhaustive: never = block;
      throw new Error(`Unknown block type: ${(block as Block).type}`);
  }
}

/**
 * Emit blocks array to docx blocks array.
 */
export function emitBlocks(blocks: Block[], ctx: EmitContext): DocxBlock[] {
  return blocks.flatMap((block) => emitBlock(block, ctx));
}

function emitParagraph(node: ParagraphNode, ctx: EmitContext): DocxBlock[] {
  const style = resolveNodeStyle(node.style, ctx);
  const children = emitInlines(node.content, ctx, style);
  
  const paragraphOpts = toParagraphOptions(style);
  applyContainerStyles(paragraphOpts, ctx);
  
  return [
    new Paragraph({
      ...paragraphOpts,
      children,
    }),
  ];
}

function emitList(node: List, ctx: EmitContext): DocxBlock[] {
  const results: DocxBlock[] = [];
  const baseReference = getNumberingReference(
    node.ordered,
    node.numberFormat,
    ctx.numberingDefinitions,
    ctx.numberingMode
  );
  let reference = baseReference;
  
  // Handle start: N — create a dynamic numbering definition with custom start
  if (node.start !== undefined && node.start !== 1 && node.ordered) {
    const dynamicRef = `${baseReference}-lvl-${ctx.listLevel}-start-${node.start}`;
    const existingDef = ctx.numberingDefinitions.find((d) => d.id === dynamicRef);
    if (!existingDef) {
      // Clone the base definition's levels with the custom start value at the active nesting level
      const baseDef = ctx.numberingDefinitions.find((d) => d.id === baseReference);
      if (baseDef) {
        ctx.numberingDefinitions.push({
          id: dynamicRef,
          levels: baseDef.levels.map((l) => ({ ...l, start: l.level === ctx.listLevel ? node.start : undefined })),
        });
        reference = dynamicRef;
      }
      // If baseDef not found (e.g. default not yet created), keep original reference
    } else {
      reference = dynamicRef;
    }
  }

  // Continuation is keyed by logical list family (base reference + level), not by
  // the dynamic start-override reference. This ensures @#(continue: true) finds the
  // most recent list even if it was started with @#(start: N).
  const continuationKey = `${baseReference}:${ctx.listLevel}`;
  let instance: number | undefined;
  if (node.continue) {
    // Continue: reuse the last instance AND reference for this base reference at this level.
    // The reference may differ from baseReference if the original list used start: N.
    instance = ctx.lastNumberingInstance.get(continuationKey);
    const lastRef = ctx.lastNumberingReference.get(continuationKey);
    if (instance !== undefined && lastRef) {
      reference = lastRef;
    }
  }
  if (instance === undefined) {
    // New list: allocate a fresh instance
    const next = (ctx.numberingInstances.get(reference) ?? 0) + 1;
    ctx.numberingInstances.set(reference, next);
    instance = next;
  }
  ctx.lastNumberingInstance.set(continuationKey, instance);
  ctx.lastNumberingReference.set(continuationKey, reference);

  // Save current level and increment
  const savedLevel = ctx.listLevel;
  
  for (const item of node.items) {
    results.push(...emitListItem(item, reference, instance, ctx));
  }
  
  // Restore level
  ctx.listLevel = savedLevel;
  
  return results;
}

function emitListItem(
  item: ListItem,
  reference: string,
  instance: number,
  ctx: EmitContext
): DocxBlock[] {
  const results: DocxBlock[] = [];
  const style = resolveNodeStyle(item.style, ctx);
  const children = emitInlines(item.content, ctx, style);
  
  // Main list item paragraph with numbering
  if (item.content.length > 0) {
    const paragraphOpts = toParagraphOptions(style);
    applyContainerStyles(paragraphOpts, ctx);
    results.push(
      new Paragraph({
        ...paragraphOpts,
        children,
        numbering: {
          reference,
          level: ctx.listLevel,
          instance,
        },
      })
    );
  }
  
  // Process nested blocks (including nested lists)
  for (const child of item.children) {
    if (child.type === "List") {
      // Nested list - increase level
      ctx.listLevel++;
      results.push(...emitBlock(child, ctx));
      ctx.listLevel--;
    } else if (child.type === "Paragraph") {
      results.push(emitListContinuationParagraph(child, reference, ctx));
    } else {
      results.push(...emitBlock(child, ctx));
    }
  }
  
  return results;
}

function emitListContinuationParagraph(
  node: ParagraphNode,
  reference: string,
  ctx: EmitContext,
): Paragraph {
  const style = resolveNodeStyle(node.style, ctx);
  const children = emitInlines(node.content, ctx, style);
  const options = toParagraphOptions(style);
  applyContainerStyles(options, ctx);
  const continuationIndent = getListContinuationIndent(reference, ctx.listLevel, ctx);
  const optionsWithIndent = continuationIndent === undefined
    ? options
    : {
        ...options,
        indent: {
          ...(options.indent ?? {}),
          left: options.indent?.left ?? continuationIndent,
        },
      };

  return new Paragraph({
    ...optionsWithIndent,
    children,
  });
}

function getListContinuationIndent(
  reference: string,
  level: number,
  ctx: EmitContext,
): number | undefined {
  const numbering = ctx.numberingDefinitions.find((definition) => definition.id === reference);
  const levelConfig = numbering?.levels.find((candidate) => candidate.level === level);
  return levelConfig?.indent;
}

function emitBlockquote(node: Blockquote, ctx: EmitContext): DocxBlock[] {
  // Create a child context with incremented blockquote level
  const childCtx: EmitContext = { ...ctx, blockquoteLevel: ctx.blockquoteLevel + 1 };
  return emitBlocks(node.content, childCtx);
}

/** Indent per blockquote nesting level (400 twips ≈ 0.28 inches) */
const BLOCKQUOTE_INDENT = 400;

/**
 * Apply container styling (blockquote / box) to paragraph options.
 * Centralized to avoid duplication between emitParagraph, emitListItem,
 * and emitListContinuationParagraph.
 */
function applyContainerStyles(opts: Mutable<IParagraphOptions>, ctx: EmitContext): void {
  if (ctx.blockquoteLevel > 0) {
    applyBlockquoteStyle(opts, ctx.blockquoteLevel);
  }
}

/**
 * Apply blockquote visual styling to paragraph options (mutates in place).
 * - Left border: 2pt grey
 * - Left indent: 400 twips per nesting level
 */
function applyBlockquoteStyle(opts: Mutable<IParagraphOptions>, level: number): void {
  // Left border — grey, 2pt
  const border = (opts.border ?? {}) as Mutable<NonNullable<IParagraphOptions["border"]>>;
  border.left = {
    color: "999999",
    size: 16, // 2pt in eighths
    style: BorderStyle.SINGLE,
    space: 4,
  };
  opts.border = border;

  // Left indent stacks with existing indent
  const existingLeft = (opts.indent as { left?: number } | undefined)?.left ?? 0;
  opts.indent = {
    ...opts.indent,
    left: existingLeft + BLOCKQUOTE_INDENT * level,
  };
}

/** Box border width (1pt in eighths = 8) */
const BOX_BORDER_SIZE = 8;

/**
 * Emit a Box as a single-cell table with borders on all four sides.
 *
 * OOXML has no native "bordered container" primitive for flow content;
 * a 1×1 table is the standard interoperable pattern (used by Word for
 * text boxes, callouts, and "Borders and Shading" groups).
 */
function emitBox(node: Box, ctx: EmitContext): DocxBlock[] {
  const children = emitBlocks(node.content, ctx);
  // Ensure at least one paragraph in cell (DOCX requirement)
  const content = children.length > 0 ? children : [new Paragraph({})];

  const borderSide = {
    color: "000000",
    size: BOX_BORDER_SIZE,
    style: BorderStyle.SINGLE,
  };

  const cell = new DocxTableCell({
    children: content as (Paragraph | DocxTableClass)[],
    margins: { top: 100, bottom: 100, left: 150, right: 150 },
    borders: {
      top: borderSide,
      bottom: borderSide,
      left: borderSide,
      right: borderSide,
    },
  });

  const row = new DocxTableRow({ children: [cell] });

  const table = new DocxTableClass({
    rows: [row],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
    // Suppress interior grid lines (single cell, but be explicit)
    borders: {
      top: borderSide,
      bottom: borderSide,
      left: borderSide,
      right: borderSide,
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
  });

  return [table];
}

function emitSection(node: Section, ctx: EmitContext): DocxBlock[] {
  // Sections are handled at the document level
  // Here we just emit the content
  return emitBlocks(node.content, ctx);
}

function emitPageBreak(): DocxBlock[] {
  return [new Paragraph({ children: [new PageBreak()] })];
}

function emitColumnBreak(): DocxBlock[] {
  return [new Paragraph({ children: [new ColumnBreak()] })];
}

function emitHorizontalRule(): DocxBlock[] {
  return [
    new Paragraph({
      border: {
        bottom: {
          color: "000000",
          space: 1,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
    }),
  ];
}

function emitFootnote(node: Footnote, ctx: EmitContext): DocxBlock[] {
  // Register footnote for later emission
  ctx.footnotes.set(node.label, node.content);
  
  // Assign ID if not already assigned
  if (!ctx.footnoteIds.has(node.label)) {
    ctx.footnoteIds.set(node.label, ctx.footnoteIds.size + 1);
  }
  
  // Return empty - footnotes are emitted separately
  return [];
}

// =============================================================================
// Inline Emission
// =============================================================================

/** Result type for inline emission */
export type DocxInline = TextRun | ImageRun | ExternalHyperlink | InternalHyperlink | Bookmark | FootnoteReferenceRun;

/**
 * Emit an Inline node to docx run/element array.
 */
export function emitInline(node: Inline, ctx: EmitContext, parentStyle: ComputedStyle, options?: InlineEmitOptions): DocxInline[] {
  switch (node.type) {
    case "Text":
      return emitText(node, parentStyle, options);
    case "Styled":
      return emitStyled(node, ctx, parentStyle, options);
    case "Bold":
      return emitBold(node, ctx, parentStyle, options);
    case "Italic":
      return emitItalic(node, ctx, parentStyle, options);
    case "Underline":
      return emitUnderline(node, ctx, parentStyle, options);
    case "Strikethrough":
      return emitStrikethrough(node, ctx, parentStyle, options);
    case "Highlight":
      return emitHighlight(node, ctx, parentStyle, options);
    case "Code":
      return emitCode(node, parentStyle, options);
    case "Link":
      return emitLink(node, ctx, parentStyle);
    case "Image":
      return emitImage(node, ctx);
    case "FootnoteRef":
      return emitFootnoteRef(node, ctx);
    case "CrossRef":
      return emitCrossRef(node, ctx, parentStyle);
    case "HardBreak":
      return emitHardBreak();
    case "Tab":
      return emitTab();
    case "Field":
      return emitField(node);
    default:
      const _exhaustive: never = node;
      throw new Error(`Unknown inline type: ${(node as Inline).type}`);
  }
}

/**
 * Emit inlines array to docx runs.
 */
export function emitInlines(
  inlines: Inline[],
  ctx: EmitContext,
  parentStyle: ComputedStyle,
  options?: InlineEmitOptions
): DocxInline[] {
  return inlines.flatMap((inline) => emitInline(inline, ctx, parentStyle, options));
}

function emitText(node: Text, style: ComputedStyle, options?: InlineEmitOptions): TextRun[] {
  return [new TextRun({ text: node.value, ...toRunOptions(style), ...(options?.runStyle ? { style: options.runStyle } : {}) })];
}

function emitStyled(node: Styled, ctx: EmitContext, parentStyle: ComputedStyle, options?: InlineEmitOptions): TextRun[] {
  // Apply inline style overrides
  const mergedStyle = { ...parentStyle };
  const s = node.style;
  
  if (s.bold !== undefined) mergedStyle.bold = s.bold;
  if (s.italic !== undefined) mergedStyle.italic = s.italic;
  if (s.underline !== undefined) mergedStyle.underline = s.underline;
  if (s.strikethrough !== undefined) mergedStyle.strikethrough = s.strikethrough;
  if (s.color !== undefined) mergedStyle.color = s.color;
  if (s.fontSize !== undefined) mergedStyle.fontSize = s.fontSize;
  if (s.fontFamily !== undefined) mergedStyle.fontFamily = s.fontFamily;
  
  return emitInlines(node.content, ctx, mergedStyle, options) as TextRun[];
}

function emitBold(node: Bold, ctx: EmitContext, parentStyle: ComputedStyle, options?: InlineEmitOptions): TextRun[] {
  const style = { ...parentStyle, bold: true };
  return emitInlines(node.content, ctx, style, options) as TextRun[];
}

function emitItalic(node: Italic, ctx: EmitContext, parentStyle: ComputedStyle, options?: InlineEmitOptions): TextRun[] {
  const style = { ...parentStyle, italic: true };
  return emitInlines(node.content, ctx, style, options) as TextRun[];
}

function emitUnderline(node: Underline, ctx: EmitContext, parentStyle: ComputedStyle, options?: InlineEmitOptions): TextRun[] {
  const style = { ...parentStyle, underline: true };
  return emitInlines(node.content, ctx, style, options) as TextRun[];
}

function emitStrikethrough(node: Strikethrough, ctx: EmitContext, parentStyle: ComputedStyle, options?: InlineEmitOptions): TextRun[] {
  const style = { ...parentStyle, strikethrough: true };
  return emitInlines(node.content, ctx, style, options) as TextRun[];
}

function emitHighlight(node: Highlight, ctx: EmitContext, parentStyle: ComputedStyle, options?: InlineEmitOptions): TextRun[] {
  const style = { ...parentStyle, highlightColor: node.color ?? "yellow" };
  return emitInlines(node.content, ctx, style, options) as TextRun[];
}

function emitCode(node: Code, parentStyle: ComputedStyle, options?: InlineEmitOptions): TextRun[] {
  const style = { ...parentStyle, fontFamily: "Courier New" };
  return [new TextRun({ text: node.value, ...toRunOptions(style), ...(options?.runStyle ? { style: options.runStyle } : {}) })];
}

function emitLink(node: Link, ctx: EmitContext, parentStyle: ComputedStyle): ExternalHyperlink[] {
  const children = emitInlines(node.content, ctx, parentStyle, { runStyle: "Hyperlink" });
  return [
    new ExternalHyperlink({
      children,
      link: node.url,
    }),
  ];
}

function emitImage(node: Image, ctx: EmitContext): (TextRun | ImageRun)[] {
  // Try to get image data
  const data = node.data ?? ctx.imageData.get(node.src);
  
  if (!data) {
    // Image not found - emit placeholder
    ctx.diagnostics.push({
      severity: "warning",
      code: "E001",
      message: `Image not found: ${node.src}`,
      location: node.loc ?? SYNTHETIC_LOC,
    });
    return [new TextRun({ text: `[Image: ${node.alt ?? node.src}]`, color: "999999" })];
  }
  
  // Default dimensions if not specified
  const width = node.width ?? 200;
  const height = node.height ?? 200;
  
  return [
    new ImageRun({
      data,
      transformation: { width, height },
      type: "png",
    }),
  ];
}

function emitFootnoteRef(node: FootnoteRef, ctx: EmitContext): (TextRun | FootnoteReferenceRun)[] {
  const id = ctx.footnoteIds.get(node.label);
  
  if (id === undefined) {
    ctx.diagnostics.push({
      severity: "warning",
      code: "E002",
      message: `Footnote not found: ${node.label}`,
      location: node.loc ?? SYNTHETIC_LOC,
    });
    return [new TextRun({ text: `[^${node.label}]`, color: "FF0000" })];
  }
  
  return [new FootnoteReferenceRun(id)];
}

function emitCrossRef(node: CrossRef, ctx: EmitContext, _parentStyle: ComputedStyle): (TextRun | InternalHyperlink)[] {
  const anchorId = bookmarkSafeName(node.target);
  
  // Defense-in-depth: binder warns about missing targets (B009),
  // but if the document still reaches emit, fall back to plain text
  // instead of emitting a dead hyperlink.
  if (!ctx.bookmarks.has(anchorId)) {
    return [new TextRun({ text: node.text ?? node.target, italics: true })];
  }

  return [
    new InternalHyperlink({
      anchor: anchorId,
      children: [new TextRun({ text: node.text ?? node.target, style: "Hyperlink" })],
    }),
  ];
}

function emitAnchor(node: Anchor, ctx: EmitContext): DocxBlock[] {
  const anchorId = bookmarkSafeName(node.id);
  ctx.bookmarks.add(anchorId);
  // Emit an empty paragraph containing only a zero-width bookmark
  return [new Paragraph({
    children: [new Bookmark({ id: anchorId, children: [] })],
  })];
}

function emitHardBreak(): TextRun[] {
  return [new TextRun({ break: 1 })];
}

function emitTab(): TextRun[] {
  return [new TextRun({ children: [new DocxTab()] })];
}

function emitField(node: Field): TextRun[] {
  switch (node.fieldType) {
    case "PAGE":
      return [new TextRun({ children: [PageNumber.CURRENT] })];
    case "NUMPAGES":
      return [new TextRun({ children: [PageNumber.TOTAL_PAGES] })];
    case "DATE":
    case "TIME":
      // These would need field codes - for now, emit placeholder
      return [new TextRun({ text: `{${node.fieldType}}` })];
    default:
      return [new TextRun({ text: `{${node.fieldType}}` })];
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolve a node's style reference to ComputedStyle.
 */
function resolveNodeStyle(styleRef: StyleRef | undefined, ctx: EmitContext): ComputedStyle {
  if (!styleRef) {
    return ctx.resolveStyle({});
  }
  return ctx.resolveStyle(styleRef);
}
