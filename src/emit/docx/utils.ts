/**
 * DOCX Emit Utilities
 * 
 * Shared utilities for DOCX emission.
 */

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Make all properties of T mutable (removes readonly).
 * Used to work around docx package's readonly types.
 */
export type Mutable<T> = { -readonly [P in keyof T]: T[P] };

// =============================================================================
// Bookmark Utilities
// =============================================================================

/**
 * Sanitize bookmark name for DOCX compatibility.
 * DOCX bookmark names must be alphanumeric, underscore only, max 40 chars.
 */
export function sanitizeBookmarkName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 40);
}

// =============================================================================
// Color Utilities
// =============================================================================

/**
 * Parse a hex color string, normalizing to uppercase without # prefix.
 */
export function parseHexColor(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/^#?([0-9A-Fa-f]{6})$/);
  if (!m) return null;
  return (m[1] ?? "").toUpperCase();
}

/**
 * Check if a color is the default black (should be omitted).
 */
export function isDefaultBlack(color: string): boolean {
  return color === "000000" || color === "#000000";
}
