/**
 * Phase 5: EMIT (DOCX)
 * 
 * Transforms StyledDocument into DOCX binary output.
 * Uses the `docx` npm package for DOCX generation.
 */

import { Document, Packer, Paragraph, Footer, Header } from "docx";
import type { IPropertiesOptions, ISectionOptions, Table, IStylesOptions } from "docx";

import type { StyledDocument, NumberingDefinition } from "../../types/styled.ts";
import type { Block, Document as DocIR, Section, HeaderFooter } from "../../types/document-ir.ts";
import type { Diagnostic } from "../../types/diagnostics.ts";

import { createNumberingConfig, ensureDefaultNumberingDefs } from "./numbering.ts";
import { toStyleDefinition } from "./styles.ts";
import { emitBlocks, type EmitContext, type DocxBlock } from "./nodes.ts";
import { SectionBuilder, compileHeader, compileFooter } from "./sections.ts";
import { bookmarkSafeName } from "../../shared/bookmarks.ts";

// =============================================================================
// Public API
// =============================================================================

/**
 * Emit options.
 */
export interface EmitOptions {
  /** Pre-fetched image data (src → data) */
  imageData?: Map<string, Uint8Array>;
  /** Base path for resolving relative image paths */
  basePath?: string;
}

/**
 * Result of emit operation.
 */
export interface EmitResult {
  /** Generated DOCX as Buffer */
  buffer: Buffer;
  /** Diagnostics collected during emission */
  diagnostics: Diagnostic[];
}

/**
 * Emit a StyledDocument to DOCX binary.
 */
export async function emit(
  styledDocument: StyledDocument,
  options: EmitOptions = {}
): Promise<EmitResult> {
  const { document: docx, diagnostics } = buildDocument(styledDocument, options);
  
  // Generate DOCX binary
  const buffer = await Packer.toBuffer(docx);
  
  return {
    buffer: Buffer.from(buffer),
    diagnostics,
  };
}

/**
 * Synchronous emit for testing (returns Document object, not packed).
 */
export function emitSync(
  styledDocument: StyledDocument,
  options: EmitOptions = {}
): { document: Document; diagnostics: Diagnostic[] } {
  return buildDocument(styledDocument, options);
}

// =============================================================================
// Internal Implementation
// =============================================================================

/**
 * Shared orchestration for emit() and emitSync():
 * create context → collect bookmarks → compile document.
 */
function buildDocument(
  styledDocument: StyledDocument,
  options: EmitOptions
): { document: Document; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const ctx = createEmitContext(styledDocument, options, diagnostics);
  collectBookmarks(styledDocument.document, ctx);
  const document = compileDocument(styledDocument, ctx);
  return { document, diagnostics };
}

/**
 * Create the emit context with initial state.
 */
function createEmitContext(
  styledDocument: StyledDocument,
  options: EmitOptions,
  diagnostics: Diagnostic[]
): EmitContext {
  const numberingMode = styledDocument.document.metadata?.custom?.numberingMode as string | undefined;
  
  // Ensure default numbering definitions exist before emission starts.
  // emitList() needs to look up base definitions (e.g. "ordered-legal") to create
  // dynamic start-override clones, but createNumberingConfig() runs AFTER emission.
  ensureDefaultNumberingDefs(styledDocument.numberingDefinitions);
  
  return {
    resolveStyle: styledDocument.resolveStyle,
    numberingDefinitions: styledDocument.numberingDefinitions,
    footnotes: new Map(),
    footnoteIds: new Map(),
    imageData: options.imageData ?? new Map(),
    bookmarks: new Set(),
    diagnostics,
    basePath: options.basePath,
    listLevel: 0,
    numberingMode,
    numberingInstances: new Map(),
    lastNumberingInstance: new Map(),
    lastNumberingReference: new Map(),
  };
}

/**
 * First pass: collect all bookmark/anchor names.
 * This allows cross-references to work even if target appears after reference.
 * Scans both heading anchors and Anchor block nodes (from @anchor directives).
 */
function collectBookmarks(doc: DocIR, ctx: EmitContext): void {
  function visitBlock(block: Block): void {
    if (block.type === "Heading" && block.anchor) {
      ctx.bookmarks.add(bookmarkSafeName(block.anchor));
    }
    if (block.type === "Anchor") {
      ctx.bookmarks.add(bookmarkSafeName(block.id));
    }
    
    // Recurse into nested structures
    if (block.type === "Blockquote" || block.type === "Section") {
      for (const child of block.content) {
        visitBlock(child);
      }
    }
    if (block.type === "List") {
      for (const item of block.items) {
        for (const child of item.children) {
          visitBlock(child);
        }
      }
    }
    if (block.type === "Table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const child of cell.content) {
            visitBlock(child);
          }
        }
      }
    }
  }
  
  for (const block of doc.blocks) {
    visitBlock(block);
  }
}

