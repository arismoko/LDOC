export interface BaseNode {
  type: string;
  line: number;
  column: number;
  /** End line (1-based). Optional for backwards compatibility. */
  endLine?: number;
  /** End column (1-based, exclusive - points to position after last char). */
  endColumn?: number;
  // Used by template instantiation to scope anchors/refs.
  scope?: string;
}

/** Position info that can be extracted from a token */
export interface NodePosition {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * Helper to create nodes with position info.
 * Accepts either separate line/column or a NodePosition object.
 */
export function createNode<T extends BaseNode>(
  type: T["type"],
  pos: NodePosition,
  props: Omit<T, "type" | "line" | "column" | "endLine" | "endColumn">
): T {
  return {
    type,
    line: pos.line,
    column: pos.column,
    endLine: pos.endLine,
    endColumn: pos.endColumn,
    ...props,
  } as T;
}
