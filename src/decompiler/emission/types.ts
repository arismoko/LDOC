/**
 * Emission Layer Types
 *
 * Context and options for LDOC syntax generation.
 * All LDOC syntax is created in this layer.
 */

import type { DominantStyle } from "../semantic/analyzer";

/**
 * Context passed during emission.
 * Tracks indentation and dominant style for relative formatting.
 */
export interface EmissionContext {
  /** Current indentation string (e.g., "", "  ", "    ") */
  indent: string;

  /** Dominant font/size for computing style differences */
  dominantStyle: DominantStyle;

  /** True if emitting inside a table cell */
  inTable: boolean;

  /** Relationship ID to URL mapping for images/hyperlinks */
  rels?: Map<string, string>;
}

/**
 * Create a new emission context with defaults.
 */
export function createContext(overrides?: Partial<EmissionContext>): EmissionContext {
  return {
    indent: "",
    dominantStyle: {},
    inTable: false,
    rels: undefined,
    ...overrides,
  };
}

/**
 * Create a child context with increased indentation.
 */
export function indentContext(ctx: EmissionContext, spaces: number = 2): EmissionContext {
  return {
    ...ctx,
    indent: ctx.indent + " ".repeat(spaces),
  };
}

/**
 * Create a child context for table cell emission.
 */
export function tableContext(ctx: EmissionContext): EmissionContext {
  return {
    ...ctx,
    inTable: true,
  };
}

/**
 * Options controlling emission behavior.
 */
export interface EmissionOptions {
  /** Whether to emit @indent directives */
  emitIndent: boolean;
}
