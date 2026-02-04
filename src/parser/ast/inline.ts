import type { BaseNode } from "./base";

export interface TextNode extends BaseNode {
  type: "text";
  value: string;
}

export interface VariableNode extends BaseNode {
  type: "variable";
  name: string;
  path: string[]; // For nested access like property.address
  filters: string[]; // For filters like | upper
}

export interface CrossRefNode extends BaseNode {
  type: "cross_ref";
  target: string;
}

export interface DefinedTermNode extends BaseNode {
  type: "defined_term";
  term: string;
  isDefinition: boolean; // First occurrence = definition
}

export interface BlankNode extends BaseNode {
  type: "blank";
  length: number; // Number of underscores
}

export interface EmphasisNode extends BaseNode {
  type: "emphasis";
  style: "bold" | "italic" | "bold_italic";
  content: InlineNode[];
}

// Inline nodes (can appear inside text)
export type InlineNode =
  | TextNode
  | VariableNode
  | CrossRefNode
  | DefinedTermNode
  | BlankNode
  | EmphasisNode;
