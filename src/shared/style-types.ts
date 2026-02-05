/**
 * Shared style type definitions.
 * Centralizes the core text style interface used by both compiler and decompiler.
 */

import type { HighlightColor } from "./highlight";

export interface CoreTextStyle {
  bold?: boolean;
  
  // 'italics' is used by docx library
  // 'italic' is used by our decompiler/parser
  italics?: boolean; 
  italic?: boolean;

  strike?: boolean;
  underline?: boolean;
  
  // Vertical alignment
  subscript?: boolean;
  superscript?: boolean;
  
  font?: string;
  color?: string; // Hex string without '#'
  
  // Size handling varies:
  // Compiler uses 'size' (half-points) for docx
  // Decompiler uses 'sizePt' (points) for logical representation
  size?: number;
  sizePt?: number;
  
  allCaps?: boolean;
  smallCaps?: boolean;
  doubleStrike?: boolean;
  highlight?: HighlightColor;

  /** Run character spacing in twips (1/20 pt), maps to w:spacing. */
  characterSpacing?: number;

  /** Run shading fill color as 6-hex without '#', maps to w:shd/@_w:fill. */
  shadingFill?: string;
}
