/**
 * LSP Diagnostics Conversion Tests
 */

import { describe, test, expect } from "bun:test";
import { DiagnosticSeverity } from "vscode-languageserver";
import { toLspDiagnostic, toLspDiagnostics } from "../../src/lsp/diagnostics.ts";
import type { Diagnostic } from "../../src/types/diagnostics.ts";
import { loc } from "../../src/types/source-location.ts";

describe("toLspDiagnostic", () => {
  test("converts error diagnostic", () => {
    const ldocDiag: Diagnostic = {
      severity: "error",
      code: "E001",
      message: "Undefined macro 'foo'",
      location: loc(5, 10, 5, 15),
    };

    const lspDiag = toLspDiagnostic(ldocDiag);

    expect(lspDiag.severity).toBe(DiagnosticSeverity.Error);
    expect(lspDiag.code).toBe("E001");
    expect(lspDiag.message).toBe("Undefined macro 'foo'");
    expect(lspDiag.source).toBe("ldoc");
    expect(lspDiag.range.start.line).toBe(4); // 5 - 1
    expect(lspDiag.range.start.character).toBe(10);
    expect(lspDiag.range.end.line).toBe(4);
    expect(lspDiag.range.end.character).toBe(15);
  });

  test("converts warning diagnostic", () => {
    const ldocDiag: Diagnostic = {
      severity: "warning",
      code: "W001",
      message: "Unused variable",
      location: loc(1, 0, 1, 5),
    };

    const lspDiag = toLspDiagnostic(ldocDiag);

    expect(lspDiag.severity).toBe(DiagnosticSeverity.Warning);
  });

  test("converts info diagnostic", () => {
    const ldocDiag: Diagnostic = {
      severity: "info",
      code: "I001",
      message: "Information message",
      location: loc(1, 0, 1, 5),
    };

    const lspDiag = toLspDiagnostic(ldocDiag);

    expect(lspDiag.severity).toBe(DiagnosticSeverity.Information);
  });

  test("converts hint diagnostic", () => {
    const ldocDiag: Diagnostic = {
      severity: "hint",
      code: "H001",
      message: "Hint message",
      location: loc(1, 0, 1, 5),
    };

    const lspDiag = toLspDiagnostic(ldocDiag);

    expect(lspDiag.severity).toBe(DiagnosticSeverity.Hint);
  });
});

describe("toLspDiagnostics", () => {
  test("converts empty array", () => {
    const result = toLspDiagnostics([]);
    expect(result).toHaveLength(0);
  });

  test("converts multiple diagnostics", () => {
    const ldocDiags: Diagnostic[] = [
      {
        severity: "error",
        code: "E001",
        message: "Error 1",
        location: loc(1, 0, 1, 5),
      },
      {
        severity: "warning",
        code: "W001",
        message: "Warning 1",
        location: loc(2, 0, 2, 10),
      },
    ];

    const result = toLspDiagnostics(ldocDiags);

    expect(result).toHaveLength(2);
    expect(result[0]!.severity).toBe(DiagnosticSeverity.Error);
    expect(result[1]!.severity).toBe(DiagnosticSeverity.Warning);
  });

  test("preserves diagnostic order", () => {
    const ldocDiags: Diagnostic[] = [
      { severity: "error", code: "A", message: "First", location: loc(1, 0) },
      { severity: "error", code: "B", message: "Second", location: loc(2, 0) },
      { severity: "error", code: "C", message: "Third", location: loc(3, 0) },
    ];

    const result = toLspDiagnostics(ldocDiags);

    expect(result[0]!.code).toBe("A");
    expect(result[1]!.code).toBe("B");
    expect(result[2]!.code).toBe("C");
  });
});
