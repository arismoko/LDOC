import { URI } from "vscode-uri";
import type { Position, Location } from "vscode-languageserver";
import type {
  CSTDocument,
  CSTNode,
  CSTListItem,
  CSTTableRow,
  CSTTableCell,
} from "../types/cst.ts";
import type { SourceLocation } from "../types/source-location.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { sourceLocationToRange, positionInLocation } from "./position.ts";

/**
 * Context for navigation operations.
 */
export interface NavigationContext {
  cst: CSTDocument;
  symbols: SymbolTable;
  uri: string; // Document URI for Location results
}

/**
 * Convert a file path to a URI.
 * If the source location has a source path, use that; otherwise fall back to context URI.
 */
function getUri(definedAt: SourceLocation, contextUri: string): string {
  if (definedAt.source) {
    return URI.file(definedAt.source).toString();
  }
  return contextUri;
}

/**
 * Any CST node that can be walked, including container nodes
 * that aren't in the CSTNode union.
 */
type WalkableNode = CSTNode | CSTListItem | CSTTableRow | CSTTableCell;

/**
 * Find the CST node at the given position.
 * Returns the deepest matching node (checks children first, then self).
 * Returns null if position is not within any node.
 *
 * @param cst - The CST document to search
 * @param pos - The LSP position to find
 * @returns The deepest CST node at that position, or null
 */
export function findNodeAtPosition(
  cst: CSTDocument,
  pos: Position
): CSTNode | null {
  // Search document children
  for (const child of cst.children) {
    const found = findInWalkableNode(child, pos);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Recursively search for the deepest CSTNode containing the position.
 * Walks through container nodes (ListItem, TableRow, TableCell) but
 * only returns actual CSTNode types.
 */
function findInWalkableNode(
  node: WalkableNode,
  pos: Position
): CSTNode | null {
  // First check if position is within this node at all
  if (!positionInLocation(pos, node.loc)) {
    return null;
  }

  // Get children and search them first (to find deepest match)
  const children = getWalkableChildren(node);
  for (const child of children) {
    const found = findInWalkableNode(child, pos);
    if (found) {
      return found;
    }
  }

  // No child matched - return this node if it's a CSTNode, else null
  if (
    node.type === "ListItem" ||
    node.type === "TableRow" ||
    node.type === "TableCell"
  ) {
    // These container types aren't CSTNode, so return null
    // (the position is in the container but not in any interesting child)
    return null;
  }

  return node;
}

/**
 * Get the children of a walkable node.
 */
function getWalkableChildren(node: WalkableNode): WalkableNode[] {
  switch (node.type) {
    case "Directive":
      return node.body ?? [];

    case "Paragraph":
    case "Header":
      return node.content;

    case "List":
      return node.items;

    case "ListItem":
      return [...node.content, ...node.children];

    case "Emphasis":
      return node.content;

    case "Link":
      return node.text;

    case "Blockquote":
      return node.content;

    case "Table":
      return node.rows;

    case "TableRow":
      return node.cells;

    case "TableCell":
      return node.content;

    case "FootnoteDef":
      return node.content;

    case "InlineDirective":
      return node.content;

    default:
      return [];
  }
}

/**
 * Determine what symbol is referenced at a given node.
 * Returns the symbol type and name, or null if not a symbol reference.
 */
function getSymbolAtNode(
  node: CSTNode,
  symbols: SymbolTable
):
  | { type: "macro"; name: string }
  | { type: "anchor"; name: string }
  | { type: "footnote"; name: string }
  | { type: "variable"; name: string }
  | null {
  switch (node.type) {
    case "Directive": {
      // @use(macroName) -> look up in macros
      if (node.name === "use" && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (firstArg && firstArg.type === "PositionalArg") {
          if (firstArg.value.type === "Identifier") {
            return { type: "macro", name: firstArg.value.name };
          }
          if (firstArg.value.type === "StringLiteral") {
            return { type: "macro", name: firstArg.value.value };
          }
        }
      }
      // @ref(anchorName) -> look up in anchors
      if (node.name === "ref" && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (firstArg && firstArg.type === "PositionalArg") {
          if (firstArg.value.type === "Identifier") {
            return { type: "anchor", name: firstArg.value.name };
          }
          if (firstArg.value.type === "StringLiteral") {
            return { type: "anchor", name: firstArg.value.value };
          }
        }
      }
      return null;
    }

    case "FootnoteRef":
      return { type: "footnote", name: node.label };

    case "CrossRef":
      return { type: "anchor", name: node.target };

    case "Variable":
      return { type: "variable", name: node.expression };

    default:
      return null;
  }
}

/**
 * Get the definition location for a symbol at the given position.
 * Returns null if no symbol found or symbol is undefined.
 *
 * @param ctx - Navigation context with CST, symbols, and URI
 * @param pos - The LSP position to check
 * @returns The Location of the definition, or null
 */
export function getDefinition(
  ctx: NavigationContext,
  pos: Position
): Location | null {
  const node = findNodeAtPosition(ctx.cst, pos);
  if (!node) {
    return null;
  }

  const symbolRef = getSymbolAtNode(node, ctx.symbols);
  if (!symbolRef) {
    return null;
  }

  // Look up the symbol
  let definedAt;
  switch (symbolRef.type) {
    case "macro": {
      const macro = ctx.symbols.macros.get(symbolRef.name);
      definedAt = macro?.definedAt;
      break;
    }
    case "anchor": {
      const anchor = ctx.symbols.anchors.get(symbolRef.name);
      definedAt = anchor?.definedAt;
      break;
    }
    case "footnote": {
      const footnote = ctx.symbols.footnotes.get(symbolRef.name);
      definedAt = footnote?.definedAt;
      break;
    }
    case "variable": {
      const variable = ctx.symbols.variables.get(symbolRef.name);
      definedAt = variable?.definedAt;
      break;
    }
  }

  if (!definedAt) {
    return null;
  }

  return {
    uri: getUri(definedAt, ctx.uri),
    range: sourceLocationToRange(definedAt),
  };
}

/**
 * Get all references to a symbol at the given position.
 *
 * @param ctx - Navigation context with CST, symbols, and URI
 * @param pos - The LSP position to check
 * @param includeDeclaration - If true, include the definition location
 * @returns Array of Locations for all references (may be empty)
 */
export function getReferences(
  ctx: NavigationContext,
  pos: Position,
  includeDeclaration: boolean
): Location[] {
  const node = findNodeAtPosition(ctx.cst, pos);
  if (!node) {
    return [];
  }

  const symbolRef = getSymbolAtNode(node, ctx.symbols);
  if (!symbolRef) {
    return [];
  }

  // Look up the symbol
  let symbol;
  switch (symbolRef.type) {
    case "macro":
      symbol = ctx.symbols.macros.get(symbolRef.name);
      break;
    case "anchor":
      symbol = ctx.symbols.anchors.get(symbolRef.name);
      break;
    case "footnote":
      symbol = ctx.symbols.footnotes.get(symbolRef.name);
      break;
    case "variable":
      symbol = ctx.symbols.variables.get(symbolRef.name);
      break;
  }

  if (!symbol) {
    return [];
  }

  const locations: Location[] = [];

  // Include declaration if requested
  if (includeDeclaration) {
    locations.push({
      uri: getUri(symbol.definedAt, ctx.uri),
      range: sourceLocationToRange(symbol.definedAt),
    });
  }

  // Add all usages (usages are always in the current document)
  for (const usage of symbol.usages) {
    locations.push({
      uri: getUri(usage, ctx.uri),
      range: sourceLocationToRange(usage),
    });
  }

  return locations;
}
