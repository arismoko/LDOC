/**
 * Style resolver - resolves StyleRefs to ComputedStyle.
 * 
 * Resolution order:
 * 1. DEFAULT_STYLE (base)
 * 2. Built-in style (if name matches)
 * 3. User @style definitions (with inheritance chain)
 * 4. Inline overrides
 */

import type { StyleRef, InlineStyleProps } from "../types/document-ir.ts";
import type { SymbolTable, StyleSymbol } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import type { ComputedStyle, StyleResolver } from "../types/styled.ts";
import { loc as createLoc, type SourceLocation } from "../types/source-location.ts";
import { DiagnosticCode, warning, error } from "../types/diagnostics.ts";
import { DEFAULT_STYLE, BUILT_IN_STYLES, getBuiltInStyle } from "./defaults.ts";
import { applyInlineStyles } from "../types/styled.ts";

/**
 * Create a style resolver function.
 * The resolver caches computed styles for efficiency.
 */
export function createStyleResolver(
  symbols: SymbolTable,
  diagnostics: Diagnostic[]
): StyleResolver {
  // Cache for resolved named styles
  const cache = new Map<string, ComputedStyle>();
  
  /**
   * Resolve a named style, following inheritance chain.
   */
  function resolveByName(name: string, visited: Set<string>, loc?: SourceLocation): ComputedStyle {
    // Check cache first
    const cached = cache.get(name);
    if (cached) {
      return cached;
    }
    
    // Check for cycle
    if (visited.has(name)) {
      diagnostics.push(error(
        DiagnosticCode.STYLE_CYCLE,
        `Style inheritance cycle detected: ${[...visited, name].join(" -> ")}`,
        loc ?? createLoc(1, 0)
      ));
      return DEFAULT_STYLE;
    }
    
    // Check built-in first
    const builtIn = getBuiltInStyle(name);
    if (builtIn) {
      cache.set(name, builtIn);
      return builtIn;
    }
    
    // Check user-defined style
    const symbol = symbols.styles.get(name);
    if (!symbol) {
      diagnostics.push(warning(
        DiagnosticCode.STYLE_NOT_FOUND,
        `Style '${name}' not found, using defaults`,
        loc ?? createLoc(1, 0)
      ));
      return DEFAULT_STYLE;
    }
    
    // Resolve base style (inheritance)
    let base: ComputedStyle;
    if (symbol.extends) {
      const newVisited = new Set([...visited, name]);
      base = resolveByName(symbol.extends, newVisited, symbol.definedAt);
    } else {
      base = DEFAULT_STYLE;
    }
    
    // Apply this style's properties
    const result = applyStyleProperties(base, symbol);
    cache.set(name, result);
    return result;
  }
  
  /**
   * The main resolver function.
   */
  return (styleRef: StyleRef): ComputedStyle => {
    let style = DEFAULT_STYLE;
    
    // Resolve named style
    if (styleRef.name) {
      style = resolveByName(styleRef.name, new Set());
    }
    
    // Apply inline overrides
    if (styleRef.inline) {
      style = applyInlineStyles(style, styleRef.inline);
    }
    
    return style;
  };
}

/**
 * Apply StyleSymbol properties to a base ComputedStyle.
 * Maps the flexible Record<string, unknown> to typed properties.
 */
function applyStyleProperties(base: ComputedStyle, symbol: StyleSymbol): ComputedStyle {
  const props = symbol.properties;
  const result = { ...base };
  
  // Font properties
  if (typeof props["fontFamily"] === "string") result.fontFamily = props["fontFamily"];
  if (typeof props["font"] === "string") result.fontFamily = props["font"];
  if (typeof props["fontSize"] === "number") result.fontSize = props["fontSize"];
  if (typeof props["size"] === "number") result.fontSize = props["size"];
  if (typeof props["bold"] === "boolean") result.bold = props["bold"];
  if (typeof props["italic"] === "boolean") result.italic = props["italic"];
  if (typeof props["underline"] === "boolean") result.underline = props["underline"];
  if (typeof props["strikethrough"] === "boolean") result.strikethrough = props["strikethrough"];
  if (typeof props["strike"] === "boolean") result.strikethrough = props["strike"];
  if (typeof props["smallCaps"] === "boolean") result.smallCaps = props["smallCaps"];
  if (typeof props["allCaps"] === "boolean") result.allCaps = props["allCaps"];
  
  // Color properties
  if (typeof props["color"] === "string") result.color = normalizeColor(props["color"]);
  if (typeof props["backgroundColor"] === "string") result.backgroundColor = normalizeColor(props["backgroundColor"]);
  if (typeof props["highlightColor"] === "string") result.highlightColor = props["highlightColor"];
  if (typeof props["highlight"] === "string") result.highlightColor = props["highlight"];
  
  // Spacing properties
  if (typeof props["spaceBefore"] === "number") result.spaceBefore = props["spaceBefore"];
  if (typeof props["spaceAfter"] === "number") result.spaceAfter = props["spaceAfter"];
  if (typeof props["lineHeight"] === "number") result.lineHeight = props["lineHeight"];
  
  // Alignment
  if (isTextAlign(props["textAlign"])) result.textAlign = props["textAlign"];
  if (isTextAlign(props["align"])) result.textAlign = props["align"];
  
  // Indentation
  if (typeof props["indentLeft"] === "number") result.indentLeft = props["indentLeft"];
  if (typeof props["indentRight"] === "number") result.indentRight = props["indentRight"];
  if (typeof props["indentFirstLine"] === "number") result.indentFirstLine = props["indentFirstLine"];
  if (typeof props["indentHanging"] === "number") result.indentHanging = props["indentHanging"];
  
  // Keep properties
  if (typeof props["keepWithNext"] === "boolean") result.keepWithNext = props["keepWithNext"];
  if (typeof props["keepTogether"] === "boolean") result.keepTogether = props["keepTogether"];
  if (typeof props["pageBreakBefore"] === "boolean") result.pageBreakBefore = props["pageBreakBefore"];
  
  // Style ID
  result.paragraphStyleId = symbol.name;
  
  return result;
}

/**
 * Normalize color string (remove # prefix if present).
 */
function normalizeColor(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

/**
 * Type guard for text alignment values.
 */
function isTextAlign(value: unknown): value is "left" | "center" | "right" | "justify" {
  return value === "left" || value === "center" || value === "right" || value === "justify";
}
