// Document layout/styles extraction helpers

import type { Node } from "../parser/ast";
import type { StyleConfig, StyleSettings } from "./styles";
import { parseLengthToTwipCompiler, parseMargins, parseSpacing, parseLengthToTwip, TWIPS_PER_LINE_UNIT } from "./parse";
import { STYLE_TARGETS } from "../shared/style-names";
import { ptToHalfPoints, PT_VALUE_REGEX } from "../shared/units";

/** Return type for layout extraction */
export interface LayoutResult {
  margins?: { top: number; right: number; bottom: number; left: number; header?: number; footer?: number };
  spacing?: { before?: number; after?: number; line?: number };
  landscape: boolean;
  pageWidthTwip: number;
  pageHeightTwip: number;
}

// Standard page sizes in twips
const PAGE_SIZES = {
  LETTER_PORTRAIT: { width: 12240, height: 15840 },
  LETTER_LANDSCAPE: { width: 15840, height: 12240 },
  A4_PORTRAIT: { width: Math.round(8.27 * 1440), height: Math.round(11.69 * 1440) },
  A4_LANDSCAPE: { width: Math.round(11.69 * 1440), height: Math.round(8.27 * 1440) },
} as const;

/**
 * Extract layout configuration from @document block.
 */
export function extractLayoutFromDocument(doc: Record<string, any> | undefined): LayoutResult {
  let pageSize: "letter" | "a4" = "letter";
  const layout: LayoutResult = {
    landscape: false,
    pageWidthTwip: PAGE_SIZES.LETTER_PORTRAIT.width,
    pageHeightTwip: PAGE_SIZES.LETTER_PORTRAIT.height,
  };

  if (!doc) return layout;

  // Parse page_size: "letter" | "a4" (default: letter)
  if (doc.page_size || doc["page-size"]) {
    const ps = String(doc.page_size || doc["page-size"]).toLowerCase();
    if (ps === "a4") pageSize = "a4";
    else if (ps === "letter") pageSize = "letter";
  }

  // Parse orientation/landscape: true | "portrait" | "landscape"
  if (doc.orientation || doc.landscape) {
    const orient = String(doc.orientation || doc.landscape || "").toLowerCase();
    if (orient === "landscape" || orient === "true") {
      layout.landscape = true;
    }
  }

  // Parse margins - supports dotted keys or nested object
  // margins.top, margins.right, margins.bottom, margins.left OR margins: { top: ..., right: ... }
  const marginsRaw = doc.margins;
  if (marginsRaw) {
    if (typeof marginsRaw === "string") {
      // Parse "1in 2in 3in 4in" format
      layout.margins = parseMargins(marginsRaw, parseLengthToTwip);
    } else if (typeof marginsRaw === "object") {
      // Parse { top: "1in", right: "2in", ... }
      const m: { top: number; right: number; bottom: number; left: number; header?: number; footer?: number } = {
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 1440,
      }; // default 1in
      if (marginsRaw.top) m.top = parseLengthToTwipCompiler(marginsRaw.top);
      if (marginsRaw.right) m.right = parseLengthToTwipCompiler(marginsRaw.right);
      if (marginsRaw.bottom) m.bottom = parseLengthToTwipCompiler(marginsRaw.bottom);
      if (marginsRaw.left) m.left = parseLengthToTwipCompiler(marginsRaw.left);
      if (marginsRaw.header) m.header = parseLengthToTwipCompiler(marginsRaw.header);
      if (marginsRaw.footer) m.footer = parseLengthToTwipCompiler(marginsRaw.footer);
      layout.margins = m;
    }
  }

  // Parse spacing - supports dotted keys or nested object
  const spacingRaw = doc.spacing;
  if (spacingRaw) {
    if (typeof spacingRaw === "string") {
      // Parse "1.5 before=6pt after=12pt" format
      layout.spacing = parseSpacing(spacingRaw, parseLengthToTwip);
    } else if (typeof spacingRaw === "object" || typeof spacingRaw === "number") {
      const sp: { before?: number; after?: number; line?: number } = {};
      if (typeof spacingRaw === "number") {
        // e.g., spacing: 1.5
        sp.line = Math.round(spacingRaw * TWIPS_PER_LINE_UNIT);
      } else {
        if (spacingRaw.line) sp.line = Math.round(Number(spacingRaw.line) * TWIPS_PER_LINE_UNIT);
        if (spacingRaw.before) sp.before = parseLengthToTwipCompiler(spacingRaw.before);
        if (spacingRaw.after) sp.after = parseLengthToTwipCompiler(spacingRaw.after);
      }
      if (Object.keys(sp).length > 0) layout.spacing = sp;
    }
  }

  // Set page dimensions based on size and orientation
  const size = pageSize === "a4"
    ? (layout.landscape ? PAGE_SIZES.A4_LANDSCAPE : PAGE_SIZES.A4_PORTRAIT)
    : (layout.landscape ? PAGE_SIZES.LETTER_LANDSCAPE : PAGE_SIZES.LETTER_PORTRAIT);
  layout.pageWidthTwip = size.width;
  layout.pageHeightTwip = size.height;

  return layout;
}

