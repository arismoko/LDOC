/**
 * Semantic Grouper
 *
 * Groups semantic paragraphs and tables into tree structure based on:
 * - Shared spacing (before/after)
 * - Shared alignment (center/right)
 * - Shared indentation
 *
 * This mirrors the grouping logic in generator.ts:processChildren but
 * produces explicit tree nodes instead of string manipulation.
 */

import type { ExtractedBodyElement, ExtractedTable } from "../extraction/types";
import type { NumberingInfo } from "../parsers/numbering";
import type {
  SemanticNode,
  SemanticParagraph,
  SemanticTable,
  SemanticGroup,
  SemanticOptions,
  SpacingGroupAttrs,
  AlignmentGroupAttrs,
  IndentGroupAttrs,
} from "./types";
import { spacingEqual } from "./types";
import { classifyParagraph } from "./classifier";

/**
 * Create a semantic table node from an extracted table.
 */
function createSemanticTable(extracted: ExtractedTable): SemanticTable {
  return {
    type: "table",
    extracted,
  };
}

/**
 * Group paragraphs by alignment.
 * Returns array of nodes where aligned runs become SemanticGroup nodes.
 *
 * Grouping rules (from generator.ts):
 * - Only group center/right alignment (left/justify are default)
 * - Don't group headings or lists
 * - Empty paragraphs can be included in groups
 * - Need at least 2 non-empty paragraphs to form a group
 */
function groupByAlignment(paragraphs: SemanticParagraph[]): SemanticNode[] {
  const result: SemanticNode[] = [];
  let i = 0;

  while (i < paragraphs.length) {
    const para = paragraphs[i]!;
    const alignment = para.alignment;

    // Can only group if: has alignment, not heading, not list, not empty
    if (
      alignment &&
      para.kind !== "heading" &&
      para.kind !== "list" &&
      !para.isEmpty
    ) {
      // Try to extend the group
      const group: number[] = [i];
      let j = i + 1;

      while (j < paragraphs.length) {
        const next = paragraphs[j]!;
        // Stop on headings or lists
        if (next.kind === "heading" || next.kind === "list") break;
        // Empty can continue
        if (next.isEmpty) {
          group.push(j);
          j++;
          continue;
        }
        // Different alignment stops
        if (next.alignment !== alignment) break;
        group.push(j);
        j++;
      }

      // Check if we have enough non-empty to form a group (>= 2)
      const nonEmptyCount = group.filter((idx) => !paragraphs[idx]!.isEmpty).length;

      if (nonEmptyCount >= 2) {
        // Create alignment group
        const children = group.map((idx) => paragraphs[idx]!);
        const groupNode: SemanticGroup = {
          type: "group",
          groupKind: "alignment",
          attrs: { alignment } as AlignmentGroupAttrs,
          children,
        };
        result.push(groupNode);
        i = j;
        continue;
      }
    }

    // Single paragraph - emit with inline alignment handling
    result.push(para);
    i++;
  }

  return result;
}

/**
 * Group nodes by spacing.
 * Returns array where runs with same spacing become SemanticGroup nodes.
 *
 * Grouping rules (from generator.ts):
 * - Group consecutive paragraphs with same spacing
 * - Stop on headings or lists
 */
function groupBySpacing(nodes: SemanticNode[]): SemanticNode[] {
  const result: SemanticNode[] = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i]!;

    // Only group paragraphs
    if (node.type !== "paragraph") {
      result.push(node);
      i++;
      continue;
    }

    const para = node as SemanticParagraph;
    const spacing = {
      spacingAfter: para.spacingAfter,
      spacingBefore: para.spacingBefore,
    };

    // Only create spacing groups if there's actual spacing
    const hasSpacing = spacing.spacingAfter !== undefined || spacing.spacingBefore !== undefined;

    if (!hasSpacing) {
      // No spacing - process alignment grouping for this run of no-spacing paragraphs
      const run: SemanticParagraph[] = [para];
      let j = i + 1;

      while (j < nodes.length) {
        const next = nodes[j]!;
        if (next.type !== "paragraph") break;
        const nextPara = next as SemanticParagraph;
        if (nextPara.kind === "heading" || nextPara.kind === "list") break;
        if (!spacingEqual(spacing, { spacingAfter: nextPara.spacingAfter, spacingBefore: nextPara.spacingBefore })) break;
        run.push(nextPara);
        j++;
      }

      // Apply alignment grouping to this run
      result.push(...groupByAlignment(run));
      i = j;
      continue;
    }

    // Has spacing - collect all paragraphs with same spacing
    const spacingGroup: SemanticParagraph[] = [para];
    let j = i + 1;

    while (j < nodes.length) {
      const next = nodes[j]!;
      if (next.type !== "paragraph") break;
      const nextPara = next as SemanticParagraph;
      if (nextPara.kind === "heading" || nextPara.kind === "list") break;
      if (!spacingEqual(spacing, { spacingAfter: nextPara.spacingAfter, spacingBefore: nextPara.spacingBefore })) break;
      spacingGroup.push(nextPara);
      j++;
    }

    // Apply alignment grouping within this spacing group
    const alignedChildren = groupByAlignment(spacingGroup);

    // Wrap in spacing group
    const spacingAttrs: SpacingGroupAttrs = {};
    if (spacing.spacingAfter !== undefined) spacingAttrs.spacingAfter = spacing.spacingAfter;
    if (spacing.spacingBefore !== undefined) spacingAttrs.spacingBefore = spacing.spacingBefore;

    const groupNode: SemanticGroup = {
      type: "group",
      groupKind: "spacing",
      attrs: spacingAttrs,
      children: alignedChildren,
    };
    result.push(groupNode);
    i = j;
  }

  return result;
}

