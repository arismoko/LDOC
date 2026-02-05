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

// Shared utilities
export * from "./shared/index.ts";

// TODO: Phase 2-5 exports will be added as implemented
