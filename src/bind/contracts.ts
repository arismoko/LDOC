/**
 * Directive Registry & Contracts for LDOC v3
 *
 * Defines the known directives and their constraints:
 * - Where they can appear (context)
 * - Whether they accept args
 * - Whether they accept a body
 *
 * Used by the validator to produce diagnostics for unknown
 * or misplaced directives.
 */

// =============================================================================
// Types
// =============================================================================

/** Where a directive is allowed to appear */
export type DirectiveContext = "top" | "structural" | "inline";

/** Contract for a known directive */
export interface DirectiveContract {
  /** The directive name (without @) */
  name: string;
  /** Where this directive may appear */
  allowedIn: DirectiveContext[];
  /** Whether this directive accepts args (...) */
  hasArgs: "required" | "optional" | "none";
  /** Whether this directive accepts a body {...} or [...] */
  hasBody: "required" | "optional" | "none";
  /** How the body should be parsed: "structural" (default) or "raw" (Spec §7.2) */
  bodySyntax?: "structural" | "raw";
  /** Raw body format hint (e.g. "lua") — only meaningful when bodySyntax is "raw" */
  rawFormat?: "lua";
  /** If set, this directive may only appear as a child of the given parent */
  parentDirective?: string;
  /** If set, this directive may appear as a child of any listed parent */
  parentDirectives?: string[];
}

// =============================================================================
// Registry
// =============================================================================

/**
 * Built-in directive contracts for LDOC v3.
 *
 * Based on LDOC-V3-SPEC.md sections 5, 9-16.
 */
const DIRECTIVES: DirectiveContract[] = [
  // Document config (Spec §20)
  {
    name: "document",
    allowedIn: ["top"],
    hasArgs: "required",
    hasBody: "none",
  },

  // Definitions (Spec §9)
  {
    name: "def",
    allowedIn: ["top", "structural"],
    hasArgs: "required",
    hasBody: "none",
  },

  // Styling (Spec §10)
  {
    name: "style",
    allowedIn: ["top", "structural", "inline"],
    hasArgs: "required",
    hasBody: "optional",
  },

  // Lua block (Spec §7.2)
  {
    name: "lua",
    allowedIn: ["top", "structural"],
    hasArgs: "none",
    hasBody: "required",
    bodySyntax: "raw",
    rawFormat: "lua",
  },

  // Layout directives (Spec §13)
  {
    name: "pagebreak",
    allowedIn: ["top", "structural"],
    hasArgs: "none",
    hasBody: "none",
  },
  {
    name: "columns",
    allowedIn: ["top", "structural"],
    hasArgs: "required",
    hasBody: "required",
  },
  {
    name: "break",
    allowedIn: ["structural"],
    hasArgs: "none",
    hasBody: "none",
    parentDirective: "columns",
  },
  {
    name: "box",
    allowedIn: ["top", "structural"],
    hasArgs: "optional",
    hasBody: "required",
  },
  {
    name: "blockquote",
    allowedIn: ["top", "structural"],
    hasArgs: "none",
    hasBody: "required",
  },
  {
    name: "align",
    allowedIn: ["top", "structural"],
    hasArgs: "required",
    hasBody: "required",
  },

  // Tables (Spec §12)
  {
    name: "table",
    allowedIn: ["top", "structural"],
    hasArgs: "optional",
    hasBody: "required",
  },
  {
    name: "row",
    allowedIn: ["structural"],
    hasArgs: "required",
    hasBody: "none",
    parentDirective: "table",
  },

  // Headers and footers (Spec §14)
  {
    name: "header",
    allowedIn: ["top"],
    hasArgs: "optional",
    hasBody: "required",
  },
  {
    name: "footer",
    allowedIn: ["top"],
    hasArgs: "optional",
    hasBody: "required",
  },
  {
    name: "left",
    allowedIn: ["structural"],
    hasArgs: "none",
    hasBody: "optional",
    parentDirectives: ["header", "footer"],
  },
  {
    name: "center",
    allowedIn: ["structural"],
    hasArgs: "none",
    hasBody: "optional",
    parentDirectives: ["header", "footer"],
  },
  {
    name: "right",
    allowedIn: ["structural"],
    hasArgs: "none",
    hasBody: "optional",
    parentDirectives: ["header", "footer"],
  },

  // Cross-references (Spec §15)
  {
    name: "anchor",
    allowedIn: ["top", "structural"],
    hasArgs: "required",
    hasBody: "none",
  },
  {
    name: "ref",
    allowedIn: ["inline"],
    hasArgs: "required",
    hasBody: "optional",
  },
  {
    name: "footnote",
    allowedIn: ["top", "structural", "inline"],
    hasArgs: "none",
    hasBody: "required",
  },

  // Composition (Spec §16)
  {
    name: "include",
    allowedIn: ["top", "structural"],
    hasArgs: "required",
    hasBody: "none",
  },
  {
    name: "params",
    allowedIn: ["top"],
    hasArgs: "required",
    hasBody: "none",
  },
];

/** Lookup map: directive name → contract */
const registry = new Map<string, DirectiveContract>(
  DIRECTIVES.map((d) => [d.name, d]),
);

// =============================================================================
// Public API
// =============================================================================

/**
 * Look up a directive contract by name.
 * Returns undefined for unknown directives.
 */
export function getDirectiveContract(name: string): DirectiveContract | undefined {
  return registry.get(name);
}

/**
 * Check if a directive name is known.
 */
export function isKnownDirective(name: string): boolean {
  return registry.has(name);
}

/**
 * Get all known directive names.
 */
export function knownDirectiveNames(): string[] {
  return Array.from(registry.keys());
}
