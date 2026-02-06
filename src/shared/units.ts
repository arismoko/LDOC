/**
 * Unit conversion constants and functions.
 * All DOCX measurements use twips (1/1440 inch).
 */

// =============================================================================
// Constants
// =============================================================================

/** Twips per inch (1 inch = 1440 twips) */
export const TWIPS_PER_INCH = 1440;

/** Twips per centimeter */
export const TWIPS_PER_CM = TWIPS_PER_INCH / 2.54;

/** Twips per millimeter */
export const TWIPS_PER_MM = TWIPS_PER_INCH / 25.4;

/** Twips per point (1 pt = 20 twips) */
export const TWIPS_PER_PT = 20;

/** Line spacing unit (240 = single space in Word's lineRule="auto") */
export const LINE_SPACING_SINGLE = 240;

/** Alias for LINE_SPACING_SINGLE (used by decompiler) */
export const TWIPS_PER_LINE_UNIT = LINE_SPACING_SINGLE;

/** Half-points per point (DOCX w:sz uses half-points) */
export const HALF_POINTS_PER_PT = 2;

/** EMUs per inch (for images) */
export const EMUS_PER_INCH = 914400;

// =============================================================================
// Length Parsing
// =============================================================================

export type LengthUnit = "in" | "cm" | "mm" | "pt" | "px" | "twip";

export interface ParsedLength {
  value: number;
  unit: LengthUnit;
  twips: number;
}

/**
 * Parse a length string (e.g., "1in", "2cm", "12pt") to twips.
 * Throws on invalid input in strict mode.
 */
export function parseLengthToTwips(
  raw: string | number,
  options: { lenient?: boolean } = {}
): number {
  if (typeof raw === "number") {
    if (options.lenient) {
      return Math.round(raw * TWIPS_PER_INCH);
    }
    throw new Error(`Invalid length: ${raw}. Use units like 1in, 2cm, 12pt.`);
  }

  const trimmed = String(raw).trim();
  const match = trimmed.match(/^(-?[\d.]+)(in|cm|mm|pt|px|twip)?$/i);
  
  if (!match) {
    if (options.lenient) return TWIPS_PER_INCH;
    throw new Error(`Invalid length: "${raw}". Use units like 1in, 2cm, 12pt.`);
  }

  const value = parseFloat(match[1]!);
  const unit = (match[2]?.toLowerCase() ?? (options.lenient ? "in" : null)) as LengthUnit | null;

  if (!unit) {
    throw new Error(`Invalid length: "${raw}". Missing unit (in, cm, mm, pt).`);
  }

  return lengthToTwips(value, unit);
}

/**
 * Convert a numeric value with unit to twips.
 */
export function lengthToTwips(value: number, unit: LengthUnit): number {
  switch (unit) {
    case "in":
      return Math.round(value * TWIPS_PER_INCH);
    case "cm":
      return Math.round(value * TWIPS_PER_CM);
    case "mm":
      return Math.round(value * TWIPS_PER_MM);
    case "pt":
      return Math.round(value * TWIPS_PER_PT);
    case "px":
      // Assume 96 DPI for pixels
      return Math.round(value * (TWIPS_PER_INCH / 96));
    case "twip":
      return Math.round(value);
  }
}

// =============================================================================
// Conversion Helpers
// =============================================================================

export function twipsToInches(twips: number): number {
  return twips / TWIPS_PER_INCH;
}

export function inchesToTwips(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH);
}

export function twipsToPt(twips: number): number {
  return twips / TWIPS_PER_PT;
}

export function ptToTwips(pt: number): number {
  return Math.round(pt * TWIPS_PER_PT);
}

export function ptToHalfPoints(pt: number): number {
  return Math.round(pt * HALF_POINTS_PER_PT);
}

export function halfPointsToPt(halfPoints: number): number {
  return halfPoints / HALF_POINTS_PER_PT;
}

export function lineMultiplierToTwips(multiplier: number): number {
  return Math.round(multiplier * LINE_SPACING_SINGLE);
}

export function twipsToLineMultiplier(twips: number): number {
  return twips / LINE_SPACING_SINGLE;
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format a value in inches as a string for LDOC output.
 * Rounds to 2 decimal places and removes trailing zeros.
 */
export function formatInches(inches: number): string {
  const rounded = Math.round(inches * 100) / 100;
  return rounded.toString();
}

/**
 * Format twips as an LDOC-friendly length string.
 */
export function formatTwipsAsInches(twips: number): string {
  const inches = twipsToInches(twips);
  const rounded = Math.round(inches * 100) / 100;
  return `${rounded}in`;
}

/**
 * Format twips as points.
 */
export function formatTwipsAsPt(twips: number): string {
  const pt = twipsToPt(twips);
  const formatted = pt % 1 === 0 ? pt.toString() : pt.toFixed(1);
  return `${formatted}pt`;
}