/**
 * Compile StyledDocument to docx Document.
 */
function compileDocument(styledDocument: StyledDocument, ctx: EmitContext): Document {
  const { document: docIR, documentStyles, styleDefinitions, numberingDefinitions } = styledDocument;
  
  // Build sections
  const sections = compileSections(docIR, documentStyles, ctx);
  
  // Build styles configuration
  const styles = compileStyles(styleDefinitions);
  
  // Build numbering configuration
  const numbering = createNumberingConfig(numberingDefinitions);
  
  // Build footnotes
  const footnotes = compileFootnotes(ctx);
  
  // Create document options
  const documentOptions: IPropertiesOptions = {
    styles,
    numbering,
    sections,
    footnotes: Object.keys(footnotes).length > 0 ? footnotes : undefined,
  };
  
  return new Document(documentOptions);
}

/**
 * Compile document blocks into sections.
 */
function compileSections(
  docIR: DocIR,
  documentStyles: StyledDocument["documentStyles"],
  ctx: EmitContext
): ISectionOptions[] {
  // Find header/footer from metadata (set by @header/@footer directives),
  // falling back to Section blocks in the document body.
  const headerConfig = docIR.metadata?.headers?.default
    ?? findFirstHeaderFooter(docIR.blocks, "header");
  const footerConfig = docIR.metadata?.footers?.default
    ?? findFirstHeaderFooter(docIR.blocks, "footer");
  
  // Build headers/footers
  const headers = headerConfig ? {
    default: compileHeader(headerConfig, ctx),
  } : {};
  
  const footers = footerConfig ? {
    default: compileFooter(footerConfig, ctx),
  } : {};
  
  // Create section builder
  const builder = new SectionBuilder(
    documentStyles.pageWidth,
    documentStyles.pageHeight,
    {
      top: documentStyles.marginTop,
      bottom: documentStyles.marginBottom,
      left: documentStyles.marginLeft,
      right: documentStyles.marginRight,
    },
    headers,
    footers
  );
  
  const flushPending = (pendingBlocks: Block[]): void => {
    if (pendingBlocks.length === 0) {
      return;
    }
    builder.addChildren(emitBlocks(pendingBlocks, ctx));
  };

  let pending: Block[] = [];

  for (const block of docIR.blocks) {
    if (block.type !== "Section") {
      pending.push(block);
      continue;
    }

    flushPending(pending);
    pending = [];

    const sectionChildren = emitBlocks(block.content, ctx);
    if (block.columns) {
      builder.addColumns(
        sectionChildren,
        Math.max(1, block.columns.count),
        block.columns.space ?? 720,
      );
      continue;
    }

    builder.addChildren(sectionChildren);
  }

  flushPending(pending);
  
  return builder.finish();
}

/**
 * Find the first header or footer in the document.
 */
function findFirstHeaderFooter(
  blocks: Block[],
  kind: "header" | "footer"
): HeaderFooter | undefined {
  for (const block of blocks) {
    if (block.type !== "Section") {
      continue;
    }

    const config = kind === "header"
      ? block.headers?.default
      : block.footers?.default;
    if (config && config.kind === kind) {
      return config;
    }
  }
  return undefined;
}

/**
 * Compile style definitions to docx styles configuration.
 */
function compileStyles(styleDefinitions: StyledDocument["styleDefinitions"]): IStylesOptions {
  const paragraphStyles = styleDefinitions
    .filter((def) => def.type === "paragraph")
    .map((def) => toStyleDefinition(def));
  
  return {
    paragraphStyles,
  };
}

/**
 * Compile collected footnotes.
 */
function compileFootnotes(ctx: EmitContext): Record<number, { children: Paragraph[] }> {
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  
  for (const [label, content] of ctx.footnotes) {
    const id = ctx.footnoteIds.get(label);
    if (id !== undefined) {
      const children = emitBlocks(content, ctx) as Paragraph[];
      footnotes[id] = { children };
    }
  }
  
  return footnotes;
}

// =============================================================================
// Re-exports
// =============================================================================

export { createNumberingConfig } from "./numbering.ts";
export { toRunOptions, toParagraphOptions, toHeadingLevel } from "./styles.ts";
export { emitBlock, emitBlocks, emitInline, emitInlines } from "./nodes.ts";
export type { EmitContext, DocxBlock } from "./nodes.ts";
