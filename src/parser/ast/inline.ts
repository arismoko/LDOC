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

export interface HardBreakNode extends BaseNode {
  type: "hard_break";
}

export interface LinkNode extends BaseNode {
  type: "link";
  text: string;
  url: string;
}

export interface StrikethroughNode extends BaseNode {
  type: "strikethrough";
  content: InlineNode[];
}

export interface InlineCodeNode extends BaseNode {
  type: "inline_code";
  value: string;
}

export interface FootnoteReferenceNode extends BaseNode {
  type: "footnote_ref";
  label: string;
}

export interface ImageNode extends BaseNode {
  type: "image";
  alt: string;
  src: string;
}

export interface InlineStyleNode extends BaseNode {
  type: "inline_style";
  attributes: Record<string, string>;
  content: InlineNode[];  // Parsed children
}

// Inline nodes (can appear inside text)
export type InlineNode =
  | TextNode
  | VariableNode
  | CrossRefNode
  | DefinedTermNode
  | BlankNode
  | EmphasisNode
  | HardBreakNode
  | LinkNode
  | ImageNode
  | StrikethroughNode
  | InlineCodeNode
  | FootnoteReferenceNode
  | InlineStyleNode;
