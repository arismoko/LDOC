/**
 * Shared inline text utility — recursively extracts plain text from inline nodes.
 */

import type { Inline } from "../../../types/document-ir.ts";

/**
 * Recursively extract plain text from inline nodes.
 * Walks into Bold, Italic, Underline, Strikethrough, Highlight, Styled, Link
 * and extracts Text.value and Code.value.
 */
export function flattenInlineText(inlines: Inline[]): string {
  const parts: string[] = [];
  for (const node of inlines) {
    switch (node.type) {
      case "Text":
        parts.push(node.value);
        break;
      case "Code":
        parts.push(node.value);
        break;
      case "Bold":
      case "Italic":
      case "Underline":
      case "Strikethrough":
      case "Highlight":
      case "Styled":
      case "Link":
        parts.push(flattenInlineText(node.content));
        break;
      // FootnoteRef, CrossRef, HardBreak, Tab, Field, Image, StyleRef — no text
    }
  }
  return parts.join("");
}
