import type { INumberingOptions } from "docx";
import type { NumberingScheme } from "../parser/ast";
import { BookmarkManager } from "./bookmarks";
import { type StyleConfig } from "./styles";
import { createNumberingConfig } from "./numbering";

export interface CompilationContext {
  // Variable state
  variables: Record<string, any>;
  numberingCounters: Map<string, number>;
  definedTerms: Set<string>;

  // Compiler state
  bookmarkManager: BookmarkManager;
  missingCrossRefs: Set<string>;
  missingVariables: Map<string, { line: number; column: number }>;
  
  // Configuration
  numberingConfig: INumberingOptions;
  numberingScheme: NumberingScheme;
  styleConfig: StyleConfig;
  defaultSpacing?: { before?: number; after?: number; line?: number };
  
  // Style memory for numbering levels
  styleMemory: Map<number, string>;
}

export function createContext(variables: Record<string, any> = {}): CompilationContext {
  return {
    variables,
    numberingCounters: new Map(),
    definedTerms: new Set(),
    
    bookmarkManager: new BookmarkManager(),
    missingCrossRefs: new Set(),
    missingVariables: new Map(),
    
    numberingConfig: createNumberingConfig(),
    numberingScheme: "default",
    styleConfig: {},
    styleMemory: new Map(),
  };
}
