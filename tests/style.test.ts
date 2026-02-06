/**
 * Phase 4: STYLE tests
 */

import { describe, test, expect } from "bun:test";
import { style, createStyleResolver, DEFAULT_STYLE, BUILT_IN_STYLES, getBuiltInStyle } from "../src/style/index.ts";
import { createSymbolTable } from "../src/types/symbols.ts";
import type { Document, StyleRef } from "../src/types/document-ir.ts";
import type { SymbolTable, StyleSymbol } from "../src/types/symbols.ts";
import type { ComputedStyle } from "../src/types/styled.ts";
import { DiagnosticCode } from "../src/types/diagnostics.ts";
import { loc } from "../src/types/source-location.ts";

// Helper to create a minimal Document IR
function createDocument(blocks: Document["blocks"] = []): Document {
  return {
    type: "Document",
    metadata: { custom: {} },
    blocks,
  };
}

// Helper to create a StyleSymbol
function createStyleSymbol(
  name: string,
  properties: Record<string, unknown> = {},
  extendsStyle?: string
): StyleSymbol {
  return {
    name,
    properties,
    extends: extendsStyle,
    definedAt: loc(1, 0),
    usages: [],
  };
}

describe("STYLE Phase", () => {
  describe("defaults", () => {
    test("DEFAULT_STYLE has all required properties", () => {
      expect(DEFAULT_STYLE.fontFamily).toBe("Times New Roman");
      expect(DEFAULT_STYLE.fontSize).toBe(24);
      expect(DEFAULT_STYLE.bold).toBe(false);
      expect(DEFAULT_STYLE.italic).toBe(false);
      expect(DEFAULT_STYLE.textAlign).toBe("left");
      expect(DEFAULT_STYLE.color).toBe("000000");
    });

    test("BUILT_IN_STYLES contains standard styles", () => {
      expect(BUILT_IN_STYLES.has("Normal")).toBe(true);
      expect(BUILT_IN_STYLES.has("Heading1")).toBe(true);
      expect(BUILT_IN_STYLES.has("Heading2")).toBe(true);
      expect(BUILT_IN_STYLES.has("Heading6")).toBe(true);
      expect(BUILT_IN_STYLES.has("Code")).toBe(true);
      expect(BUILT_IN_STYLES.has("Header")).toBe(true);
      expect(BUILT_IN_STYLES.has("Footer")).toBe(true);
    });

    test("getBuiltInStyle returns merged style", () => {
      const heading1 = getBuiltInStyle("Heading1");
      expect(heading1).not.toBeNull();
      expect(heading1!.fontSize).toBe(48);
      expect(heading1!.bold).toBe(true);
      expect(heading1!.fontFamily).toBe("Times New Roman"); // inherited
    });

    test("getBuiltInStyle returns null for unknown style", () => {
      expect(getBuiltInStyle("UnknownStyle")).toBeNull();
    });
  });

  describe("resolver", () => {
    test("resolves empty StyleRef to DEFAULT_STYLE", () => {
      const symbols = createSymbolTable();
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({});
      expect(result).toEqual(DEFAULT_STYLE);
    });

    test("resolves built-in style by name", () => {
      const symbols = createSymbolTable();
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({ name: "Heading1" });
      expect(result.fontSize).toBe(48);
      expect(result.bold).toBe(true);
    });

    test("resolves user-defined style", () => {
      const symbols = createSymbolTable();
      symbols.styles.set("MyStyle", createStyleSymbol("MyStyle", {
        fontSize: 32,
        bold: true,
        color: "#FF0000",
      }));
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({ name: "MyStyle" });
      expect(result.fontSize).toBe(32);
      expect(result.bold).toBe(true);
      expect(result.color).toBe("FF0000"); // normalized
    });

    test("applies inline overrides on top of named style", () => {
      const symbols = createSymbolTable();
      symbols.styles.set("MyStyle", createStyleSymbol("MyStyle", {
        fontSize: 32,
        bold: true,
      }));
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({
        name: "MyStyle",
        inline: { italic: true, bold: false },
      });
      expect(result.fontSize).toBe(32);
      expect(result.bold).toBe(false); // overridden
      expect(result.italic).toBe(true); // added
    });

    test("applies inline overrides without named style", () => {
      const symbols = createSymbolTable();
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({
        inline: { bold: true, fontSize: 48 },
      });
      expect(result.bold).toBe(true);
      expect(result.fontSize).toBe(48);
      expect(result.fontFamily).toBe("Times New Roman"); // from default
    });

    test("emits warning for undefined style", () => {
      const symbols = createSymbolTable();
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({ name: "NonExistent" });
      expect(result).toEqual(DEFAULT_STYLE);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe(DiagnosticCode.STYLE_NOT_FOUND);
    });
  });

  describe("inheritance", () => {
    test("resolves single-level inheritance", () => {
      const symbols = createSymbolTable();
      symbols.styles.set("Base", createStyleSymbol("Base", {
        fontSize: 28,
        bold: true,
      }));
      symbols.styles.set("Child", createStyleSymbol("Child", {
        italic: true,
      }, "Base"));
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({ name: "Child" });
      expect(result.fontSize).toBe(28); // inherited
      expect(result.bold).toBe(true); // inherited
      expect(result.italic).toBe(true); // own
    });

    test("resolves multi-level inheritance", () => {
      const symbols = createSymbolTable();
      symbols.styles.set("GrandParent", createStyleSymbol("GrandParent", {
        fontFamily: "Arial",
      }));
      symbols.styles.set("Parent", createStyleSymbol("Parent", {
        fontSize: 28,
      }, "GrandParent"));
      symbols.styles.set("Child", createStyleSymbol("Child", {
        bold: true,
      }, "Parent"));
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({ name: "Child" });
      expect(result.fontFamily).toBe("Arial"); // from grandparent
      expect(result.fontSize).toBe(28); // from parent
      expect(result.bold).toBe(true); // own
    });

    test("user style extends built-in", () => {
      const symbols = createSymbolTable();
      symbols.styles.set("MyHeading", createStyleSymbol("MyHeading", {
        color: "#0000FF",
      }, "Heading1"));
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({ name: "MyHeading" });
      expect(result.fontSize).toBe(48); // from Heading1
      expect(result.bold).toBe(true); // from Heading1
      expect(result.color).toBe("0000FF"); // own
    });

    test("detects inheritance cycle", () => {
      const symbols = createSymbolTable();
      symbols.styles.set("A", createStyleSymbol("A", {}, "B"));
      symbols.styles.set("B", createStyleSymbol("B", {}, "A"));
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({ name: "A" });
      // Style A still gets its paragraphStyleId set, but base is DEFAULT_STYLE
      expect(result.fontFamily).toBe(DEFAULT_STYLE.fontFamily);
      expect(result.fontSize).toBe(DEFAULT_STYLE.fontSize);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0].code).toBe(DiagnosticCode.STYLE_CYCLE);
    });

    test("inheritance to undefined parent emits warning", () => {
      const symbols = createSymbolTable();
      symbols.styles.set("Child", createStyleSymbol("Child", {
        bold: true,
      }, "NonExistent"));
      const diagnostics: any[] = [];
      const resolver = createStyleResolver(symbols, diagnostics);

      const result = resolver({ name: "Child" });
      expect(result.bold).toBe(true);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0].code).toBe(DiagnosticCode.STYLE_NOT_FOUND);
    });
  });

  describe("style() function", () => {
    test("returns StyledDocument with resolver", () => {
      const doc = createDocument([]);
      const symbols = createSymbolTable();

      const result = style(doc, symbols);
      expect(result.styledDocument.document).toBe(doc);
      expect(result.styledDocument.resolveStyle).toBeDefined();
      expect(typeof result.styledDocument.resolveStyle).toBe("function");
    });

    test("sets default page dimensions", () => {
      const doc = createDocument([]);
      const symbols = createSymbolTable();

      const result = style(doc, symbols);
      expect(result.styledDocument.documentStyles.pageWidth).toBe(12240);
      expect(result.styledDocument.documentStyles.pageHeight).toBe(15840);
      expect(result.styledDocument.documentStyles.marginTop).toBe(1440);
    });

    test("respects custom page options", () => {
      const doc = createDocument([]);
      const symbols = createSymbolTable();

      const result = style(doc, symbols, {
        pageWidth: 10000,
        margins: { left: 720 },
      });
      expect(result.styledDocument.documentStyles.pageWidth).toBe(10000);
      expect(result.styledDocument.documentStyles.marginLeft).toBe(720);
      expect(result.styledDocument.documentStyles.marginTop).toBe(1440); // default
    });

    test("generates style definitions for built-in styles", () => {
      const doc = createDocument([]);
      const symbols = createSymbolTable();

      const result = style(doc, symbols);
      const styleIds = result.styledDocument.styleDefinitions.map(s => s.id);
      expect(styleIds).toContain("Normal");
      expect(styleIds).toContain("Heading1");
      expect(styleIds).toContain("Code");
    });

    test("generates style definitions for user styles", () => {
      const doc = createDocument([]);
      const symbols = createSymbolTable();
      symbols.styles.set("CustomStyle", createStyleSymbol("CustomStyle", {
        fontSize: 36,
      }));

      const result = style(doc, symbols);
      const customDef = result.styledDocument.styleDefinitions.find(
        s => s.id === "CustomStyle"
      );
      expect(customDef).toBeDefined();
      expect(customDef!.style.fontSize).toBe(36);
    });
  });

  describe("numbering definitions", () => {
    test("collects numbering from ordered list", () => {
      const doc = createDocument([
        {
          type: "List",
          ordered: true,
          items: [
            { type: "ListItem", content: [], children: [] },
          ],
        },
      ]);
      const symbols = createSymbolTable();

      const result = style(doc, symbols);
      expect(result.styledDocument.numberingDefinitions.length).toBeGreaterThan(0);
      const firstDef = result.styledDocument.numberingDefinitions[0];
      expect(firstDef).toBeDefined();
      expect(firstDef!.levels[0]!.format).toBe("decimal");
    });

    test("collects numbering from unordered list", () => {
      const doc = createDocument([
        {
          type: "List",
          ordered: false,
          items: [
            { type: "ListItem", content: [], children: [] },
          ],
        },
      ]);
      const symbols = createSymbolTable();

      const result = style(doc, symbols);
      expect(result.styledDocument.numberingDefinitions.length).toBeGreaterThan(0);
      const firstDef = result.styledDocument.numberingDefinitions[0];
      expect(firstDef).toBeDefined();
      expect(firstDef!.levels[0]!.format).toBe("bullet");
    });
  });
});
