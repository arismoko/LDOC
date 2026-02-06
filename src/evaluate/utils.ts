/**
 * Utility functions for the evaluator.
 */

import type { CSTNode } from "../types/cst.ts";

/**
 * Deep clone a CST node.
 */
export function cloneNode<T extends CSTNode>(node: T): T {
  return structuredClone(node);
}

/**
 * Clone an array of CST nodes.
 */
export function cloneNodes<T extends CSTNode>(nodes: T[]): T[] {
  return nodes.map((n) => cloneNode(n));
}

/**
 * Apply a scope prefix to node identifiers.
 * Used to create unique IDs when expanding definitions.
 */
export function applyScopePrefix(node: CSTNode, prefix: string): CSTNode {
  // For now, we just return the node as-is
  // Scope prefixing for anchors/bookmarks can be added later
  return node;
}

/**
 * Set a value at a dot-path in a target object.
 * Creates nested objects as needed.
 */
export function setPathValue(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".");
  if (parts.length === 1) {
    target[path] = value;
    return;
  }

  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!(key in cur) || typeof cur[key] !== "object" || cur[key] === null) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/**
 * Get a value from a nested object by dot-path.
 */
export function getPathValue(root: unknown, path: string[]): unknown {
  let v = root;
  for (const key of path) {
    if (v && typeof v === "object" && key in (v as Record<string, unknown>)) {
      v = (v as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return v;
}
