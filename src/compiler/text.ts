// Text compilation helpers for Legal Document DSL
// Extracted from docx.ts for modularity

import { TextRun, Tab } from "docx";
import type { IRunOptions } from "docx";

import type {
  InlineNode,
  VariableNode,
  TextNode,
  EmphasisNode,
  StrikethroughNode,
  InlineStyleNode,
} from "../parser/ast";
import type { TextStyle } from "./styles";
import { evalCond } from "./conditions";

/**
 * Context required for variable resolution.
 */
export interface VariableContext {
  variables: Record<string, any>;
  missingVariables: Map<string, { line: number; column: number }>;
}

/**
 * Resolve a variable node to its string value.
 * If the variable is not found, it is added to missingVariables and the template placeholder is returned.
 */
export function resolveVariable(node: VariableNode, ctx: VariableContext): string {
  let value: any;

  try {
    // Try to evaluate as an expression first
    value = evalCond(node.name, ctx.variables, {});
  } catch (e) {
    // If evaluation fails (e.g. syntax error), fall back to undefined
    value = undefined;
  }

  // If evaluation returned undefined (variable not found) or NaN (math with undefined), treat as missing
  if (value === undefined || (typeof value === "number" && Number.isNaN(value))) {
    // Check if it was a simple path lookup that failed
    const label = node.name;
    if (!ctx.missingVariables.has(label)) {
      ctx.missingVariables.set(label, { line: node.line, column: node.column });
    }
    return `{{${node.name}}}`; // Unresolved variable
  }

  // Apply filters
  let result = String(value);
  for (const filter of node.filters) {
    switch (filter) {
      case "upper":
        result = result.toUpperCase();
        break;
      case "lower":
        result = result.toLowerCase();
        break;
      case "capitalize":
        result = result.charAt(0).toUpperCase() + result.slice(1);
        break;
    }
  }

  return result;
}

/**
 * Convert inline nodes to a plain text string.
 * Used for bookmark labels and heading text extraction.
 */
export function inlineText(nodes: InlineNode[]): string {
  let s = "";
  for (const n of nodes) {
    if (n.type === "text") s += n.value;
    else if (n.type === "variable") s += `{{${n.name}}}`;
    else if (n.type === "defined_term") s += `"${n.term}"`;
    else if (n.type === "cross_ref") s += `[[${n.target}]]`;
    else if (n.type === "blank") s += "_".repeat(n.length);
    else if (n.type === "emphasis") s += inlineText(n.content);
  }
  return s.trim();
}

/**
 * Create text runs from text that may contain tabs.
 * Returns array of TextRun elements with Tab elements for '\t'.
 */
export function createTextRuns(text: string, style: TextStyle): TextRun[] {
  if (!text.includes("\t")) {
    return [createSingleTextRun(text, style)];
  }

  const runs: TextRun[] = [];
  const parts = text.split("\t");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part) {
      runs.push(createSingleTextRun(part, style));
    }
    // Add a tab run between parts (not after the last one)
    if (i < parts.length - 1) {
      runs.push(new TextRun({ children: [new Tab()] }));
    }
  }
  return runs;
}

/**
 * Create a single TextRun with the given text and style.
 */
export function createSingleTextRun(text: string, style: TextStyle): TextRun {
  const options: IRunOptions = {
    text,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italics ? { italics: true } : {}),
    ...(style.allCaps ? { allCaps: true } : {}),
    ...(style.smallCaps ? { smallCaps: true } : {}),
    ...(style.strike ? { strike: true } : {}),
    ...(style.doubleStrike ? { doubleStrike: true } : {}),
    ...(style.size ? { size: style.size } : {}),
    ...(style.font ? { font: style.font } : {}),
    ...(style.color ? { color: style.color } : {}),
  };

  return new TextRun(options);
}

