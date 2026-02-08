/**
 * Style resolver - resolves StyleRefs to ComputedStyle.
 * 
 * Resolution order:
 * 1. DEFAULT_STYLE (base)
 * 2. Built-in style (if name matches)
 * 3. Inline overrides
 */

import type { StyleRef } from "../types/document-ir.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import type { ComputedStyle, StyleResolver } from "../types/styled.ts";
import { DEFAULT_STYLE, getBuiltInStyle } from "./defaults.ts";
import { applyInlineStyles } from "../types/styled.ts";

/**
 * Create a style resolver function.
 * The resolver caches computed styles for efficiency.
 */
export function createStyleResolver(
  _diagnostics: Diagnostic[]
): StyleResolver {
  // Cache for resolved named styles
  const cache = new Map<string, ComputedStyle>();
  
  /**
   * Resolve a named style by looking up built-in styles.
   */
  function resolveByName(name: string): ComputedStyle {
    // Check cache first
    const cached = cache.get(name);
    if (cached) {
      return cached;
    }
    
    // Check built-in first
    const builtIn = getBuiltInStyle(name);
    if (builtIn) {
      cache.set(name, builtIn);
      return builtIn;
    }
    
    // No matching style found — fall back to defaults
    // (User-defined @style is not yet supported; names pass through to DOCX template)
    return DEFAULT_STYLE;
  }
  
  /**
   * The main resolver function.
   */
  return (styleRef: StyleRef): ComputedStyle => {
    let style = DEFAULT_STYLE;
    
    // Resolve named style
    if (styleRef.name) {
      style = resolveByName(styleRef.name);
      // Pass through unknown style names — they may exist in the DOCX template.
      // Even if resolveByName fell back to DEFAULT_STYLE, preserve the style ID
      // so the emitter can write it to the output paragraph.
      if (!style.paragraphStyleId) {
        style = { ...style, paragraphStyleId: styleRef.name };
      }
    }
    
    // Apply inline overrides
    if (styleRef.inline) {
      style = applyInlineStyles(style, styleRef.inline);
    }
    
    return style;
  };
}
