import {
  AlignmentType,
  convertInchesToTwip,
  LevelFormat,
} from "docx";

import type { INumberingOptions } from "docx";

import type { NumberingStyle, NumberingScheme } from "../parser/ast";

/**
 * Get the numbering reference string for a given style and level.
 * Uses styleMemory to track which reference was used at each level.
 */
export function getNumberingReference(
  style: NumberingStyle,
  level: number,
  numberingScheme: NumberingScheme,
  styleMemory: Map<number, string>
): string {
  // For explicit decimal_sub style:
  if (style.type === "decimal_sub") {
    const ref = "legal-decimal";
    styleMemory.set(level, ref);
    return ref;
  }

  // For other explicit styles (not auto): decimal, alpha_lower, alpha_upper, roman_lower, roman_upper
  // If numberingScheme is "decimal", use legal-decimal for decimal-type items
  if (style.type !== "auto") {
    const ref = (numberingScheme === "decimal" && style.type === "decimal") 
      ? "legal-decimal" 
      : "legal-default";
    styleMemory.set(level, ref);
    return ref;
  }

  // For auto style:
  // 1. If we have remembered style for this level, use it
  const remembered = styleMemory.get(level);
  if (remembered) {
    return remembered;
  }

  // 2. Otherwise use scheme default
  const ref = numberingScheme === "decimal" ? "legal-decimal" : "legal-default";
  styleMemory.set(level, ref);
  return ref;
}

/**
 * Get the label for a numbered item based on its style.
 * Returns undefined for styles that don't have a stable label.
 */
export function numberingLabel(style: NumberingStyle): string | undefined {
  switch (style.type) {
    case "decimal_sub":
      return style.pattern;
    default:
      return undefined;
  }
}

/**
 * Get the text indent in twips for list continuation paragraphs.
 * Matches the numbering config left indents.
 */
export function getListTextIndentTwip(levelIndex: number): number {
  // Matches numbering config left indents:
  // level 0: 0.25in (flush-left text start)
  // level 1+: 0.25 + 0.5 * levelIndex (0.75in, 1.25in, 1.75in, ...)
  if (levelIndex === 0) {
    return convertInchesToTwip(0.25);
  }
  const inches = 0.25 + 0.5 * levelIndex;
  return convertInchesToTwip(inches);
}

export function createNumberingConfig(): INumberingOptions {
  return {
    config: [
      // Legal style: 1., (a), (i), (A)
      {
        reference: "legal-default",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                // Flush-left: left=0.25in, hanging=0.25in -> number starts at 0
                indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) },
              },
            },
          },
          {
            level: 1,
            format: LevelFormat.LOWER_LETTER,
            text: "(%2)",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(0.75), hanging: convertInchesToTwip(0.25) },
              },
            },
          },
          {
            level: 2,
            format: LevelFormat.LOWER_ROMAN,
            text: "(%3)",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(1.25), hanging: convertInchesToTwip(0.25) },
              },
            },
          },
          {
            level: 3,
            format: LevelFormat.UPPER_LETTER,
            text: "(%4)",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(1.75), hanging: convertInchesToTwip(0.25) },
              },
            },
          },
        ],
      },
      // Decimal hierarchy: 1., 1.1., 1.1.1.
      {
        reference: "legal-decimal",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                // Flush-left: left=0.25in, hanging=0.25in -> number starts at 0
                indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) },
              },
            },
          },
          {
            level: 1,
            format: LevelFormat.DECIMAL,
            text: "%1.%2.",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(0.75), hanging: convertInchesToTwip(0.35) },
              },
            },
          },
          {
            level: 2,
            format: LevelFormat.DECIMAL,
            text: "%1.%2.%3.",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(1.25), hanging: convertInchesToTwip(0.45) },
              },
            },
          },
          {
            level: 3,
            format: LevelFormat.DECIMAL,
            text: "%1.%2.%3.%4.",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(1.75), hanging: convertInchesToTwip(0.55) },
              },
            },
          },
        ],
      },
      // Bullet list
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "\u2022",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
              },
            },
          },
          {
            level: 1,
            format: LevelFormat.BULLET,
            text: "\u25E6",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(1), hanging: convertInchesToTwip(0.25) },
              },
            },
          },
          {
            level: 2,
            format: LevelFormat.BULLET,
            text: "\u25AA",
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) },
              },
            },
          },
        ],
      },
    ],
  };
}
