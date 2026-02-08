/**
 * Phase 4: STYLE
 * 
 * Transforms Document IR + Symbol Table into Styled Document by:
 * - Resolving StyleRefs to concrete ComputedStyle values
 * - Applying style inheritance chains
 * - Building style definitions for DOCX output
 * - Collecting numbering definitions for lists
 * 
 * Output: StyledDocument ready for EMIT phase.
 */

import type { Document, List } from "../types/document-ir.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import type {
  StyledDocument,
  StyleResult,
  DocumentStyles,
  StyleDefinition,
  NumberingDefinition,
  NumberingLevel,
  ComputedStyle,
} from "../types/styled.ts";
import { createStyleResolver } from "./resolver.ts";
import { DEFAULT_STYLE, BUILT_IN_STYLES } from "./defaults.ts";

export { createStyleResolver } from "./resolver.ts";
export { DEFAULT_STYLE, BUILT_IN_STYLES, getBuiltInStyle } from "./defaults.ts";

/**
 * Options for the style phase.
 */
export interface StyleOptions {
  /** Default page width in twips (default: 12240 = 8.5 inches) */
  pageWidth?: number;
  /** Default page height in twips (default: 15840 = 11 inches) */
  pageHeight?: number;
  /** Default margins in twips */
  margins?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  /** Page orientation (default: portrait) */
  orientation?: "portrait" | "landscape";
}

const DEFAULT_OPTIONS = {
  pageWidth: 12240, // 8.5 inches
  pageHeight: 15840, // 11 inches
  margins: {
    top: 1440, // 1 inch
    bottom: 1440,
    left: 1440,
    right: 1440,
  },
} as const;

/**
 * Main entry point for Phase 4.
 * 
 * Transforms Document IR + SymbolTable into StyledDocument.
 */
export function style(
  document: Document,
  options: StyleOptions = {}
): StyleResult {
  const diagnostics: Diagnostic[] = [];
  
  // Create the resolver
  const resolveStyle = createStyleResolver(diagnostics);
  
  // Build document-level styles
  const documentStyles = buildDocumentStyles(options);
  
  // Build style definitions from built-in styles
  const styleDefinitions = buildStyleDefinitions(resolveStyle);
  
  // Collect numbering definitions from document
  const numberingDefinitions = collectNumberingDefinitions(document);
  
  const styledDocument: StyledDocument = {
    document,
    documentStyles,
    styleDefinitions,
    numberingDefinitions,
    resolveStyle,
  };
  
  return { styledDocument, diagnostics };
}

/**
 * Build document-level style defaults.
 */
function buildDocumentStyles(opts: StyleOptions): DocumentStyles {
  const margins = opts.margins ?? DEFAULT_OPTIONS.margins;
  return {
    defaultParagraph: DEFAULT_STYLE,
    defaultCharacter: {
      fontFamily: DEFAULT_STYLE.fontFamily,
      fontSize: DEFAULT_STYLE.fontSize,
      bold: false,
      italic: false,
    },
    pageWidth: opts.pageWidth ?? DEFAULT_OPTIONS.pageWidth,
    pageHeight: opts.pageHeight ?? DEFAULT_OPTIONS.pageHeight,
    marginTop: margins.top ?? DEFAULT_OPTIONS.margins.top,
    marginBottom: margins.bottom ?? DEFAULT_OPTIONS.margins.bottom,
    marginLeft: margins.left ?? DEFAULT_OPTIONS.margins.left,
    marginRight: margins.right ?? DEFAULT_OPTIONS.margins.right,
    orientation: opts.orientation,
  };
}

/**
 * Build style definitions for DOCX styles.xml.
 * Includes built-in styles.
 */
function buildStyleDefinitions(
  resolveStyle: (ref: { name?: string }) => ComputedStyle
): StyleDefinition[] {
  const definitions: StyleDefinition[] = [];
  
  // Add built-in styles
  for (const [name] of BUILT_IN_STYLES) {
    const computed = resolveStyle({ name });
    definitions.push({
      id: name,
      name,
      type: "paragraph",
      style: extractStyleDiff(DEFAULT_STYLE, computed),
    });
  }
  
  return definitions;
}

/**
 * Extract only the properties that differ from the base.
 * This keeps style definitions minimal.
 */
