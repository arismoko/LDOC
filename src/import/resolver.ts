import { dirname, resolve, isAbsolute, extname } from "node:path";

import type { DocumentNode, DefineNode } from "../parser/ast";
import { Parser } from "../parser/parser";

export interface ResolvedDefine {
  node: DefineNode;
  sourcePath: string;
}

export interface ResolveImportsResult {
  defines: Map<string, ResolvedDefine>;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function normalizeImportPath(raw: string): string {
  const p = stripQuotes(raw);
  if (!p) return p;
  if (extname(p) === "") return `${p}.ldoc`;
  return p;
}

function resolveImportPath(importerPath: string, specifier: string): string {
  const normalized = normalizeImportPath(specifier);
  if (isAbsolute(normalized)) return normalized;
  return resolve(dirname(importerPath), normalized);
}

export async function resolveDefinesFromImports(entry: DocumentNode): Promise<ResolveImportsResult> {
  const entryPath = entry.sourcePath;
  if (!entryPath) {
    // No source path => cannot resolve relative imports.
    return { defines: new Map() };
  }

  const importedFiles = new Set<string>();
  const stack: string[] = [];
  const defines = new Map<string, ResolvedDefine>();

  const loadFile = async (absPath: string): Promise<DocumentNode> => {
    const file = Bun.file(absPath);
    if (!(await file.exists())) {
      const from = stack[stack.length - 1] ?? entryPath;
      throw new Error(`Import not found: ${absPath}\n  Imported by: ${from}`);
    }
    const text = await file.text();
    return new Parser().parse(text, { sourcePath: absPath });
  };

  const processFile = async (absPath: string): Promise<void> => {
    if (stack.includes(absPath)) {
      const cycle = [...stack, absPath].join(" -> ");
      throw new Error(`Import cycle detected: ${cycle}`);
    }
    if (importedFiles.has(absPath)) return;
    importedFiles.add(absPath);
    stack.push(absPath);
    try {
      const ast = await loadFile(absPath);

      // Recurse into nested imports first
      for (const imp of ast.imports) {
        const childPath = resolveImportPath(absPath, imp.path);
        await processFile(childPath);
      }

      // Collect defines from this module
      for (const node of ast.body) {
        if (node.type !== "define") continue;
        const def = node as any as DefineNode;
        if (defines.has(def.name)) {
          const existing = defines.get(def.name)!;
          throw new Error(
            `Duplicate @define '${def.name}':\n` +
              `  First: ${existing.sourcePath}:${existing.node.line}\n` +
              `  Again: ${absPath}:${def.line}`
          );
        }
        defines.set(def.name, { node: def, sourcePath: absPath });
      }
    } finally {
      stack.pop();
    }
  };

  // Process each import in entry file
  for (const imp of entry.imports) {
    const abs = resolveImportPath(entryPath, imp.path);
    await processFile(abs);
  }

  return { defines };
}