/**
 * Group nodes by indent.
 * Returns array where runs with same indent become SemanticGroup nodes.
 *
 * Only applied when options.emitIndent is true.
 * Lists already have their own indentation via numbering.
 */
function groupByIndent(
  nodes: SemanticNode[],
  options: SemanticOptions,
): SemanticNode[] {
  if (!options.emitIndent) {
    // Skip indent grouping - process spacing/alignment for all nodes
    return groupBySpacing(nodes);
  }

  const result: SemanticNode[] = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i]!;

    // Tables pass through
    if (node.type === "table") {
      result.push(node);
      i++;
      continue;
    }

    // Groups pass through (shouldn't happen at this stage)
    if (node.type === "group") {
      result.push(node);
      i++;
      continue;
    }

    const para = node as SemanticParagraph;

    // Lists don't get indent grouping
    if (para.kind === "list") {
      result.push(para);
      i++;
      continue;
    }

    const indentTwips = para.indentLeftTwips;

    // No indent - process with spacing/alignment grouping
    if (indentTwips <= 0) {
      const run: SemanticNode[] = [para];
      let j = i + 1;

      while (j < nodes.length) {
        const next = nodes[j]!;
        if (next.type !== "paragraph") break;
        const nextPara = next as SemanticParagraph;
        if (nextPara.kind === "list") break;
        if (nextPara.indentLeftTwips > 0) break;
        run.push(nextPara);
        j++;
      }

      result.push(...groupBySpacing(run));
      i = j;
      continue;
    }

    // Has indent - collect paragraphs with same indent
    const indentGroup: SemanticParagraph[] = [para];
    let j = i + 1;

    while (j < nodes.length) {
      const next = nodes[j]!;
      if (next.type !== "paragraph") break;
      const nextPara = next as SemanticParagraph;
      if (nextPara.kind === "list") break;
      if (nextPara.indentLeftTwips !== indentTwips) break;
      indentGroup.push(nextPara);
      j++;
    }

    // Apply spacing/alignment grouping within indent group
    const innerChildren = groupBySpacing(indentGroup);

    // Check if we need to create an indent group (>= 2 non-empty)
    const nonEmptyCount = indentGroup.filter((p) => !p.isEmpty).length;

    if (nonEmptyCount >= 2) {
      const indentAttrs: IndentGroupAttrs = { indentTwips };
      const groupNode: SemanticGroup = {
        type: "group",
        groupKind: "indent",
        attrs: indentAttrs,
        children: innerChildren,
      };
      result.push(groupNode);
    } else {
      // Single paragraph with indent - emit inline (emission layer handles)
      result.push(...innerChildren);
    }

    i = j;
  }

  return result;
}

/**
 * Process extracted body elements into semantic tree.
 */
export function groupElements(
  elements: ExtractedBodyElement[],
  numInfo: NumberingInfo,
  options: SemanticOptions,
): SemanticNode[] {
  // First, classify all paragraphs and convert tables
  const nodes: SemanticNode[] = elements.map((elem) => {
    if (elem.type === "table") {
      return createSemanticTable(elem);
    } else {
      return classifyParagraph(elem, numInfo);
    }
  });

  // Apply hierarchical grouping: indent -> spacing -> alignment
  return groupByIndent(nodes, options);
}
