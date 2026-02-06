import { twipsToInches, formatInches, formatTwipsAsPt } from "../shared/units";
import { styleIdToLdocKey, styleToLdocLines, type FullStyleInfo } from "./parsers/style-resolver";
import type { LayoutInfo } from "./parsers/layout";
import type { FontSizeStats } from "./statistics";

export type SpacingInfo = {
  lineMultiplier?: number;
  beforeTwip?: number;
  afterTwip?: number;
  align?: string;
};

export type DocumentBlockOptions = {
  layout: LayoutInfo;
  spacingInfo: SpacingInfo | undefined;
  dominantStyle: FontSizeStats;
  usedStyles: Map<string, FullStyleInfo>;
};

/**
 * Emit the @document block with margins, orientation, spacing, and styles.
 * Returns empty array if no non-default settings are present.
 */
export function emitDocumentBlock(options: DocumentBlockOptions): string[] {
  const { layout, spacingInfo, dominantStyle, usedStyles } = options;
  const output: string[] = [];

  // Default header/footer distances in docx lib are ~720 twips (0.5in)
  const DEFAULT_HF_DISTANCE = 720;
  
  const hasNonDefaultHfDistances = layout.margins && (
    (layout.margins.header !== undefined && Math.abs(layout.margins.header - DEFAULT_HF_DISTANCE) > 50) ||
    (layout.margins.footer !== undefined && Math.abs(layout.margins.footer - DEFAULT_HF_DISTANCE) > 50)
  );
  
  const hasNonDefaultMargins = layout.margins && (
    Math.abs(twipsToInches(layout.margins.top) - 1) >= 0.05 ||
    Math.abs(twipsToInches(layout.margins.right) - 1) >= 0.05 ||
    Math.abs(twipsToInches(layout.margins.bottom) - 1) >= 0.05 ||
    Math.abs(twipsToInches(layout.margins.left) - 1) >= 0.05 ||
    hasNonDefaultHfDistances
  );
  
  // Check if we have styles to emit (beyond just body defaults)
  const hasNonBodyStyles = Array.from(usedStyles.keys()).some(
    id => id !== "Normal" && (
      usedStyles.get(id)?.align !== undefined ||
      usedStyles.get(id)?.bold !== undefined ||
      usedStyles.get(id)?.italic !== undefined
    )
  );
  
  const hasDominantStyles = dominantStyle.font || dominantStyle.sizePt || hasNonBodyStyles;
  
  const hasLayoutSettings =
    hasNonDefaultMargins ||
    layout.landscape ||
    (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0) ||
    spacingInfo?.beforeTwip !== undefined ||
    spacingInfo?.afterTwip !== undefined ||
    hasDominantStyles;

  if (!hasLayoutSettings) {
    return [];
  }

  output.push("@document");
  
  // Margins
  if (hasNonDefaultMargins && layout.margins) {
    const { top, right, bottom, left } = layout.margins;
    output.push("  margins:");
    output.push(`    top: ${formatInches(twipsToInches(top))}in`);
    output.push(`    right: ${formatInches(twipsToInches(right))}in`);
    output.push(`    bottom: ${formatInches(twipsToInches(bottom))}in`);
    output.push(`    left: ${formatInches(twipsToInches(left))}in`);
    if (layout.margins.header !== undefined && Math.abs(layout.margins.header - DEFAULT_HF_DISTANCE) > 50) {
      output.push(`    header: ${formatInches(twipsToInches(layout.margins.header))}in`);
    }
    if (layout.margins.footer !== undefined && Math.abs(layout.margins.footer - DEFAULT_HF_DISTANCE) > 50) {
      output.push(`    footer: ${formatInches(twipsToInches(layout.margins.footer))}in`);
    }
  }
  
  // Orientation
  if (layout.landscape) {
    output.push("  orientation: landscape");
  }
  
  // Spacing
  if (
    (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0) ||
    spacingInfo?.beforeTwip !== undefined ||
    spacingInfo?.afterTwip !== undefined
  ) {
    output.push(`  spacing:`);
    if (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0) {
      output.push(`    line: ${spacingInfo.lineMultiplier}`);
    }
    if (spacingInfo?.beforeTwip !== undefined) {
      output.push(`    before: ${formatTwipsAsPt(spacingInfo.beforeTwip)}`);
    }
    if (spacingInfo?.afterTwip !== undefined) {
      output.push(`    after: ${formatTwipsAsPt(spacingInfo.afterTwip)}`);
    }
  }
  
  // Styles
  if (hasDominantStyles) {
    const styleLines: string[] = [];
    
    // Body style lines
    const bodyLines: string[] = [];
    if (dominantStyle.font) {
      bodyLines.push(`      font: ${dominantStyle.font}`);
    }
    if (dominantStyle.sizePt) {
      bodyLines.push(`      size: ${dominantStyle.sizePt}pt`);
    }
    // Add default alignment if justify (most common non-default)
    if (spacingInfo?.align === "justify") {
      bodyLines.push(`      align: justify`);
    }
    if (bodyLines.length > 0) {
      styleLines.push("    body:", ...bodyLines);
    }
    
    // Other used styles (headings, etc.)
    for (const [styleId, style] of usedStyles) {
      if (styleId === "Normal") continue; // Already handled as body
      
      const ldocKey = styleIdToLdocKey(styleId);
      const lines = styleToLdocLines(ldocKey, style, dominantStyle);
      if (lines.length > 0) {
        styleLines.push(...lines);
      }
    }
    
    // Only emit styles: block if there are actual styles
    if (styleLines.length > 0) {
      output.push("  styles:");
      output.push(...styleLines);
    }
  }
  
  output.push("");
  return output;
}
