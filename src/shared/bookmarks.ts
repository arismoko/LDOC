/**
 * Bookmark and cross-reference utilities.
 */

/**
 * Convert a label to a Word-safe bookmark name.
 * Word bookmark rules: start with letter, only [A-Za-z0-9_], max 40 chars.
 */
export function bookmarkSafeName(label: string): string {
  // Normalize to slug
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  
  // Ensure we have something
  const core = slug || "anchor";
  
  // Must start with letter
  const prefixed = /^[a-z]/.test(core) ? core : `a_${core}`;
  
  // Max 40 characters
  return prefixed.slice(0, 40);
}

/**
 * Normalize a label for ref-key lookup.
 * Trims, collapses whitespace, normalizes quotes, and lowercases.
 */
export function normalizeRefKey(label: string): string {
  return label
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[""]/g, '"')
    .toLowerCase();
}

/**
 * Generate a unique bookmark name with suffix.
 */
export function uniqueBookmark(base: string, index: number): string {
  const safe = bookmarkSafeName(base);
  const suffix = `_${index}`;
  const maxBase = 40 - suffix.length;
  return safe.slice(0, maxBase) + suffix;
}
