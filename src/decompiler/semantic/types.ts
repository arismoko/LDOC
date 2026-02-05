/**
 * Semantic Layer Types
 *
 * These types represent semantically-classified content in a tree structure.
 * The semantic layer sits between extraction (raw data) and emission (LDOC syntax).
 *
 * Key principles:
 * - Classify paragraphs by semantic role (heading, list, normal, empty)
 * - Create explicit group nodes for shared attributes (spacing, alignment, indent)
 * - Tree structure that emission layer walks recursively
 * - No LDOC syntax generation - just structure and classification
 */

import type {
  ExtractedParagraph,
  ExtractedTable,
  ExtractedRunStyle,
} from "../extraction/types";

/**
 * Semantic classification of a paragraph.
 */
export type ParagraphKind = "heading" | "list" | "normal" | "empty" | "pageBreak";

/**
 * A semantically-classified paragraph.
 * Wraps an ExtractedParagraph with classification metadata.
 */
export interface SemanticParagraph {
  type: "paragraph";

  /** The underlying extracted paragraph */
  extracted: ExtractedParagraph;

  /** Semantic classification */
  kind: ParagraphKind;

  /** Heading level (1-6) if kind is "heading" */
  headingLevel?: number;

  /** List prefix (e.g., "- ", "1. ") if kind is "list" */
  listPrefix?: string;

  /** List indent level (0-based) if kind is "list" */
  listLevel?: number;

  /** True if paragraph is visually empty (no text content) */
  isEmpty: boolean;

  /** Alignment if non-default */
  alignment?: "center" | "right";

  /** Left indent in twips (0 if none) */
  indentLeftTwips: number;

  /** Spacing before in twips */
  spacingBefore?: number;

  /** Spacing after in twips */
  spacingAfter?: number;

  /**
   * Style attributes that need @style() wrapping.
   * Populated if paragraph has custom styling beyond structure.
   */
  styleAttrs?: Record<string, string>;

  /** Bookmarks (anchors) to emit before this paragraph */
  anchors: string[];
}

/**
 * A semantic table node.
 * Wraps an ExtractedTable for emission.
 */
export interface SemanticTable {
  type: "table";
  extracted: ExtractedTable;
}

/**
 * Group attributes for spacing groups.
 */
export interface SpacingGroupAttrs {
  spacingAfter?: number;
  spacingBefore?: number;
}

/**
 * Group attributes for alignment groups.
 */
export interface AlignmentGroupAttrs {
  alignment: "center" | "right";
}

/**
 * Group attributes for indent groups.
 */
export interface IndentGroupAttrs {
  indentTwips: number;
}

/**
 * A group node that wraps children with shared attributes.
 * Groups are explicit tree nodes - emission walks them recursively.
 */
export interface SemanticGroup {
  type: "group";

  /** What kind of group this is */
  groupKind: "spacing" | "alignment" | "indent";

  /** Group-specific attributes */
  attrs: SpacingGroupAttrs | AlignmentGroupAttrs | IndentGroupAttrs;

  /** Child nodes */
  children: SemanticNode[];
}

/**
 * A node in the semantic tree.
 */
export type SemanticNode = SemanticParagraph | SemanticTable | SemanticGroup;

/**
 * Options controlling semantic analysis.
 */
export interface SemanticOptions {
  /** Whether to emit @indent directives */
  emitIndent: boolean;
}

/**
 * Result of semantic analysis.
 */
export interface SemanticDocument {
  /** Root-level semantic nodes (may be paragraphs, tables, or groups) */
  body: SemanticNode[];

  /** Dominant style detected from document */
  dominantStyle: {
    font?: string;
    sizePt?: number;
  };
}

/**
 * Helper type guard: is this a SemanticParagraph?
 */
export function isParagraph(node: SemanticNode): node is SemanticParagraph {
  return node.type === "paragraph";
}

/**
 * Helper type guard: is this a SemanticTable?
 */
export function isTable(node: SemanticNode): node is SemanticTable {
  return node.type === "table";
}

/**
 * Helper type guard: is this a SemanticGroup?
 */
export function isGroup(node: SemanticNode): node is SemanticGroup {
  return node.type === "group";
}

/**
 * Helper to check if a run style has any non-default properties.
 */
export function hasStyleOverrides(style: ExtractedRunStyle): boolean {
  return (
    style.bold ||
    style.italic ||
    !!style.strike ||
    !!style.underline ||
    !!style.code ||
    !!style.subscript ||
    !!style.superscript ||
    !!style.allCaps ||
    !!style.smallCaps ||
    !!style.doubleStrike ||
    !!style.font ||
    !!style.sizePt ||
    !!style.color ||
    !!style.highlight ||
    style.characterSpacing !== undefined ||
    !!style.shadingFill
  );
}

/**
 * Compare two spacing objects for equality.
 */
export function spacingEqual(
  a?: { spacingAfter?: number; spacingBefore?: number },
  b?: { spacingAfter?: number; spacingBefore?: number },
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.spacingAfter === b.spacingAfter && a.spacingBefore === b.spacingBefore;
}
