/**
 * Shared numbering types and utilities.
 * Used by both compiler and decompiler for consistent list formatting.
 */

// ============================================================================
// Number Format Types
// ============================================================================

/**
 * Word-compatible number format types.
 * These map to Word's w:numFmt values.
 */
export type NumberFormat =
  | "decimal"
  | "lowerLetter"
  | "upperLetter"
  | "lowerRoman"
  | "upperRoman"
  | "bullet";

/**
 * Default level formats for legal-style numbering.
 * Level 0: decimal (1, 2, 3)
 * Level 1: lowerLetter (a, b, c)
 * Level 2: lowerRoman (i, ii, iii)
 * Level 3: upperLetter (A, B, C)
 */
export const DEFAULT_LEVEL_FORMATS: NumberFormat[] = [
  "decimal",
  "lowerLetter",
  "lowerRoman",
  "upperLetter",
];

/**
 * Get the default format for a given list level.
 */
export function getDefaultFormat(level: number): NumberFormat {
  return DEFAULT_LEVEL_FORMATS[level % DEFAULT_LEVEL_FORMATS.length]!;
}

// ============================================================================
// Roman Numeral Conversion
// ============================================================================

const ROMAN_NUMERALS: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/**
 * Convert an integer to uppercase Roman numerals.
 *
 * @param num - The number to convert (should be positive)
 * @returns The Roman numeral representation (uppercase)
 */
export function toRoman(num: number): string {
  let result = "";
  let n = num;
  for (const [value, numeral] of ROMAN_NUMERALS) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }
  return result || "I";
}

/**
 * Convert an integer to lowercase Roman numerals.
 */
export function toRomanLower(num: number): string {
  return toRoman(num).toLowerCase();
}

// ============================================================================
// Letter Conversion
// ============================================================================

/**
 * Convert an integer to lowercase letter (1->a, 2->b, ..., 26->z, 27->aa).
 */
export function toLowerLetter(num: number): string {
  let result = "";
  let n = num;
  while (n > 0) {
    n--;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result || "a";
}

/**
 * Convert an integer to uppercase letter (1->A, 2->B, ..., 26->Z, 27->AA).
 */
export function toUpperLetter(num: number): string {
  let result = "";
  let n = num;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result || "A";
}

// ============================================================================
// Format Value by Type
// ============================================================================

/**
 * Format a count value according to the specified number format.
 *
 * @param count - The count (1-based)
 * @param format - The number format type
 * @returns The formatted string
 */
export function formatNumberValue(count: number, format: NumberFormat): string {
  switch (format) {
    case "decimal":
      return String(count);
    case "lowerLetter":
      return toLowerLetter(count);
    case "upperLetter":
      return toUpperLetter(count);
    case "lowerRoman":
      return toRomanLower(count);
    case "upperRoman":
      return toRoman(count);
    case "bullet":
      return "-";
    default:
      return String(count);
  }
}
