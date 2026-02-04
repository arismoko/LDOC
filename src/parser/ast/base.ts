export interface BaseNode {
  type: string;
  line: number;
  column: number;
  // Used by template instantiation to scope anchors/refs.
  scope?: string;
}

// Helper to create nodes
export function createNode<T extends BaseNode>(
  type: T["type"],
  line: number,
  column: number,
  props: Omit<T, "type" | "line" | "column">
): T {
  return { type, line, column, ...props } as T;
}
