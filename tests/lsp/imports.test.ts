/**
 * Tests for cross-file import resolution in LSP.
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "node:path";
import { URI } from "vscode-uri";

import { parseSource } from "../../src/parse/index.ts";
import { bind } from "../../src/bind/binder.ts";
import type { ParseResult } from "../../src/types/cst.ts";
import type { Diagnostic } from "../../src/types/diagnostics.ts";
import { getDefinition, getReferences, type NavigationContext } from "../../src/lsp/navigation.ts";

const FIXTURES_DIR = resolve(dirname(import.meta.path), "../fixtures/imports");

/**
 * Load and parse a file for import resolution.
 */
async function loadFile(path: string): Promise<ParseResult> {
  const content = await Bun.file(path).text();
  return parseSource(content);
}

describe("Cross-file imports", () => {
  describe("Symbol resolution", () => {
    test("imports macros from external file", async () => {
      const mainPath = resolve(FIXTURES_DIR, "main.ldoc");
      const mainContent = await Bun.file(mainPath).text();
      const { cst } = parseSource(mainContent);
      
      const { symbols, diagnostics } = await bind(cst, {
        sourcePath: mainPath,
        loadFile,
      });
      
      // Should have the imported macro
      expect(symbols.macros.has("sharedMacro")).toBe(true);
      
      // Macro's definedAt should point to lib.ldoc
      const macro = symbols.macros.get("sharedMacro")!;
      expect(macro.definedAt.source).toContain("lib.ldoc");
      
      // No "undefined" reference errors for the imported macro
      // (there may be "unused" warnings, but no undefined errors)
      const undefinedErrors = diagnostics.filter((d: Diagnostic) => 
        d.message.includes("Undefined") && d.message.includes("sharedMacro")
      );
      expect(undefinedErrors.length).toBe(0);
    });

    test("imports variables from external file", async () => {
      const mainPath = resolve(FIXTURES_DIR, "main.ldoc");
      const mainContent = await Bun.file(mainPath).text();
      const { cst } = parseSource(mainContent);
      
      const { symbols } = await bind(cst, {
        sourcePath: mainPath,
        loadFile,
      });
      
      // Should have the imported variable
      expect(symbols.variables.has("sharedVar")).toBe(true);
      
      // Variable's definedAt should point to lib.ldoc
      const variable = symbols.variables.get("sharedVar")!;
      expect(variable.definedAt.source).toContain("lib.ldoc");
    });

    test("imports anchors from external file", async () => {
      const mainPath = resolve(FIXTURES_DIR, "main.ldoc");
      const mainContent = await Bun.file(mainPath).text();
      const { cst } = parseSource(mainContent);
      
      const { symbols } = await bind(cst, {
        sourcePath: mainPath,
        loadFile,
      });
      
      // Should have the imported anchor
      expect(symbols.anchors.has("sharedAnchor")).toBe(true);
      
      // Anchor's definedAt should point to lib.ldoc
      const anchor = symbols.anchors.get("sharedAnchor")!;
      expect(anchor.definedAt.source).toContain("lib.ldoc");
    });

    test("imports styles from external file", async () => {
      const mainPath = resolve(FIXTURES_DIR, "main.ldoc");
      const mainContent = await Bun.file(mainPath).text();
      const { cst } = parseSource(mainContent);
      
      const { symbols } = await bind(cst, {
        sourcePath: mainPath,
        loadFile,
      });
      
      // Should have the imported style
      expect(symbols.styles.has("sharedStyle")).toBe(true);
      
      // Style's definedAt should point to lib.ldoc
      const style = symbols.styles.get("sharedStyle")!;
      expect(style.definedAt.source).toContain("lib.ldoc");
    });
  });

  describe("Cycle detection", () => {
    test("detects import cycles", async () => {
      const aPath = resolve(FIXTURES_DIR, "circular-a.ldoc");
      const aContent = await Bun.file(aPath).text();
      const { cst } = parseSource(aContent);
      
      const { diagnostics } = await bind(cst, {
        sourcePath: aPath,
        loadFile,
      });
      
      // Should have a cycle error
      const cycleErrors = diagnostics.filter((d: Diagnostic) => d.message.includes("cycle"));
      expect(cycleErrors.length).toBeGreaterThan(0);
    });
  });

  describe("Navigation", () => {
    test("go-to-definition returns cross-file location", async () => {
      const mainPath = resolve(FIXTURES_DIR, "main.ldoc");
      const mainContent = await Bun.file(mainPath).text();
      const { cst } = parseSource(mainContent);
      
      const { symbols } = await bind(cst, {
        sourcePath: mainPath,
        loadFile,
      });
      
      const ctx: NavigationContext = {
        cst,
        symbols,
        uri: URI.file(mainPath).toString(),
      };
      
      // Find position of @use(sharedMacro)
      // Line 4 (0-indexed): "@use(sharedMacro, "test")"
      const pos = { line: 4, character: 6 }; // Inside "sharedMacro"
      
      const definition = getDefinition(ctx, pos);
      
      // Definition should point to lib.ldoc
      expect(definition).not.toBeNull();
      expect(definition!.uri).toContain("lib.ldoc");
    });
  });

  describe("Missing imports", () => {
    test("reports error for missing import file", async () => {
      const content = `@import("nonexistent.ldoc")

# Test`;
      const { cst } = parseSource(content);
      
      const { diagnostics } = await bind(cst, {
        sourcePath: resolve(FIXTURES_DIR, "test.ldoc"),
        loadFile,
      });
      
      // Should have an import not found error
      const importErrors = diagnostics.filter((d: Diagnostic) => 
        d.message.includes("not found") || d.message.includes("ENOENT")
      );
      expect(importErrors.length).toBeGreaterThan(0);
    });
  });
});
