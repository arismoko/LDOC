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
} from "docx";
import type { Table as DocxTable, IRunOptions } from "docx";

import type {
  Block,
  Inline,
  Paragraph as ParagraphNode,
  Heading,
  List,
  ListItem,
  Table,
  TableRow,
  TableCell,
  Blockquote,
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
  Bookmark as BookmarkNode,
  HardBreak,
  Tab,
  Field,
  StyleRef,
} from "../../types/document-ir.ts";
import type { ComputedStyle, NumberingDefinition, StyleResolver } from "../../types/styled.ts";
import type { Diagnostic } from "../../types/diagnostics.ts";
import type { SourceLocation } from "../../types/source-location.ts";
import { toRunOptions, toParagraphOptions, toHeadingLevel } from "./styles.ts";
import { getNumberingReference } from "./numbering.ts";
import { emitTable } from "./tables.ts";
import { bookmarkSafeName } from "../../shared/bookmarks.ts";

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
  /** Tracks the last instance used per numbering reference (for continue) */
  lastNumberingInstance: Map<string, number>;
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
    case "Heading":
      return emitHeading(block, ctx);
    case "List":
      return emitList(block, ctx);
    case "Table":
      return [emitTable(block, ctx)];
    case "Blockquote":
      return emitBlockquote(block, ctx);
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
  
  return [
    new Paragraph({
      ...toParagraphOptions(style),
      children,
    }),
  ];
}

function emitHeading(node: Heading, ctx: EmitContext): DocxBlock[] {
  const style = resolveNodeStyle(node.style, ctx);
  const inlineChildren = emitInlines(node.content, ctx, style);
  
  // Register bookmark if anchor is specified
  if (node.anchor) {
    const anchorId = bookmarkSafeName(node.anchor);
    ctx.bookmarks.add(anchorId);
    // For bookmarks, wrap inline content in a Bookmark
    // docx Bookmark wraps content, so we pass children to it
    return [
      new Paragraph({
        ...toParagraphOptions(style),
        heading: toHeadingLevel(node.level),
        children: [new Bookmark({ id: anchorId, children: inlineChildren })],
      }),
    ];
  }
  
  return [
    new Paragraph({
      ...toParagraphOptions(style),
      heading: toHeadingLevel(node.level),
      children: inlineChildren,
    }),
  ];
}

function emitList(node: List, ctx: EmitContext): DocxBlock[] {
  const results: DocxBlock[] = [];
  let reference = getNumberingReference(
    node.ordered,
    node.numberFormat,
    ctx.numberingDefinitions,
    ctx.numberingMode
  );
  
  // Handle start: N — create a dynamic numbering definition with custom start
  if (node.start !== undefined && node.start !== 1 && node.ordered) {
    const dynamicRef = `${reference}-start-${node.start}`;
    const existingDef = ctx.numberingDefinitions.find((d) => d.id === dynamicRef);
    if (!existingDef) {
      // Clone the base definition's levels with the custom start value
      const baseDef = ctx.numberingDefinitions.find((d) => d.id === reference);
      if (baseDef) {
        ctx.numberingDefinitions.push({
          id: dynamicRef,
          levels: baseDef.levels.map((l) => ({ ...l, start: l.level === 0 ? node.start : undefined })),
        });
      }
    }
    reference = dynamicRef;
  }

  // Determine numbering instance for start/continue semantics
  let instance: number | undefined;
  if (node.continue) {
    // Continue: reuse the last instance for this reference
    instance = ctx.lastNumberingInstance.get(reference);
  }
  if (instance === undefined) {
    // New list: allocate a fresh instance
    const next = (ctx.numberingInstances.get(reference) ?? 0) + 1;
    ctx.numberingInstances.set(reference, next);
    instance = next;
  }
  ctx.lastNumberingInstance.set(reference, instance);

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
    results.push(
      new Paragraph({
        ...toParagraphOptions(style),
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
  // Blockquotes render as indented, italic paragraphs with left border
  const results: DocxBlock[] = [];
  
  for (const child of node.content) {
    const blocks = emitBlock(child, ctx);
    for (const block of blocks) {
      if (block instanceof Paragraph) {
        // Add blockquote styling (left border, indent, italic)
        // Note: We'd need to modify the paragraph options here
        // For now, just pass through - full styling in Phase 6
        results.push(block);
      } else {
        results.push(block);
      }
    }
  }
  
  return results;
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
    case "Bookmark":
      return emitBookmark(node, ctx);
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

function emitCrossRef(node: CrossRef, ctx: EmitContext, parentStyle: ComputedStyle): (TextRun | InternalHyperlink)[] {
  const anchorId = bookmarkSafeName(node.target);
  
  if (!ctx.bookmarks.has(anchorId)) {
    ctx.diagnostics.push({
      severity: "warning",
      code: "E003",
      message: `Cross-reference target not found: ${node.target}`,
      location: node.loc ?? SYNTHETIC_LOC,
    });
    return [new TextRun({ text: node.text ?? node.target, italics: true })];
  }
  
  return [
    new InternalHyperlink({
      anchor: anchorId,
      children: [new TextRun({ text: node.text ?? node.target, style: "Hyperlink" })],
    }),
  ];
}

function emitBookmark(node: BookmarkNode, ctx: EmitContext): Bookmark[] {
  const anchorId = bookmarkSafeName(node.name);
  ctx.bookmarks.add(anchorId);
  // Emit a zero-width bookmark (start + end markers with no visible content)
  return [new Bookmark({ id: anchorId, children: [] })];
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
