/**
 * Shared utilities for handling block content and paragraph joining.
 * Ensures consistent newline semantics across the decompiler (tables vs body).
 */

export interface BlockParagraph {
  content: string;
  isEmpty: boolean;
}

/**
 * Join block paragraphs into a single string with proper newline handling.
 * 
 * Rules:
 * - 2 newlines between non-empty paragraphs (paragraph separator)
 * - 3+ newlines for empty paragraphs (visual spacing)
 * - Consecutive empty paragraphs stack
 * 
 * @param paragraphs List of paragraphs to join
 * @returns Joined string ready for LDOC output
 */
export function joinBlockContent(paragraphs: BlockParagraph[]): string {
  const parts: string[] = [];
  let pendingEmpty = 0;

  for (const para of paragraphs) {
    if (para.isEmpty) {
      pendingEmpty++;
    } else {
      // If this is not the first paragraph, we need a separator
      if (parts.length > 0) {
        // Base separator is 2 newlines.
        // Each pending empty paragraph adds 1 extra newline.
        // Example: 
        // A, B -> A\n\nB (separator)
        // A, empty, B -> A\n\n\nB (separator + 1 blank line)
        parts.push("\n".repeat(2 + pendingEmpty));
      } else if (pendingEmpty > 0) {
        // Leading empty paragraphs
        // If we have leading empty paragraphs, we just output newlines?
        // Usually leading empty paragraphs in a cell might be significant.
        // But typically we trim start. Let's assume we preserve them if they exist.
        // A single empty paragraph at start = 1 blank line?
        // Actually, in LDOC, leading blank lines are usually consumed by indentation/block start.
        // But if we want to force an empty paragraph at the start, we need enough newlines.
        // Let's stick to the separator logic: 2 + pendingEmpty.
        // Wait, if parts.length is 0, we don't need a separator from "previous".
        // But we might need to represent the empty paragraphs themselves.
        // For now, let's just push the newlines if there were pending ones.
        // But we need to be careful not to introduce excessive whitespace at start.
        // Let's follow the table logic:
        // if (parts.length > 0) push separator
        // else if (pendingEmpty > 0) push separator (to represent leading empty space)
        parts.push("\n".repeat(2 + pendingEmpty));
      }
      
      parts.push(para.content);
      pendingEmpty = 0;
    }
  }

  // Trailing empty paragraphs
  if (pendingEmpty > 0) {
    parts.push("\n".repeat(2 + pendingEmpty));
  }

  return parts.join("");
}

/**
 * Helper to convert raw strings to BlockParagraphs.
 * Empty strings become empty paragraphs.
 */
export function stringsToBlockContent(strings: string[]): BlockParagraph[] {
  return strings.map(s => ({
    content: s,
    isEmpty: !s || s.trim().length === 0
  }));
}
