import type { SourceLocation } from "../types/source-location.ts";
import type { Position, Range } from "vscode-languageserver";

/**
 * Convert SourceLocation to LSP Range.
 *
 * SourceLocation uses 1-based lines and 0-based columns.
 * LSP Range uses 0-based lines and 0-based characters.
 *
 * @param loc - The source location to convert
 * @returns An LSP Range representing the same span
 */
export function sourceLocationToRange(loc: SourceLocation): Range {
  return {
    start: {
      line: loc.line - 1,
      character: loc.column,
    },
    end: {
      line: loc.endLine - 1,
      character: loc.endColumn,
    },
  };
}

/**
 * Check if an LSP Position falls within a SourceLocation.
 *
 * The position is considered "in" the location if it's at or after the start
 * and strictly before the end. This means:
 * - start <= position < end (half-open interval)
 * - When cursor is at boundary between siblings, it matches the node starting there
 *
 * @param pos - The LSP position to check (0-based line and character)
 * @param loc - The source location to check against (1-based line, 0-based column)
 * @returns True if the position falls within the location
 */
export function positionInLocation(pos: Position, loc: SourceLocation): boolean {
  // Convert LSP 0-based line to SourceLocation 1-based line for comparison
  const posLine = pos.line + 1;
  const posChar = pos.character;

  // Check if before start
  if (posLine < loc.line) {
    return false;
  }
  if (posLine === loc.line && posChar < loc.column) {
    return false;
  }

  // Check if at or after end (exclusive end)
  if (posLine > loc.endLine) {
    return false;
  }
  if (posLine === loc.endLine && posChar >= loc.endColumn) {
    return false;
  }

  return true;
}

/**
 * Convert LSP Position to character offset in text.
 *
 * @param text - The source text
 * @param pos - The LSP position (0-based line and character)
 * @returns The character offset from the start of the text
 */
export function positionToOffset(text: string, pos: Position): number {
  const lines = text.split("\n");
  let offset = 0;

  // Sum up characters from all lines before the target line
  for (let i = 0; i < pos.line && i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined) {
      offset += line.length + 1; // +1 for the newline character
    }
  }

  // Add the character offset within the target line
  const targetLine = lines[pos.line];
  if (pos.line < lines.length && targetLine !== undefined) {
    offset += Math.min(pos.character, targetLine.length);
  }

  // Clamp to text length
  return Math.min(offset, text.length);
}

/**
 * Convert character offset to LSP Position.
 *
 * @param text - The source text
 * @param offset - The character offset from the start of the text
 * @returns The LSP position (0-based line and character)
 */
export function offsetToPosition(text: string, offset: number): Position {
  // Handle edge cases
  if (offset <= 0 || text.length === 0) {
    return { line: 0, character: 0 };
  }

  // Clamp offset to text length
  const clampedOffset = Math.min(offset, text.length);

  let line = 0;
  let character = 0;
  let currentOffset = 0;

  for (let i = 0; i < clampedOffset; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
    currentOffset++;
  }

  return { line, character };
}
