/**
 * Shared unit conversion constants and functions.
 * Centralizes DRY violations across parser, compiler, and decompiler.
 */

// ============================================================================
// Unit Conversion Constants (to/from twips)
// ============================================================================

/** Twips per inch (1 inch = 1440 twips) */
export const TWIPS_PER_INCH = 1440;

/** Twips per centimeter (1 cm = 1440 / 2.54 twips) */
export const TWIPS_PER_CM = TWIPS_PER_INCH / 2.54;

/** Twips per millimeter (1 mm = 1440 / 25.4 twips) */
export const TWIPS_PER_MM = TWIPS_PER_INCH / 25.4;

/** Twips per point (1 pt = 20 twips) */
export const TWIPS_PER_PT = 20;

/** Line spacing unit (240 = single space in Word's lineRule="auto") */
export const TWIPS_PER_LINE_UNIT = 240;

/** Half-points per point (DOCX w:sz uses half-points) */
export const HALF_POINTS_PER_PT = 2;

/** Regex for parsing point values like "12pt" or "12" */
export const PT_VALUE_REGEX = /^(\d+(?:\.\d+)?)(pt)?$/i;

// ============================================================================
// Options for length parsing
// ============================================================================

export interface ParseLengthOptions {
  /**
   * If true, allows numeric values without units (defaults to inches).
   * If false, throws an error for values without units.
   * Default: false (strict mode)
   */
  lenient?: boolean;

  /**
   * Line number for error messages (optional).
   */
  line?: number;
}

// ============================================================================
// Length Parsing Functions
// ============================================================================

/**
 * Parse a length string (e.g., "1in", "2cm", "12pt") to twips.
 *
 * @param raw - The raw length string to parse
 * @param options - Parsing options
 * @returns The length in twips
 * @throws Error if the format is invalid (in strict mode)
 */
export function parseLengthToTwip(raw: string | number, options: ParseLengthOptions = {}): number {
  const { lenient = false, line } = options;

  // Handle numeric input (lenient mode assumes inches)
  if (typeof raw === "number") {
    if (lenient) {
      return Math.round(raw * TWIPS_PER_INCH);
    }
    const lineInfo = line !== undefined ? ` at line ${line}` : "";
    throw new Error(`Invalid length: ${raw}${lineInfo}. Use units like 1in, 2cm, 12pt.`);
  }

  const trimmed = String(raw).trim();

  // Try to match with units
  const withUnits = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)(in|cm|mm|pt)$/i);
  if (withUnits) {
    const value = parseFloat(withUnits[1]!);
    const unit = withUnits[2]!.toLowerCase();
    switch (unit) {
      case "in":
        return Math.round(value * TWIPS_PER_INCH);
      case "cm":
        return Math.round(value * TWIPS_PER_CM);
      case "mm":
        return Math.round(value * TWIPS_PER_MM);
      case "pt":
        return Math.round(value * TWIPS_PER_PT);
      default:
        throw new Error(`Unsupported unit: ${unit}`);
    }
  }

  // Lenient mode: try to match without units (assume inches)
  if (lenient) {
    const withoutUnits = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)$/);
    if (withoutUnits) {
      const value = parseFloat(withoutUnits[1]!);
      return Math.round(value * TWIPS_PER_INCH);
    }
    // Default fallback in lenient mode
    return TWIPS_PER_INCH; // 1in
  }

  // Strict mode: throw error
  const lineInfo = line !== undefined ? ` at line ${line}` : "";
  throw new Error(`Invalid length: ${raw}${lineInfo}. Use units like 1in, 2cm, 12pt.`);
}

// ============================================================================
// Twip Conversion Helpers
// ============================================================================

/**
 * Convert twips to inches.
 */
export function twipsToInches(twips: number): number {
  return twips / TWIPS_PER_INCH;
}

/**
 * Convert inches to twips.
 */
export function inchesToTwips(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH);
}

/**
 * Format a value in inches as a string for LDOC output.
 * Rounds to 2 decimal places and removes trailing zeros.
 */
export function formatInches(inches: number): string {
  const rounded = Math.round(inches * 100) / 100;
  return rounded.toString();
}

/**
 * Format twips as an LDOC-friendly length string with "in" suffix.
 */
export function formatTwipsAsInches(twips: number): string {
  return `${formatInches(twipsToInches(twips))}in`;
}

/**
 * Convert a line spacing multiplier to twips (for Word's lineRule="auto").
 * Single spacing = 240, double = 480, 1.5 = 360, etc.
 */
export function lineMultiplierToTwips(multiplier: number): number {
  return Math.round(multiplier * TWIPS_PER_LINE_UNIT);
}

/**
 * Convert twips to a line spacing multiplier.
 */
export function twipsToLineMultiplier(twips: number): number {
  return twips / TWIPS_PER_LINE_UNIT;
}

/**
 * Convert points to half-points (for w:sz in docx).
 */
export function ptToHalfPoints(pt: number): number {
  return Math.round(pt * HALF_POINTS_PER_PT);
}

/**
 * Convert half-points to points (from w:sz in docx).
 */
export function halfPointsToPt(halfPoints: number): number {
  return halfPoints / HALF_POINTS_PER_PT;
}

/**
 * Format twips as a pt string (e.g., "12pt", "10.5pt").
 */
export function formatTwipsAsPt(twips: number): string {
  const pt = twips / TWIPS_PER_PT;
  return `${pt.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}pt`;
}