/**
 * Split an array of InlineNodes by paragraph breaks (double newlines).
 * Returns an array of InlineNode arrays, where each inner array represents
 * content for a single paragraph.
 *
 * Single newlines are converted to spaces (soft wrap behavior).
 *
 * Handles:
 * - TextNode: splits on \n\n+, converts single \n to space
 * - EmphasisNode, StrikethroughNode, InlineStyleNode: recursively splits content
 * - Other nodes: passed through to the current paragraph
 *
 * Examples:
 * - "A\nB" -> [[Text("A B")]] (single newline becomes space)
 * - "A\n\nB" -> [[Text("A")], [Text("B")]] (double newline is paragraph break)
 * - "A\n\n\nB" -> [[Text("A")], [Text("B")]] (triple+ newline is paragraph break)
 * - "A\nB\n\nC\nD" -> [[Text("A B")], [Text("C D")]]
 */
export function splitInlineNodesByParagraphBreak(nodes: InlineNode[]): InlineNode[][] {
  // Start with a single empty line
  let lines: InlineNode[][] = [[]];

  for (const node of nodes) {
    const splitResult = splitSingleNode(node);

    // Merge the first segment of splitResult with the current last line
    const currentLine = lines[lines.length - 1]!;
    if (splitResult[0] && splitResult[0].length > 0) {
      currentLine.push(...splitResult[0]);
    }

    // Add remaining segments as new lines
    for (let i = 1; i < splitResult.length; i++) {
      lines.push(splitResult[i]!);
    }
  }

  return lines;
}

/**
 * Split a single InlineNode by newlines.
 * Returns an array of InlineNode arrays representing the split parts.
 */
function splitSingleNode(node: InlineNode): InlineNode[][] {
  switch (node.type) {
    case "text":
      return splitTextNode(node);
    case "emphasis":
      return splitEmphasisNode(node);
    case "strikethrough":
      return splitStrikethroughNode(node);
    case "inline_style":
      return splitInlineStyleNode(node);
    default:
      // For other node types (variable, cross_ref, defined_term, blank, link, etc.)
      // they don't contain newlines, so return as a single segment
      return [[node]];
  }
}

/**
 * Split a TextNode by paragraph breaks (double newlines).
 * Single newlines are converted to spaces.
 */
function splitTextNode(node: TextNode): InlineNode[][] {
  const value = node.value;

  if (!value.includes("\n")) {
    // No newlines, return as single segment
    return [[node]];
  }

  // Split by paragraph breaks (2+ consecutive newlines)
  const parts = value.split(/\n{2,}/);

  return parts.map((part): InlineNode[] => {
    // Convert single newlines to spaces within each paragraph
    const normalized = part.replace(/\n/g, " ");
    if (normalized === "") {
      return [];
    }
    return [
      {
        ...node,
        value: normalized,
      } as TextNode,
    ];
  });
}

/**
 * Split an EmphasisNode by newlines in its content.
 * Each resulting segment preserves the emphasis style.
 */
function splitEmphasisNode(node: EmphasisNode): InlineNode[][] {
  const contentLines = splitInlineNodesByParagraphBreak(node.content);

  return contentLines.map((lineNodes): InlineNode[] => {
    if (lineNodes.length === 0) {
      return [];
    }
    return [
      {
        ...node,
        content: lineNodes,
      } as EmphasisNode,
    ];
  });
}

/**
 * Split a StrikethroughNode by newlines in its content.
 */
function splitStrikethroughNode(node: StrikethroughNode): InlineNode[][] {
  const contentLines = splitInlineNodesByParagraphBreak(node.content);

  return contentLines.map((lineNodes): InlineNode[] => {
    if (lineNodes.length === 0) {
      return [];
    }
    return [
      {
        ...node,
        content: lineNodes,
      } as StrikethroughNode,
    ];
  });
}

/**
 * Split an InlineStyleNode by newlines in its content.
 * Each resulting segment preserves the style attributes.
 */
function splitInlineStyleNode(node: InlineStyleNode): InlineNode[][] {
  const contentLines = splitInlineNodesByParagraphBreak(node.content);

  return contentLines.map((lineNodes): InlineNode[] => {
    if (lineNodes.length === 0) {
      return [];
    }
    return [
      {
        ...node,
        content: lineNodes,
      } as InlineStyleNode,
    ];
  });
}
