import type { Location, Range } from "vscode-languageserver/node";

import type {
  AnchorNode,
  DefineNode,
  DocumentNode,
  ForeachNode,
  ImportNode,
  MetaNode,
  Node,
  SetNode,
} from "../parser/ast";
import { normalizeRefKey } from "../shared/bookmark-utils";

export interface MacroSignature {
  name: string;
  requiredParams: string[];
  optionalParams: string[];
  node: DefineNode;
  location: Location;
}

export interface DocumentIndex {
  uri: string;
  ast: DocumentNode;
  anchors: Map<string, Location>;
  anchorsByKey: Map<string, Location>;
  macros: Map<string, MacroSignature>;
  setVariables: Map<string, Location>;
  foreachItems: Map<string, Location>;
  meta: {
    node?: MetaNode;
    paths: string[];
    pathsSet: Set<string>;
  };
  document: {
    paths: string[];
    pathsSet: Set<string>;
  };
  imports: ImportNode[];
}

export function buildDocumentIndex(uri: string, ast: DocumentNode): DocumentIndex {
  const anchors = new Map<string, Location>();
  const anchorsByKey = new Map<string, Location>();
  const macros = new Map<string, MacroSignature>();
  const setVariables = new Map<string, Location>();
  const foreachItems = new Map<string, Location>();

  const metaPaths = ast.meta ? flattenPaths(ast.meta.data) : [];
  const metaPathsSet = new Set(metaPaths);
  const documentPaths = ast.document ? flattenPaths(ast.document) : [];
  const documentPathsSet = new Set(documentPaths);

  walkNode(ast, (node) => {
    switch (node.type) {
      case "anchor": {
        const loc = nodeToLocation(uri, node, (node as AnchorNode).name.length);
        anchors.set((node as AnchorNode).name, loc);
        anchorsByKey.set(normalizeRefKey((node as AnchorNode).name), loc);
        break;
      }
      case "define": {
        const def = node as DefineNode;
        const optionalParams = Object.keys(def.optionalParams ?? {});
        const optionalSet = new Set(optionalParams);
        const requiredParams = def.params.filter((p) => !optionalSet.has(p));
        const loc = nodeToLocation(uri, def, def.name.length);
        macros.set(def.name, {
          name: def.name,
          requiredParams,
          optionalParams,
          node: def,
          location: loc,
        });
        break;
      }
      case "set": {
        const set = node as SetNode;
        setVariables.set(set.name, nodeToLocation(uri, set, set.name.length));
        break;
      }
      case "foreach": {
        const f = node as ForeachNode;
        foreachItems.set(f.item, nodeToLocation(uri, f, f.item.length));
        break;
      }
    }
  });

  return {
    uri,
    ast,
    anchors,
    anchorsByKey,
    macros,
    setVariables,
    foreachItems,
    meta: {
      node: ast.meta,
      paths: metaPaths,
      pathsSet: metaPathsSet,
    },
    document: {
      paths: documentPaths,
      pathsSet: documentPathsSet,
    },
    imports: ast.imports,
  };
}

export function nodeToRange(node: { line: number; column: number; endLine?: number; endColumn?: number }, length = 1): Range {
  const startLine = Math.max(0, node.line - 1);
  const startChar = Math.max(0, node.column - 1);
  
  // Use accurate end position if available, otherwise fallback to estimated length
  if (node.endLine !== undefined && node.endColumn !== undefined) {
    return {
      start: { line: startLine, character: startChar },
      end: { line: Math.max(0, node.endLine - 1), character: Math.max(0, node.endColumn - 1) },
    };
  }
  
  return {
    start: { line: startLine, character: startChar },
    end: { line: startLine, character: startChar + Math.max(1, length) },
  };
}

export function nodeToLocation(
  uri: string,
  node: { line: number; column: number; endLine?: number; endColumn?: number },
  length = 1
): Location {
  return { uri, range: nodeToRange(node, length) };
}

function flattenPaths(value: unknown, prefix = ""): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return [];

  if (typeof value !== "object") {
    return prefix ? [prefix] : [];
  }

  const obj = value as Record<string, unknown>;
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    out.push(next);
    out.push(...flattenPaths(v, next));
  }
  return out;
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
