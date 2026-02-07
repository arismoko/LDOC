/**
 * DOCX Numbering Configuration
 * 
 * Converts NumberingDefinition[] from STYLE phase to docx INumberingOptions.
 */

import { AlignmentType, LevelFormat, convertInchesToTwip } from "docx";
import type { INumberingOptions, ILevelsOptions } from "docx";
import type { NumberingDefinition, NumberingLevel } from "../../types/styled.ts";

/**
 * Convert NumberingDefinition array to docx numbering options.
 */
export function createNumberingConfig(
  definitions: NumberingDefinition[],
  numberingMode?: string
): INumberingOptions {
  const config = definitions.map((def) => ({
    reference: def.id,
    levels: def.levels.map((level) => levelToDocx(level)),
  }));

  // Add default bullet list if not present
  const hasBullet = definitions.some((d) => d.levels[0]?.format === "bullet");
  if (!hasBullet) {
    config.push({
      reference: "bullets",
      levels: createBulletLevels(),
    });
  }

  // Add default ordered lists if not present
  const hasOrdered = definitions.some((d) => d.levels[0]?.format === "decimal");
  if (!hasOrdered) {
    // Always add tiered decimal as default
    config.push({
      reference: "ordered-decimal",
      levels: createOrderedLevels(),
    });
    // Always add legal format as well
    config.push({
      reference: "ordered-legal",
      levels: createLegalLevels(),
    });
  }

  return { config };
}

/**
 * Convert a single NumberingLevel to docx level config.
 */
function levelToDocx(level: NumberingLevel): ILevelsOptions {
  return {
    level: level.level,
    format: formatToLevelFormat(level.format),
    text: level.text,
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { 
          left: level.indent, 
          hanging: level.hanging 
        },
      },
    },
  };
}

/**
 * Map our format names to docx LevelFormat enum.
 */
function formatToLevelFormat(format: NumberingLevel["format"]): (typeof LevelFormat)[keyof typeof LevelFormat] {
  switch (format) {
    case "decimal": return LevelFormat.DECIMAL;
    case "lowerLetter": return LevelFormat.LOWER_LETTER;
    case "upperLetter": return LevelFormat.UPPER_LETTER;
    case "lowerRoman": return LevelFormat.LOWER_ROMAN;
    case "upperRoman": return LevelFormat.UPPER_ROMAN;
    case "bullet": return LevelFormat.BULLET;
    default:
      const _exhaustive: never = format;
      return LevelFormat.DECIMAL;
  }
}

/**
 * Create default bullet list levels.
 */
function createBulletLevels(): ILevelsOptions[] {
  const bullets = ["\u2022", "\u25E6", "\u25AA"]; // bullet, circle, square
  const levels: ILevelsOptions[] = [];

  for (let i = 0; i < 9; i++) {
    levels.push({
      level: i,
      format: LevelFormat.BULLET,
      text: bullets[i % bullets.length]!,
      alignment: AlignmentType.START,
      style: {
        paragraph: {
          indent: {
            left: convertInchesToTwip(0.5 * (i + 1)),
            hanging: convertInchesToTwip(0.25),
          },
        },
      },
    });
  }

  return levels;
}

/**
 * Create default ordered list levels (tiered decimal: 1., 1.1., 1.1.1., etc).
 */
function createOrderedLevels(): ILevelsOptions[] {
  const levels: ILevelsOptions[] = [];
  
  for (let i = 0; i < 9; i++) {
    // Build tiered text pattern: %1., %1.%2., %1.%2.%3., etc.
    const textParts: string[] = [];
    for (let j = 0; j <= i; j++) {
      textParts.push(`%${j + 1}`);
    }
    const text = textParts.join(".") + ".";
    
    levels.push({
      level: i,
      format: LevelFormat.DECIMAL,
      text,
      alignment: AlignmentType.START,
      style: {
        paragraph: {
          indent: {
            left: convertInchesToTwip(0.25 + 0.5 * i),
            hanging: convertInchesToTwip(0.25),
          },
        },
      },
    });
  }

  return levels;
}

/**
 * Create legal-style ordered list levels (alternating: 1., (a), (i), (A)).
 */
function createLegalLevels(): ILevelsOptions[] {
  const levels: ILevelsOptions[] = [];
  
  // Legal-style: 1., (a), (i), (A)
  const formats = [
    { fmt: LevelFormat.DECIMAL, text: "%1." },
    { fmt: LevelFormat.LOWER_LETTER, text: "(%2)" },
    { fmt: LevelFormat.LOWER_ROMAN, text: "(%3)" },
    { fmt: LevelFormat.UPPER_LETTER, text: "(%4)" },
  ];

  for (let i = 0; i < 9; i++) {
    const fmtIdx = i % formats.length;
    const fmtConfig = formats[fmtIdx]!;
    levels.push({
      level: i,
      format: fmtConfig.fmt,
      text: fmtConfig.text,
      alignment: AlignmentType.START,
      style: {
        paragraph: {
          indent: {
            left: convertInchesToTwip(0.25 + 0.5 * i),
            hanging: convertInchesToTwip(0.25),
          },
        },
      },
    });
  }

  return levels;
}

/**
 * Get numbering reference for a list.
 */
export function getNumberingReference(
  ordered: boolean,
  numberFormat: string | undefined,
  definitions: NumberingDefinition[],
  numberingMode?: string
): string {
  if (!ordered) {
    // Find a bullet definition or use default
    const bulletDef = definitions.find((d) => d.levels[0]?.format === "bullet");
    return bulletDef?.id ?? "bullets";
  }

  // Honor numbering mode first — legal mode should use legal format
  // unless a specific non-decimal format was requested
  if (numberingMode === "legal" && (numberFormat === undefined || numberFormat === "decimal")) {
    return "ordered-legal";
  }

  // For ordered lists, find matching format
  const format = numberFormat ?? "decimal";
  const matchingDef = definitions.find((d) => {
    const firstLevel = d.levels[0];
    return firstLevel && firstLevel.format === format;
  });

  return matchingDef?.id ?? "ordered-decimal";
}
