/**
 * LSP References - Find all usages of symbols
 */

import type { Location } from "vscode-languageserver/node";
import type { DocumentNode, Node, UseNode, CrossRefNode, VariableNode } from "../parser/ast";
import { normalizeRefKey } from "../compiler/bookmark-utils";
import { nodeToLocation } from "./indexer";

export interface SymbolUsages {
  /** Anchor usages: [[anchorName]] cross-references */
  anchorRefs: Map<string, Location[]>;
  /** Macro usages: @use MacroName */
  macroRefs: Map<string, Location[]>;
  /** Variable usages: {{varName}} */
  variableRefs: Map<string, Location[]>;
}

/**
 * Build a map of all symbol usages in the document.
 * This is separate from definitions (indexer.ts tracks definitions).
 */
export function buildSymbolUsages(uri: string, ast: DocumentNode): SymbolUsages {
  const anchorRefs = new Map<string, Location[]>();
  const macroRefs = new Map<string, Location[]>();
  const variableRefs = new Map<string, Location[]>();

  walkNode(ast, (node) => {
    switch (node.type) {
      case "cross_ref": {
        const ref = node as CrossRefNode;
        const key = normalizeRefKey(ref.target);
        const loc = nodeToLocation(uri, ref, ref.target.length + 4); // [[target]]
        const list = anchorRefs.get(key) ?? [];
        list.push(loc);
        anchorRefs.set(key, list);
        break;
      }
      case "use": {
        const use = node as UseNode;
        const loc = nodeToLocation(uri, use, use.name.length);
        const list = macroRefs.get(use.name) ?? [];
        list.push(loc);
        macroRefs.set(use.name, list);
        break;
      }
      case "variable": {
        const v = node as VariableNode;
        const name = v.path.join(".");
        const loc = nodeToLocation(uri, v, name.length + 4); // {{name}}
        const list = variableRefs.get(name) ?? [];
        list.push(loc);
        variableRefs.set(name, list);
        break;
      }
    }
  });

  return { anchorRefs, macroRefs, variableRefs };
}

function isNode(value: unknown): value is Node {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; line?: unknown; column?: unknown };
  return typeof v.type === "string" && typeof v.line === "number" && typeof v.column === "number";
}

function walkNode(root: Node, visit: (node: Node) => void): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    visit(node);

    const record = node as unknown as Record<string, unknown>;
    for (const v of Object.values(record)) {
      if (!v) continue;
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) {
          const el = v[i];
          if (isNode(el)) stack.push(el);
        }
        continue;
      }
      if (isNode(v)) stack.push(v);
    }
  }
}
