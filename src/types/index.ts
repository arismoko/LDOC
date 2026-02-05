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
export * from "./cst.ts";

// Symbol table and binding (bind phase output)
export * from "./symbols.ts";

// Document IR (evaluate phase output)
export * from "./document-ir.ts";

// Styled document (style phase output)
export * from "./styled.ts";
