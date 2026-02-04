import type { BaseNode } from "./base";
import type { Node } from "./index";

export interface DefineNode extends BaseNode {
  type: "define";
  name: string;
  // Params/template system is future work; MVP uses template only
  params: string[];
  optionalParams: Record<string, any>;
  template: Node[];
}

export interface UseNode extends BaseNode {
  type: "use";
  name: string;
  label?: string;
  args: Record<string, string>;
  children?: Node[];
}

export interface IfNode extends BaseNode {
  type: "if";
  condition: string;
  thenBranch: Node[];
  elseBranch: Node[];
}

export interface RepeatNode extends BaseNode {
  type: "repeat";
  count: number;
  body: Node[];
}

export interface ForeachNode extends BaseNode {
  type: "foreach";
  item: string;
  // Path or identifier to iterate over (e.g. items, parties.signatories)
  iterable: string;
  body: Node[];
}

export interface SetNode extends BaseNode {
  type: "set";
  name: string; // The variable name (e.g. "count" or "user.name")
  expression: string; // The raw expression to evaluate
}
