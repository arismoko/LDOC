/**
 * Shared style name mappings.
 * Maps between Word style IDs and LDOC style keys.
 */

// ============================================================================
// Style Targets
// ============================================================================

/**
 * Valid style targets for @document.styles configuration.
 */
export const STYLE_TARGETS = [
  "body",
  "heading",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "header",
  "footer",
] as const;

export type StyleTarget = (typeof STYLE_TARGETS)[number];

/**
 * Check if a string is a valid style target.
 */
export function isStyleTarget(value: string): value is StyleTarget {
  return STYLE_TARGETS.includes(value as StyleTarget);
}

// ============================================================================
// Word <-> LDOC Style Mappings
// ============================================================================

/**
 * Map Word styleId to LDOC style key.
 */
export const WORD_TO_LDOC_STYLE: Record<string, string> = {
  Normal: "body",
  Heading1: "heading1",
  Heading2: "heading2",
  Heading3: "heading3",
  Heading4: "heading4",
  Heading5: "heading5",
  Heading6: "heading6",
  Header: "header",
  Footer: "footer",
};

/**
 * Map LDOC style key to Word styleId.
 */
export const LDOC_TO_WORD_STYLE: Record<string, string> = {
  body: "Normal",
  heading1: "Heading1",
  heading2: "Heading2",
  heading3: "Heading3",
  heading4: "Heading4",
  heading5: "Heading5",
  heading6: "Heading6",
  header: "Header",
  footer: "Footer",
};

/**
 * Convert a Word styleId to LDOC key.
 * Falls back to lowercase with spaces replaced by underscores.
 */
export function wordStyleToLdoc(styleId: string): string {
  return WORD_TO_LDOC_STYLE[styleId] ?? styleId.toLowerCase().replace(/\s+/g, "_");
}

/**
 * Convert an LDOC style key to Word styleId.
 * Falls back to the key with first letter capitalized.
 */
export function ldocStyleToWord(ldocKey: string): string {
  return LDOC_TO_WORD_STYLE[ldocKey] ?? ldocKey.charAt(0).toUpperCase() + ldocKey.slice(1);
}
