/**
 * Default and built-in styles.
 * 
 * These provide the base styles that exist even without @style definitions.
 */

import type { ComputedStyle } from "../types/styled.ts";
import { DEFAULT_STYLE as BASE_DEFAULT_STYLE } from "../types/styled.ts";

// Re-export from types for convenience
export const DEFAULT_STYLE = BASE_DEFAULT_STYLE;

/**
 * Built-in styles that are always available.
 * These are merged on top of DEFAULT_STYLE when resolved.
 */
export const BUILT_IN_STYLES: Map<string, Partial<ComputedStyle>> = new Map([
  // Normal body text - inherits all defaults
  ["Normal", {
    paragraphStyleId: "Normal",
  }],
  
  // Headings
  ["Heading1", {
    fontSize: 48, // 24pt
    bold: true,
    spaceBefore: 240, // 12pt
    spaceAfter: 120, // 6pt
    keepWithNext: true,
    paragraphStyleId: "Heading1",
  }],
  ["Heading2", {
    fontSize: 36, // 18pt
    bold: true,
    spaceBefore: 200,
    spaceAfter: 80,
    keepWithNext: true,
    paragraphStyleId: "Heading2",
  }],
  ["Heading3", {
    fontSize: 28, // 14pt
    bold: true,
    spaceBefore: 160,
    spaceAfter: 60,
    keepWithNext: true,
    paragraphStyleId: "Heading3",
  }],
  ["Heading4", {
    fontSize: 24, // 12pt
    bold: true,
    spaceBefore: 120,
    spaceAfter: 40,
    keepWithNext: true,
    paragraphStyleId: "Heading4",
  }],
  ["Heading5", {
    fontSize: 22, // 11pt
    bold: true,
    italic: true,
    spaceBefore: 100,
    spaceAfter: 40,
    keepWithNext: true,
    paragraphStyleId: "Heading5",
  }],
  ["Heading6", {
    fontSize: 20, // 10pt
    bold: true,
    spaceBefore: 80,
    spaceAfter: 40,
    keepWithNext: true,
    paragraphStyleId: "Heading6",
  }],
  
  // Code
  ["Code", {
    fontFamily: "Courier New",
    fontSize: 20, // 10pt
    paragraphStyleId: "Code",
    characterStyleId: "Code",
  }],
  
  // Header/Footer
  ["Header", {
    fontSize: 20, // 10pt
    paragraphStyleId: "Header",
  }],
  ["Footer", {
    fontSize: 20, // 10pt
    paragraphStyleId: "Footer",
  }],
  
  // Blockquote
  ["Blockquote", {
    italic: true,
    indentLeft: 720, // 0.5 inch
    indentRight: 720,
    spaceBefore: 120,
    spaceAfter: 120,
    paragraphStyleId: "Blockquote",
  }],
  
  // List paragraph
  ["ListParagraph", {
    indentLeft: 720,
    paragraphStyleId: "ListParagraph",
  }],
]);

/**
 * Get a built-in style by name, merged with defaults.
 * Returns null if the style is not a built-in.
 */
export function getBuiltInStyle(name: string): ComputedStyle | null {
  const builtIn = BUILT_IN_STYLES.get(name);
  if (!builtIn) {
    return null;
  }
  return { ...DEFAULT_STYLE, ...builtIn };
}
