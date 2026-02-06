import { DiagnosticSeverity } from "vscode-languageserver";
import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver";
import type { Diagnostic as LDOCDiagnostic, DiagnosticSeverity as LDOCSeverity } from "../types/diagnostics.ts";
import { sourceLocationToRange } from "./position.ts";

/**
 * Map LDOC severity to LSP DiagnosticSeverity.
 */
function toLspSeverity(severity: LDOCSeverity): DiagnosticSeverity {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    case "hint":
      return DiagnosticSeverity.Hint;
  }
}

/**
 * Convert a single LDOC diagnostic to LSP diagnostic.
 *
 * @param diagnostic - The LDOC diagnostic to convert
 * @returns The equivalent LSP diagnostic
 */
export function toLspDiagnostic(diagnostic: LDOCDiagnostic): LSPDiagnostic {
  return {
    range: sourceLocationToRange(diagnostic.location),
    severity: toLspSeverity(diagnostic.severity),
    code: diagnostic.code,
    source: "ldoc",
    message: diagnostic.message,
  };
}

/**
 * Convert LDOC diagnostics to LSP diagnostics.
 *
 * @param diagnostics - Array of LDOC diagnostics to convert
 * @returns Array of equivalent LSP diagnostics
 */
export function toLspDiagnostics(diagnostics: LDOCDiagnostic[]): LSPDiagnostic[] {
  return diagnostics.map(toLspDiagnostic);
}
