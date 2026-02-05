/**
 * LDOC Parser
 * 
 * Phase 1 of the pipeline: Source text → CST
 */

export { Lexer, tokenize, type LexResult } from "./lexer.ts";
export { Parser, parse } from "./parser.ts";

import { tokenize } from "./lexer.ts";
import { parse } from "./parser.ts";
import type { ParseResult } from "../types/cst.ts";

/**
 * Parse LDOC source text to CST in one step.
 */
export function parseSource(source: string): ParseResult {
  const { tokens, diagnostics: lexDiagnostics } = tokenize(source);
  const { cst, diagnostics: parseDiagnostics } = parse(tokens);
  
  return {
    cst,
    diagnostics: [...lexDiagnostics, ...parseDiagnostics],
  };
}
