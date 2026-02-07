/**
 * LSP Navigation — go-to-definition, find references.
 */

import type { Position, Location } from "vscode-languageserver";
import type { Block, Document, Directive } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { positionInLocation, sourceLocationToRange } from "./position.ts";

/**
 * Context for navigation operations.
 */
export interface NavigationContext {
  cst: Document;
  symbols: SymbolTable;
  uri: string;
}

function walkBlock(block: Block, visit: (node: Block) => void): void {
  visit(block);

  if (block.kind === "Directive" && block.body && block.body.kind === "StructuralBody") {
    for (const child of block.body.children) {
      walkBlock(child, visit);
    }
    return;
  }

  if (block.kind === "ListItemMarker" && block.body) {
    for (const child of block.body.children) {
      walkBlock(child, visit);
    }
    return;
  }

  if (block.kind === "StructuralBody") {
    for (const child of block.children) {
      walkBlock(child, visit);
    }
  }
}

export function findNodeAtPosition(
  cst: Document,
  pos: Position
): Block | null {
  let best: Block | null = null;

  const spanSize = (node: Block): number => {
    const lineSpan = node.loc.endLine - node.loc.line;
    const charSpan = node.loc.endColumn - node.loc.column;
    return lineSpan * 10_000 + charSpan;
  };

  const visit = (node: Block): void => {
    if (!positionInLocation(pos, node.loc)) {
      return;
    }

    if (!best || spanSize(node) <= spanSize(best)) {
      best = node;
    }
  };

  for (const child of cst.children) {
    walkBlock(child, visit);
  }

  return best;
}

function definitionLocation(uri: string, name: string, symbols: SymbolTable): Location | null {
  const symbol = symbols.defs.get(name);
  if (!symbol) {
    return null;
  }

  return {
    uri,
    range: sourceLocationToRange(symbol.definedAt),
  };
}

function extractDefReferencesFromArgs(directive: Directive): string[] {
  if (!directive.args) {
    return [];
  }
  return typeof directive.args.ref === "string" ? [directive.args.ref] : [];
}

function directiveReferencesDef(directive: Directive, symbolName: string): boolean {
  const refs = extractDefReferencesFromArgs(directive);
  return refs.some((ref) => ref === symbolName);
}

function isLikelyDefinitionHit(pos: Position, symbolName: string, definitionLine: number, definitionColumn: number): boolean {
  const line = pos.line + 1;
  if (line !== definitionLine) {
    return false;
  }

  const maxColumn = definitionColumn + symbolName.length + 16;
  return pos.character >= definitionColumn && pos.character <= maxColumn;
}

function findSymbolAtPosition(ctx: NavigationContext, pos: Position): string | null {
  for (const [name, symbol] of ctx.symbols.defs) {
    if (
      positionInLocation(pos, symbol.definedAt)
      || isLikelyDefinitionHit(pos, name, symbol.definedAt.line, symbol.definedAt.column)
    ) {
      return name;
    }
  }

  const node = findNodeAtPosition(ctx.cst, pos);
  if (!node || node.kind !== "Directive") {
    return null;
  }

  const refs = extractDefReferencesFromArgs(node);
  for (const ref of refs) {
    if (ctx.symbols.defs.has(ref)) {
      return ref;
    }
  }

  return null;
}

function dedupeLocations(locations: Location[]): Location[] {
  const seen = new Set<string>();
  const unique: Location[] = [];

  for (const location of locations) {
    const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(location);
  }

  return unique;
}

export function getDefinition(
  ctx: NavigationContext,
  pos: Position
): Location | null {
  for (const [name, symbol] of ctx.symbols.defs) {
    if (
      positionInLocation(pos, symbol.definedAt)
      || isLikelyDefinitionHit(pos, name, symbol.definedAt.line, symbol.definedAt.column)
    ) {
      return {
        uri: ctx.uri,
        range: sourceLocationToRange(symbol.definedAt),
      };
    }
  }

  const node = findNodeAtPosition(ctx.cst, pos);
  if (!node) {
    return null;
  }

  if (node.kind === "Directive") {
    const refs = extractDefReferencesFromArgs(node);
    for (const ref of refs) {
      const location = definitionLocation(ctx.uri, ref, ctx.symbols);
      if (location) {
        return location;
      }
    }
  }

  return null;
}

/**
 * Get all references to a symbol at the given position.
 */
export function getReferences(
  ctx: NavigationContext,
  pos: Position,
  includeDeclaration: boolean
): Location[] {
  const symbolName = findSymbolAtPosition(ctx, pos);
  if (!symbolName) {
    return [];
  }

  const locations: Location[] = [];

  if (includeDeclaration) {
    const declaration = definitionLocation(ctx.uri, symbolName, ctx.symbols);
    if (declaration) {
      locations.push(declaration);
    }
  }

  const addReference = (directive: Directive): void => {
    if (!directiveReferencesDef(directive, symbolName)) {
      return;
    }

    locations.push({
      uri: ctx.uri,
      range: sourceLocationToRange(directive.loc),
    });
  };

  const visit = (node: Block): void => {
    if (node.kind === "Directive") {
      addReference(node);
    }
  };

  for (const child of ctx.cst.children) {
    walkBlock(child, visit);
  }

  return dedupeLocations(locations);
}
