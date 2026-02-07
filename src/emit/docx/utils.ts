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
