/**
 * LSP Navigation — go-to-definition, find references.
 *
 * STUBBED for v3 migration (commit 9.1).
 * Will be rewritten in commit 21.
 */

import type { Position, Location } from "vscode-languageserver";
import type { CSTDocument, CSTNode } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";

/**
 * Context for navigation operations.
 */
export interface NavigationContext {
  cst: CSTDocument;
  symbols: SymbolTable;
  uri: string;
}

/**
 * Find the CST node at the given position.
 *
 * STUBBED — returns null.
 */
export function findNodeAtPosition(
  _cst: CSTDocument,
  _pos: Position
): CSTNode | null {
  return null;
}

/**
 * Get the definition location for a symbol at the given position.
 *
 * STUBBED — returns null.
 */
export function getDefinition(
  _ctx: NavigationContext,
  _pos: Position
): Location | null {
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
