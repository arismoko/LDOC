import type { DocumentNode } from "../../parser/ast";
import { MacroExpander } from "./expander";

export async function expandDefinesAndUses(
  ast: DocumentNode,
  globals: Record<string, any>
): Promise<DocumentNode> {
  const expander = new MacroExpander(globals);
  return expander.expand(ast);
}
