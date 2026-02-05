/**
 * Semantic Layer
 *
 * Sits between extraction (raw DOCX data) and emission (LDOC syntax).
 * Classifies paragraphs and creates explicit grouping structure.
 */

// Types
export type {
  ParagraphKind,
  SemanticParagraph,
  SemanticTable,
  SemanticGroup,
  SemanticNode,
  SemanticOptions,
  SemanticDocument,
  SpacingGroupAttrs,
  AlignmentGroupAttrs,
  IndentGroupAttrs,
} from "./types";

export { isParagraph, isTable, isGroup, spacingEqual, hasStyleOverrides } from "./types";

// Classifier
export {
  classifyParagraph,
  classifyParagraphs,
  detectHeadingLevel,
  isBlockquoteStyle,
  isTocStyle,
} from "./classifier";

// Grouper
export { groupElements } from "./grouper";

// Analyzer
export {
  detectUniformEmphasis,
  detectUniformFontSize,
  computeStyleDifference,
  detectUniformStyleAttrs,
  hasVariedStyles,
} from "./analyzer";
export type { DominantStyle } from "./analyzer";
