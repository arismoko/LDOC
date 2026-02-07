/**
 * Phase 5: EMIT
 * 
 * Transforms StyledDocument into format-specific output (DOCX, HTML, etc.)
 * Currently only DOCX is implemented.
 */

export { emit, emitSync, type EmitOptions, type EmitResult } from "./docx/index.ts";
export { createNumberingConfig, getNumberingReference } from "./docx/numbering.ts";
export { toRunOptions, toParagraphOptions, toStyleDefinition } from "./docx/styles.ts";
export { emitBlock, emitBlocks, emitInline, emitInlines, type EmitContext, type DocxBlock } from "./docx/nodes.ts";
export { SectionBuilder, compileHeader, compileFooter } from "./docx/sections.ts";
