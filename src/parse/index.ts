/**
 * LDOC Parser
 * 
 * Phase 1 of the pipeline: Source text → CST
 */

import { Lexer, tokenize, type LexResult } from "./lexer.ts";
import { parseSource as parseTokens } from "./parser.ts";
import type { ParseResult } from "../types/cst.ts";

/**
 * Parse LDOC source text to CST in one step.
 */
export function parseSource(source: string): ParseResult {
  const { tokens, diagnostics: lexDiagnostics } = tokenize(source);
  const { cst, diagnostics: parseDiagnostics } = parseTokens(tokens);
  
  return {
    cst,
    diagnostics: [...lexDiagnostics, ...parseDiagnostics],
  };
}
