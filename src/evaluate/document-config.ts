/**
 * Parser for @document YAML-like configuration.
 * 
 * Parses the opaque body of @document directive into structured settings.
 * This is a simplified YAML parser that handles the specific format used
 * by the decompiler.
 * 
 * Example input:
 *   margins:
 *     top: 0.9in
 *     right: 1in
 *   spacing:
 *     after: 6pt
 *   styles:
 *     body:
 *       font: Times New Roman
 */

import type { PageLayout, InlineStyleProps } from "../types/document-ir.ts";

/**
 * Parsed document configuration from @document body.
 */
export interface DocumentConfig {
  margins?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
    header?: string;
    footer?: string;
  };
  orientation?: "landscape" | "portrait";
  spacing?: {
    line?: number;
    before?: string;
    after?: string;
  };
  styles?: Record<string, StyleConfig>;
  title?: string;
  author?: string;
  date?: string;
  [key: string]: unknown;
}

export interface StyleConfig {
  font?: string;
  size?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right" | "justify";
  color?: string;
  [key: string]: unknown;
}

/**
 * Parse a YAML-like opaque body into document configuration.
 * 
 * Handles the indentation-based structure used by the decompiler.
 */
export function parseDocumentConfig(opaqueBody: string): DocumentConfig {
  const config: DocumentConfig = {};
  const lines = opaqueBody.split("\n");
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    
    if (!trimmed) {
      i++;
      continue;
    }
    
    // Parse top-level key
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }
    
    const key = trimmed.slice(0, colonIdx).trim();
    const valueAfterColon = trimmed.slice(colonIdx + 1).trim();
    
    if (valueAfterColon) {
      // Inline value: "key: value"
      config[key] = parseValue(valueAfterColon);
      i++;
    } else {
      // Block value: collect nested lines
      i++;
      const { value, endIndex } = parseNestedBlock(lines, i, getIndent(line));
      config[key] = value;
      i = endIndex;
    }
  }
  
  return config;
}

/**
 * Parse a nested block of indented lines.
 */
function parseNestedBlock(
  lines: string[],
  startIndex: number,
  parentIndent: number
): { value: Record<string, unknown>; endIndex: number } {
  const result: Record<string, unknown> = {};
  let i = startIndex;
  
  // Find the first non-empty line to determine block indent
  while (i < lines.length && !lines[i]!.trim()) {
    i++;
  }
  
  if (i >= lines.length) {
    return { value: result, endIndex: i };
  }
  
  const blockIndent = getIndent(lines[i]!);
  if (blockIndent <= parentIndent) {
    // Not actually indented, return empty
    return { value: result, endIndex: startIndex };
  }
  
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    
    if (!trimmed) {
      i++;
      continue;
    }
    
    const lineIndent = getIndent(line);
    if (lineIndent <= parentIndent) {
      // De-indented past parent, end of block
      break;
    }
    
    if (lineIndent < blockIndent) {
      // De-indented but still within parent, end of this block
      break;
    }
    
    // Parse key: value
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }
    
    const key = trimmed.slice(0, colonIdx).trim();
    const valueAfterColon = trimmed.slice(colonIdx + 1).trim();
    
    if (valueAfterColon) {
      // Inline value
      result[key] = parseValue(valueAfterColon);
      i++;
    } else {
      // Nested block
      i++;
      const { value, endIndex } = parseNestedBlock(lines, i, lineIndent);
      result[key] = value;
      i = endIndex;
    }
  }
  
  return { value: result, endIndex: i };
}

/**
 * Get the indentation level of a line (number of leading spaces/tabs).
 */
function getIndent(line: string): number {
  let indent = 0;
  for (const char of line) {
    if (char === " ") indent++;
    else if (char === "\t") indent += 2; // Treat tab as 2 spaces
    else break;
  }
  return indent;
}

/**
 * Parse a simple value (string, number, boolean).
 */
function parseValue(value: string): unknown {
  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;
  
  // Number (including lengths like 0.9in, 6pt)
  const numMatch = value.match(/^-?[\d.]+(?:in|pt|cm|mm|px)?$/);
  if (numMatch) {
    // If it has a unit, keep as string for later parsing
    if (/[a-z]+$/i.test(value)) {
      return value;
    }
    return parseFloat(value);
  }
  
  // String (may or may not be quoted)
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  
  return value;
}

/**
 * Parse a length value (e.g., "0.9in", "6pt") to twips.
 */
export function parseLengthToTwips(value: string): number | undefined {
  const match = value.match(/^(-?[\d.]+)(in|pt|cm|mm|px|twip)?$/);
  if (!match) return undefined;
  
  const num = parseFloat(match[1]!);
  const unit = match[2] || "pt";
  
  switch (unit) {
    case "in": return num * 1440; // 1 inch = 1440 twips
    case "pt": return num * 20;   // 1 point = 20 twips
    case "cm": return num * 567;  // 1 cm ≈ 567 twips
    case "mm": return num * 56.7; // 1 mm ≈ 56.7 twips
    case "px": return num * 15;   // 1 px ≈ 15 twips (96 dpi)
    case "twip": return num;
    default: return num * 20; // Default to points
  }
}

/**
 * Convert document config to PageLayout for the IR.
 */
export function configToPageLayout(config: DocumentConfig): PageLayout | undefined {
  const layout: PageLayout = {};
  let hasValue = false;
  
  if (config.margins) {
    const margins: { top: number; bottom: number; left: number; right: number } = {
      top: 1440, // 1 inch default
      bottom: 1440,
      left: 1440,
      right: 1440,
    };
    
    if (config.margins.top) {
      const val = parseLengthToTwips(String(config.margins.top));
      if (val !== undefined) margins.top = val;
    }
    if (config.margins.bottom) {
      const val = parseLengthToTwips(String(config.margins.bottom));
      if (val !== undefined) margins.bottom = val;
    }
    if (config.margins.left) {
      const val = parseLengthToTwips(String(config.margins.left));
      if (val !== undefined) margins.left = val;
    }
    if (config.margins.right) {
      const val = parseLengthToTwips(String(config.margins.right));
      if (val !== undefined) margins.right = val;
    }
    
    layout.margins = margins;
    hasValue = true;
  }
  
  if (config.orientation === "landscape") {
    layout.orientation = "landscape";
    hasValue = true;
  }
  
  return hasValue ? layout : undefined;
}
