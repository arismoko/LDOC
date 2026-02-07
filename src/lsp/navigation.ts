/**
 * LSP Navigation — go-to-definition, find references.
 */

import type { Position, Location } from "vscode-languageserver";
import type {
  Block,
  CSTDocument,
  CSTNode,
  Directive,
} from "../types/cst.ts";
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
  const values = Object.values(args);

  if (typeof args.ref === "string") {
    refs.push(args.ref);
  }

  for (const value of values) {
    if (typeof value === "string") {
      refs.push(value);
    }
  }

  return refs;
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
  _ctx: NavigationContext,
  _pos: Position,
  _includeDeclaration: boolean
): Location[] {
  return [];
}
