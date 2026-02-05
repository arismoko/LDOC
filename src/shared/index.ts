/**
 * Shared module - centralizes common constants, types, and utilities.
 *
 * This module eliminates DRY violations across parser, compiler, and decompiler.
 */

// Unit conversions
export {
  TWIPS_PER_INCH,
  TWIPS_PER_CM,
  TWIPS_PER_MM,
  TWIPS_PER_PT,
  TWIPS_PER_LINE_UNIT,
  parseLengthToTwip,
  twipsToInches,
  inchesToTwips,
  formatInches,
  formatTwipsAsInches,
  lineMultiplierToTwips,
  twipsToLineMultiplier,
  type ParseLengthOptions,
} from "./units";

// Numbering
export {
  DEFAULT_LEVEL_FORMATS,
  getDefaultFormat,
  toRoman,
  toRomanLower,
  toLowerLetter,
  toUpperLetter,
  formatNumberValue,
  type NumberFormat,
} from "./numbering";

// Style names
export {
  STYLE_TARGETS,
  WORD_TO_LDOC_STYLE,
  LDOC_TO_WORD_STYLE,
  wordStyleToLdoc,
  ldocStyleToWord,
  isStyleTarget,
  type StyleTarget,
} from "./style-names";
