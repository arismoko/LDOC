/**
 * Shared inline text utility — recursively extracts plain text from inline nodes.
 */

import type { Inline } from "../../../types/document-ir.ts";

/**
 * Recursively extract plain text from inline nodes.
 * Walks into Styled and extracts Text.value.
 */
export function flattenInlineText(inlines: Inline[]): string {
  const parts: string[] = [];
  for (const node of inlines) {
    switch (node.type) {
      case "Text":
        parts.push(node.value);
        break;
      case "Styled":
        parts.push(flattenInlineText(node.content));
        break;
      // FootnoteRef, CrossRef, HardBreak, Tab, Field — no text
    }
  }
  return parts.join("");
}
