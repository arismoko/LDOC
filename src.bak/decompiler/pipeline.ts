/**
 * New Decompiler Pipeline
 *
 * Integrates the three layers:
 * 1. Extraction - Raw data from DOCX XML
 * 2. Semantic - Classification and grouping
 * 3. Emission - LDOC syntax generation
 *
 * This module provides the `processBodyElementsV2` function as a drop-in
 * replacement for `processChildren` from generator.ts.
 */

import type { XmlNode } from "./xml";
import type { ParagraphStyleMap } from "./parsers/styles";
import type { NumberingInfo } from "./parsers/numbering";

// Extraction layer
import { extractBodyElements } from "./extraction";

// Semantic layer
import { groupElements, type SemanticOptions } from "./semantic";
import type { DominantStyle } from "./semantic/analyzer";

// Emission layer
import { emitNodes, createContext } from "./emission";

/**
 * Options for the new pipeline.
 */
export interface PipelineOptions {
  /** Whether to emit @indent directives */
  emitIndent?: boolean | "on" | "off" | "auto";

  /** Dominant font/size for style comparison */
  dominantStyle?: DominantStyle;

  /** Inside a table cell? */
  inTable?: boolean;
}

/**
 * Normalize emitIndent option to boolean.
 */
function shouldEmitIndent(opt: boolean | "on" | "off" | "auto" | undefined): boolean {
  if (opt === "on" || opt === true) return true;
  return false;
}

/**
 * Process body elements through the new three-layer pipeline.
 *
 * This is intended as a drop-in replacement for `processChildren`:
 * - Takes XmlNode[] (body children)
 * - Returns string[] (LDOC lines)
 *
 * @param children - Body element nodes (w:p, w:tbl)
 * @param numInfo - Numbering definitions for list detection
 * @param styles - Paragraph style map
 * @param options - Pipeline options
 * @param indent - Base indentation string (e.g., "", "  ")
 * @param rels - Relationship ID to target mapping
 * @returns Array of LDOC lines
 */
export function processBodyElementsV2(
  children: XmlNode[],
  numInfo: NumberingInfo,
  styles: ParagraphStyleMap,
  options?: PipelineOptions,
  indent: string = "",
  rels?: Map<string, string>,
): string[] {
  // 1. EXTRACTION: Convert XML nodes to extracted types
  const extracted = extractBodyElements(children, styles, rels);

  // 2. SEMANTIC: Classify and group elements
  const semanticOptions: SemanticOptions = {
    emitIndent: shouldEmitIndent(options?.emitIndent),
  };
  const semanticTree = groupElements(extracted, numInfo, semanticOptions);

  // 3. EMISSION: Generate LDOC lines
  const ctx = createContext({
    indent,
    dominantStyle: options?.dominantStyle ?? {},
    inTable: options?.inTable ?? false,
    rels,
    emitIndent: semanticOptions.emitIndent,
  });

  return emitNodes(semanticTree, ctx);
}
