/**
 * DOCX Numbering Configuration
 * 
 * Converts NumberingDefinition[] from STYLE phase to docx INumberingOptions.
 */

import { AlignmentType, LevelFormat, convertInchesToTwip } from "docx";
import type { INumberingOptions, ILevelsOptions } from "docx";
import type { NumberingDefinition, NumberingLevel } from "../../types/styled.ts";

/**
 * Ensure default numbering definitions (ordered-decimal, ordered-legal, bullets)
 * exist in the definitions array. Call during context creation so they're
 * available when emitList() runs (before createNumberingConfig() finalizes them).
 */
export function ensureDefaultNumberingDefs(
  definitions: NumberingDefinition[]
): void {
  const hasBullet = definitions.some((d) => d.id === "bullets");
  if (!hasBullet) {
    definitions.push({
      id: "bullets",
      levels: createDefaultBulletDefs(),
    });
  }

  const hasDecimal = definitions.some((d) => d.id === "ordered-decimal");
  if (!hasDecimal) {
    definitions.push({
      id: "ordered-decimal",
      levels: createDefaultOrderedDefs(),
    });
  }

  // Always ensure legal exists — getNumberingReference() may return "ordered-legal"
  const hasLegal = definitions.some((d) => d.id === "ordered-legal");
  if (!hasLegal) {
    definitions.push({
      id: "ordered-legal",
      levels: createDefaultLegalDefs(),
    });
  }
}

/**
 * Create default bullet NumberingLevel definitions.
 */
function createDefaultBulletDefs(): NumberingLevel[] {
  const bullets = ["•", "◦", "▪"];
  const levels: NumberingLevel[] = [];
  for (let i = 0; i < 9; i++) {
    levels.push({
      level: i,
      format: "bullet",
      text: bullets[i % bullets.length]!,
      indent: convertInchesToTwip(0.5 * (i + 1)),
      hanging: convertInchesToTwip(0.25),
    });
  }
  return levels;
}

/**
 * Create default ordered NumberingLevel definitions (tiered decimal).
 */
function createDefaultOrderedDefs(): NumberingLevel[] {
  const levels: NumberingLevel[] = [];
  for (let i = 0; i < 9; i++) {
    const textParts: string[] = [];
    for (let j = 0; j <= i; j++) {
      textParts.push(`%${j + 1}`);
    }
    levels.push({
      level: i,
      format: "decimal",
      text: textParts.join(".") + ".",
      indent: convertInchesToTwip(0.25 + 0.5 * i),
      hanging: convertInchesToTwip(0.25),
    });
  }
  return levels;
}

/**
 * Create default legal NumberingLevel definitions.
 */
function createDefaultLegalDefs(): NumberingLevel[] {
  const levels: NumberingLevel[] = [];
  const formats: { fmt: NumberingLevel["format"]; text: string }[] = [
    { fmt: "decimal", text: "%1." },
    { fmt: "lowerLetter", text: "(%2)" },
    { fmt: "lowerRoman", text: "(%3)" },
    { fmt: "upperLetter", text: "(%4)" },
  ];
  for (let i = 0; i < 9; i++) {
    const fmtIdx = i % formats.length;
    const fmtConfig = formats[fmtIdx]!;
    levels.push({
      level: i,
      format: fmtConfig.fmt,
      text: fmtConfig.text,
      indent: convertInchesToTwip(0.25 + 0.5 * i),
      hanging: convertInchesToTwip(0.25),
    });
  }
  return levels;
}

/**
 * Convert NumberingDefinition array to docx numbering options.
 * Assumes ensureDefaultNumberingDefs() has already been called to add defaults.
 */
export function createNumberingConfig(
  definitions: NumberingDefinition[]
): INumberingOptions {
  const config = definitions.map((def) => ({
    reference: def.id,
    levels: def.levels.map((level) => levelToDocx(level)),
  }));
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
    ...(level.start !== undefined ? { start: level.start } : {}),
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
