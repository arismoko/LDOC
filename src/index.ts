/**
 * LDOC - Legal Document DSL
 * 
 * A domain-specific language for generating Word documents.
 * 
 * Architecture: 5-Phase Pipeline
 * 
 * 1. PARSE:    Source text → CST (Concrete Syntax Tree)
 * 2. BIND:     CST → BoundAST + SymbolTable
 * 3. EVALUATE: BoundAST → DocumentIR (no directives, pure content)
 * 4. STYLE:    DocumentIR → StyledDocument (resolved styles)
 * 5. EMIT:     StyledDocument → DOCX/HTML/PDF
 */

// Types
export * from "./types/index.ts";

// Phase 1: Parse
export * from "./parse/index.ts";

// Phase 2: Bind
export * from "./bind/index.ts";

// Phase 3: Evaluate
export * from "./evaluate/index.ts";

// Phase 4: Style
export * from "./style/index.ts";

// Phase 5: Emit
export * from "./emit/index.ts";

// Shared utilities
export * from "./shared/index.ts";

// Pipeline (high-level API)
export * from "./pipeline/index.ts";
