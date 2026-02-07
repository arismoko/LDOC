/**
 * LDOC Type System
 * 
 * The 5-phase pipeline produces these intermediate representations:
 * 
 * 1. PARSE:    Source text → CST (Concrete Syntax Tree)
 * 2. BIND:     CST → BindResult (CST + SymbolTable)
 * 3. EVALUATE: BindResult → Document IR
 * 4. STYLE:    Document IR → StyledDocument
 * 5. EMIT:     StyledDocument → DOCX/HTML/etc.
 */

// Source location tracking
export * from "./source-location.ts";

// Diagnostics (errors, warnings)
export * from "./diagnostics.ts";

// Token types (lexer output)
export * from "./tokens.ts";

// CST types (parser output)
// NOTE: CST and Document IR share some type names (Document, Block, Table, etc.)
// We re-export CST under its own namespace to avoid collisions.
export * as CST from "./cst.ts";
export type { ParseResult } from "./cst.ts";

// Symbol table and binding (bind phase output)
export * from "./symbols.ts";

// Document IR (evaluate phase output)
export * from "./document-ir.ts";

// Styled document (style phase output)
// Note: DEFAULT_STYLE is re-exported from style/defaults.ts to avoid conflicts
export {
  type StyleResolver,
  type ComputedStyle,
  type ComputedBorder,
  type StyledBlock,
  type StyledInline,
  type StyleResult,
  type StyledDocument,
  type DocumentStyles,
  type StyleDefinition,
  type NumberingDefinition,
  type NumberingLevel,
} from "./styled.ts";
