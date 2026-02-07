/**
 * LSP Navigation — go-to-definition, find references.
 */

import type { Position, Location } from "vscode-languageserver";
import type { Block, CSTDocument, CSTNode, Directive } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { parseArgsObject } from "../shared/args.ts";
import { positionInLocation, sourceLocationToRange } from "./position.ts";

function isArgsParseError(value: ReturnType<typeof parseArgsObject>): value is { ok: false } {
  return "ok" in value && value.ok === false;
}

/**
 * Context for navigation operations.
 */
export interface NavigationContext {
  cst: CSTDocument;
  symbols: SymbolTable;
  uri: string;
}

function walkBlock(block: Block, visit: (node: CSTNode) => void): void {
  visit(block);

  if (block.kind === "Directive" && block.body) {
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
  cst: CSTDocument,
  pos: Position
): CSTNode | null {
  let best: CSTNode | null = null;
  const line = pos.line + 1;

  const visit = (node: CSTNode): void => {
    const inRange = positionInLocation(pos, node.loc);
    const sameLine = node.loc.line === line;
    if (inRange || sameLine) {
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

function extractDefReferencesFromArgs(argsRaw: string | undefined, loc: Directive["loc"]): string[] {
  if (!argsRaw) {
    return [];
  }

  const parsed = parseArgsObject(`{${argsRaw.slice(1, -1)}}`, loc);
  if (isArgsParseError(parsed)) {
    return [];
  }

  const args = parsed;

  const refs: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      refs.push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (value && typeof value === "object") {
      for (const nested of Object.values(value as Record<string, unknown>)) {
        visit(nested);
      }
    }
  };

  if (typeof args.ref === "string") {
    refs.push(args.ref);
  }

  for (const value of Object.values(args)) {
    visit(value);
  }

  return refs;
}

function directiveReferencesDef(directive: Directive, symbolName: string): boolean {
  const refs = extractDefReferencesFromArgs(directive.argsRaw, directive.loc);
  return refs.some((ref) => ref === symbolName);
}

function findSymbolAtPosition(ctx: NavigationContext, pos: Position): string | null {
  const line = pos.line + 1;
  for (const [name, symbol] of ctx.symbols.defs) {
    if (positionInLocation(pos, symbol.definedAt) || symbol.definedAt.line === line) {
      return name;
    }
  }

  const node = findNodeAtPosition(ctx.cst, pos);
  if (!node || node.kind !== "Directive") {
    return null;
  }

  const refs = extractDefReferencesFromArgs(node.argsRaw, node.loc);
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
  const line = pos.line + 1;

  for (const symbol of ctx.symbols.defs.values()) {
    if (symbol.definedAt.line === line) {
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
    const refs = extractDefReferencesFromArgs(node.argsRaw, node.loc);
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
 *
 * STUBBED — returns empty array.
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

  const visit = (node: CSTNode): void => {
    if (node.kind === "Directive") {
      addReference(node);
    }
  };

  for (const child of ctx.cst.children) {
    walkBlock(child, visit);
  }

  return dedupeLocations(locations);
}
