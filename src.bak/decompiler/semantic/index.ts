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
  SpacingGroupAttrs,
  AlignmentGroupAttrs,
  IndentGroupAttrs,
} from "./types";

export { isParagraph, isTable, isGroup, spacingEqual } from "./types";

// Classifier
export { classifyParagraph } from "./classifier";

// Grouper
export { groupElements } from "./grouper";

// Analyzer
export type { DominantStyle } from "./analyzer";
