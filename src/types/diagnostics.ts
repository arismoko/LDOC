/**
 * Diagnostics system for errors, warnings, and hints.
 */

import type { SourceLocation } from "./source-location.ts";

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface Diagnostic {
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Error/warning code for programmatic handling */
  code: string;
  /** Human-readable message */
  message: string;
  /** Source location of the problem */
  location: SourceLocation;
  /** Optional related locations (e.g., "defined here") */
  related?: RelatedLocation[];
  /** Optional fix suggestions */
  suggestions?: Suggestion[];
}

export interface RelatedLocation {
  message: string;
  location: SourceLocation;
}

export interface Suggestion {
  message: string;
  /** The text to replace the range with */
  replacement: string;
}

/**
 * Diagnostic codes by category.
 */
export const DiagnosticCode = {
  // Parse errors (P***)
  UNEXPECTED_TOKEN: "P001",
  UNEXPECTED_EOF: "P002",
  INVALID_INDENT: "P003",
  UNCLOSED_BLOCK: "P004",
  INVALID_DIRECTIVE: "P005",
  
  // Binding errors (B***)
  UNDEFINED_MACRO: "B001",
  UNDEFINED_STYLE: "B002",
  UNDEFINED_VARIABLE: "B003",
  DUPLICATE_DEFINITION: "B004",
  IMPORT_NOT_FOUND: "B005",
  IMPORT_CYCLE: "B006",
  ARITY_MISMATCH: "B007",
  
  // Evaluation errors (E***)
  CONDITION_ERROR: "E001",
  ITERATION_ERROR: "E002",
  EXPRESSION_ERROR: "E003",
  
  // Style errors (S***)
  INVALID_STYLE_PROPERTY: "S001",
  INVALID_STYLE_VALUE: "S002",
  
  // Emit errors (M***)
  EMIT_ERROR: "M001",
  RESOURCE_NOT_FOUND: "M002",
} as const;

export type DiagnosticCodeType = typeof DiagnosticCode[keyof typeof DiagnosticCode];

/**
 * Create an error diagnostic.
 */
export function error(
  code: string,
  message: string,
  location: SourceLocation
): Diagnostic {
  return { severity: "error", code, message, location };
}

/**
 * Create a warning diagnostic.
 */
export function warning(
  code: string,
  message: string,
  location: SourceLocation
): Diagnostic {
  return { severity: "warning", code, message, location };
}

/**
 * Check if diagnostics contain any errors.
 */
export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/**
 * Format a diagnostic for display.
 */
export function formatDiagnostic(d: Diagnostic): string {
  const loc = d.location.source
    ? `${d.location.source}:${d.location.line}:${d.location.column}`
    : `${d.location.line}:${d.location.column}`;
  return `${d.severity.toUpperCase()} [${d.code}] ${loc}: ${d.message}`;
}