function extractStyleDiff(
  base: ComputedStyle,
  target: ComputedStyle
): Partial<ComputedStyle> {
  const diff: Partial<ComputedStyle> = {};
  
  // Only include properties that differ from base
  if (target.fontFamily !== base.fontFamily) diff.fontFamily = target.fontFamily;
  if (target.fontSize !== base.fontSize) diff.fontSize = target.fontSize;
  if (target.bold !== base.bold) diff.bold = target.bold;
  if (target.italic !== base.italic) diff.italic = target.italic;
  if (target.underline !== base.underline) diff.underline = target.underline;
  if (target.strikethrough !== base.strikethrough) diff.strikethrough = target.strikethrough;
  if (target.smallCaps !== base.smallCaps) diff.smallCaps = target.smallCaps;
  if (target.allCaps !== base.allCaps) diff.allCaps = target.allCaps;
  if (target.color !== base.color) diff.color = target.color;
  if (target.backgroundColor !== base.backgroundColor) diff.backgroundColor = target.backgroundColor;
  if (target.highlightColor !== base.highlightColor) diff.highlightColor = target.highlightColor;
  if (target.spaceBefore !== base.spaceBefore) diff.spaceBefore = target.spaceBefore;
  if (target.spaceAfter !== base.spaceAfter) diff.spaceAfter = target.spaceAfter;
  if (target.lineHeight !== base.lineHeight) diff.lineHeight = target.lineHeight;
  if (target.textAlign !== base.textAlign) diff.textAlign = target.textAlign;
  if (target.indentLeft !== base.indentLeft) diff.indentLeft = target.indentLeft;
  if (target.indentRight !== base.indentRight) diff.indentRight = target.indentRight;
  if (target.indentFirstLine !== base.indentFirstLine) diff.indentFirstLine = target.indentFirstLine;
  if (target.indentHanging !== base.indentHanging) diff.indentHanging = target.indentHanging;
  if (target.keepWithNext !== base.keepWithNext) diff.keepWithNext = target.keepWithNext;
  if (target.keepTogether !== base.keepTogether) diff.keepTogether = target.keepTogether;
  if (target.pageBreakBefore !== base.pageBreakBefore) diff.pageBreakBefore = target.pageBreakBefore;
  if (target.paragraphStyleId !== base.paragraphStyleId) diff.paragraphStyleId = target.paragraphStyleId;
  if (target.characterStyleId !== base.characterStyleId) diff.characterStyleId = target.characterStyleId;
  
  return diff;
}

/**
 * Collect numbering definitions from the document.
 * Each unique list style combination gets its own definition.
 */
function collectNumberingDefinitions(document: Document): NumberingDefinition[] {
  const definitions: NumberingDefinition[] = [];
  const seenFormats = new Set<string>();
  
  // Walk document looking for lists
  function visitBlock(block: Document["blocks"][number]): void {
    if (block.type === "List") {
      const list = block as List;
      const formatKey = `${list.ordered}-${list.numberFormat ?? "decimal"}`;
      
      if (!seenFormats.has(formatKey)) {
        seenFormats.add(formatKey);
        definitions.push(createNumberingDefinition(list, definitions.length + 1));
      }
    }
    
    // Recurse into nested structures
    if ("content" in block && Array.isArray(block.content)) {
      for (const child of block.content) {
        if (typeof child === "object" && child !== null && "type" in child) {
          visitBlock(child as Document["blocks"][number]);
        }
      }
    }
    
    // Handle list items with nested blocks
    if (block.type === "List") {
      for (const item of (block as List).items) {
        for (const child of item.children) {
          visitBlock(child);
        }
      }
    }
  }
  
  for (const block of document.blocks) {
    visitBlock(block);
  }
  
  return definitions;
}

/**
 * Create a numbering definition for a list.
 */
function createNumberingDefinition(list: List, id: number): NumberingDefinition {
  const format = list.ordered
    ? (list.numberFormat ?? "decimal")
    : "bullet";
  
  // Create levels (up to 9 for nested lists)
  const levels: NumberingLevel[] = [];
  for (let level = 0; level < 9; level++) {
    levels.push({
      level,
      format: format as NumberingLevel["format"],
      text: list.ordered ? `%${level + 1}.` : "\u2022", // bullet character
      indent: 720 * (level + 1), // 0.5 inch per level
      hanging: 360, // 0.25 inch
    });
  }
  
  return {
    id: `num${id}`,
    levels,
  };
}
