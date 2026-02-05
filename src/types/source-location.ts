/**
 * Source location tracking for all nodes.
 * Enables precise error messages and source mapping.
 */
export interface SourceLocation {
  /** 1-based line number */
  line: number;
  /** 0-based column number */
  column: number;
  /** 1-based end line number */
  endLine: number;
  /** 0-based end column number */
  endColumn: number;
  /** Optional source file path */
  source?: string;
}

/**
 * Create a source location from line/column info.
 */
export function loc(
  line: number,
  column: number,
  endLine?: number,
  endColumn?: number,
  source?: string
): SourceLocation {
  return {
    line,
    column,
    endLine: endLine ?? line,
    endColumn: endColumn ?? column,
    source,
  };
}

/**
 * Merge two source locations into a span.
 */
export function span(start: SourceLocation, end: SourceLocation): SourceLocation {
  return {
    line: start.line,
    column: start.column,
    endLine: end.endLine,
    endColumn: end.endColumn,
    source: start.source,
  };
}