/**
 * Extract style configuration from @document block.
 */
export function extractStylesFromDocument(doc: Record<string, any> | undefined): StyleConfig {
  const config: StyleConfig = {};
  if (!doc || !doc.styles) return config;

  const stylesRaw = doc.styles;
  if (typeof stylesRaw !== "object") return config;

  // Parse styles.body, styles.heading1, etc.
  for (const target of STYLE_TARGETS) {
    const targetStyles = stylesRaw[target];
    if (!targetStyles || typeof targetStyles !== "object") continue;

    const settings: StyleSettings = {};
    if (targetStyles.font) settings.font = String(targetStyles.font);
    if (targetStyles.size) {
      // Parse size like "12pt" or 12
      const sizeVal = String(targetStyles.size);
      const m = sizeVal.match(PT_VALUE_REGEX);
      if (m) {
        const pt = parseFloat(m[1]!);
        settings.size = ptToHalfPoints(pt);
      }
    }
    if (targetStyles.bold !== undefined) {
      settings.bold = targetStyles.bold === true || targetStyles.bold === "true";
    }
    if (targetStyles.italic !== undefined) {
      settings.italic = targetStyles.italic === true || targetStyles.italic === "true";
    }
    if (targetStyles.color) {
      const colorMatch = String(targetStyles.color).match(/^#?([0-9A-Fa-f]{6})$/);
      if (colorMatch) {
        settings.color = colorMatch[1]!.toUpperCase();
      }
    }
    if (targetStyles.align) {
      const alignVal = String(targetStyles.align).toLowerCase();
      if (alignVal === "center" || alignVal === "right" || alignVal === "justify" || alignVal === "left") {
        settings.align = alignVal as "left" | "center" | "right" | "justify";
      }
    }

    if (Object.keys(settings).length > 0) {
      config[target as keyof StyleConfig] = settings;
    }
  }

  return config;
}

/**
 * Legacy layout extractor - now just passes body through since doc_layout nodes are no longer created.
 */
export function extractLayout(body: Node[]): {
  body: Node[];
  layout: LayoutResult;
} {
  const LETTER_PORTRAIT = { width: 12240, height: 15840 };

  const layout: LayoutResult = {
    landscape: false,
    pageWidthTwip: LETTER_PORTRAIT.width,
    pageHeightTwip: LETTER_PORTRAIT.height,
  };

  // No longer extract from body nodes - all layout now comes from @document block
  return { body, layout };
}

/**
 * Legacy styles extractor - now just passes body through since doc_styles nodes are no longer created.
 */
export function extractStyles(body: Node[]): { body: Node[]; styleConfig: StyleConfig } {
  // No longer extract from body nodes - all styles now come from @document block
  return { body, styleConfig: {} };
}
