/**
 * Document Emitter
 *
 * Top-level orchestrator that takes a semantic tree and produces LDOC text.
 * This is the main entry point for the emission layer.
 */

import type { SemanticNode } from "../semantic/types";
import type { DominantStyle } from "../semantic/analyzer";
import type { EmissionContext, EmissionOptions } from "./types";
import { createContext } from "./types";
import { emitNodes } from "./block";

/**
 * Emit a semantic tree to LDOC text.
 */
export function emitDocument(
  nodes: SemanticNode[],
  options: {
    dominantStyle?: DominantStyle;
    rels?: Map<string, string>;
  } = {},
): string {
  const ctx = createContext({
    dominantStyle: options.dominantStyle ?? {},
    rels: options.rels,
  });

  const lines = emitNodes(nodes, ctx);

  // Join lines with newlines
  // Filter out consecutive empty lines (more than 2)
  const result: string[] = [];
  let emptyCount = 0;

  for (const line of lines) {
    if (line.trim() === "") {
      emptyCount++;
      // Allow up to 2 consecutive empty lines
      if (emptyCount <= 2) {
        result.push(line);
      }
    } else {
      emptyCount = 0;
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Emit with custom context (for nested emission like table cells).
 */
export function emitWithContext(
  nodes: SemanticNode[],
  ctx: EmissionContext,
): string[] {
  return emitNodes(nodes, ctx);
}
