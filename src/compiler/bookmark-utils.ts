// Pure utility functions for bookmark/ref-key handling

/**
 * Convert a label to a Word-safe bookmark name.
 * Word bookmark rules: start with letter, only [A-Za-z0-9_], no spaces.
 */
export function bookmarkSafeName(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  const core = slug || "anchor";
  const prefixed = /^[a-z]/.test(core) ? core : `a_${core}`;
  const clipped = prefixed.length > 40 ? prefixed.slice(0, 40) : prefixed;
  return clipped;
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
