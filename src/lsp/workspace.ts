/**
 * LSP Workspace Index
 * 
 * Maintains a cross-file index of symbols from imported files.
 * Used for completion and go-to-definition of imported macros.
 */

import { dirname, resolve, isAbsolute, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Location } from "vscode-languageserver/node";

import type { DocumentNode, DefineNode, AnchorNode } from "../parser/ast";
import { Parser } from "../parser/parser";
import { nodeToLocation, type MacroSignature } from "./indexer";

export interface ImportedSymbols {
  /** Macros from imported files: name -> signature with location */
  macros: Map<string, MacroSignature>;
  /** Anchors from imported files: name -> location */
  anchors: Map<string, Location>;
  /** Source files that were processed */
  sourceFiles: Set<string>;
  /** Any errors during resolution */
  errors: string[];
}

/**
 * Resolve imports for a document and collect all exported symbols.
 * Returns imported macros and anchors that should be available for
 * completion and go-to-definition.
 */
export async function resolveImportedSymbols(
  ast: DocumentNode,
  currentUri: string
): Promise<ImportedSymbols> {
  const result: ImportedSymbols = {
    macros: new Map(),
    anchors: new Map(),
    sourceFiles: new Set(),
    errors: [],
  };

  // Convert URI to file path
  let currentPath: string;
  try {
    currentPath = currentUri.startsWith("file://")
      ? fileURLToPath(currentUri)
      : currentUri;
  } catch {
    // If we can't parse the URI, we can't resolve imports
    return result;
  }

  if (!ast.imports || ast.imports.length === 0) {
    return result;
  }

  const visited = new Set<string>();
  const stack: string[] = [];

  const processFile = async (absPath: string): Promise<void> => {
    // Cycle detection
    if (stack.includes(absPath)) {
      result.errors.push(`Import cycle: ${[...stack, absPath].join(" -> ")}`);
      return;
    }
    
    // Already processed
    if (visited.has(absPath)) return;
    visited.add(absPath);
    result.sourceFiles.add(absPath);
    
    stack.push(absPath);
    try {
      // Read and parse the file
      let text: string;
      try {
        const file = Bun.file(absPath);
        if (!(await file.exists())) {
          result.errors.push(`Import not found: ${absPath}`);
          return;
        }
        text = await file.text();
      } catch (e) {
        result.errors.push(`Failed to read: ${absPath}`);
        return;
      }

      let importedAst: DocumentNode;
      try {
        importedAst = new Parser().parse(text, { sourcePath: absPath });
      } catch (e) {
        result.errors.push(`Parse error in ${absPath}: ${e}`);
        return;
      }

      const importUri = pathToFileURL(absPath).toString();

      // Collect defines
      for (const node of importedAst.body) {
        if (node.type === "define") {
          const def = node as DefineNode;
          if (!result.macros.has(def.name)) {
            const optionalParams = Object.keys(def.optionalParams ?? {});
            const optionalSet = new Set(optionalParams);
            const requiredParams = def.params.filter((p) => !optionalSet.has(p));
            
            result.macros.set(def.name, {
              name: def.name,
              requiredParams,
              optionalParams,
              node: def,
              location: nodeToLocation(importUri, def, def.name.length),
            });
          }
        }
        
        if (node.type === "anchor") {
          const anchor = node as AnchorNode;
          if (!result.anchors.has(anchor.name)) {
            result.anchors.set(
              anchor.name,
              nodeToLocation(importUri, anchor, anchor.name.length)
            );
          }
        }
      }

      // Recurse into nested imports
      for (const imp of importedAst.imports) {
        const childPath = resolveImportPath(absPath, imp.path);
        await processFile(childPath);
      }
    } finally {
      stack.pop();
    }
  };

  // Process each import in the current document
  for (const imp of ast.imports) {
    const absPath = resolveImportPath(currentPath, imp.path);
    await processFile(absPath);
  }

  return result;
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
