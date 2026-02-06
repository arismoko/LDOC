/**
 * Phase 5: EMIT tests
 */

import { describe, test, expect } from "bun:test";
import { emit, emitSync, createNumberingConfig, toRunOptions, toParagraphOptions } from "../src/emit/index.ts";
import { style } from "../src/style/index.ts";
import { createSymbolTable } from "../src/types/symbols.ts";
import type { Document, Block, Paragraph, Heading, List, Table } from "../src/types/document-ir.ts";
import type { NumberingDefinition, ComputedStyle } from "../src/types/styled.ts";
import { DEFAULT_STYLE } from "../src/types/styled.ts";
import { loc } from "../src/types/source-location.ts";

// =============================================================================
// Helpers
// =============================================================================

function createDocument(blocks: Block[]): Document {
  return {
    type: "Document",
    metadata: { custom: {} },
    blocks,
  };
}

function createParagraph(text: string): Paragraph {
  return {
    type: "Paragraph",
    content: [{ type: "Text", value: text }],
  };
}

function createHeading(level: 1 | 2 | 3 | 4 | 5 | 6, text: string): Heading {
  return {
    type: "Heading",
    level,
    content: [{ type: "Text", value: text }],
  };
}

function createList(ordered: boolean, items: string[]): List {
  return {
    type: "List",
    ordered,
    items: items.map((text) => ({
      type: "ListItem" as const,
      content: [{ type: "Text" as const, value: text }],
      children: [],
    })),
  };
}

function createTable(rows: string[][]): Table {
  return {
    type: "Table",
    rows: rows.map((cells, i) => ({
      type: "TableRow" as const,
      cells: cells.map((text) => ({
        type: "TableCell" as const,
        content: [createParagraph(text)],
      })),
      isHeader: i === 0,
    })),
  };
}

// =============================================================================
// Tests: Numbering Config
// =============================================================================

describe("EMIT Phase", () => {
  describe("numbering config", () => {
    test("creates config from numbering definitions", () => {
      const definitions: NumberingDefinition[] = [
        {
          id: "num1",
          levels: [
            { level: 0, format: "decimal", text: "%1.", indent: 720, hanging: 360 },
          ],
        },
      ];

      const config = createNumberingConfig(definitions);

      expect(config.config).toBeDefined();
      expect(config.config.length).toBeGreaterThanOrEqual(1);
      expect(config.config[0]!.reference).toBe("num1");
    });

    test("adds default bullet list if not present", () => {
      const definitions: NumberingDefinition[] = [];
      const config = createNumberingConfig(definitions);

      const hasBullets = config.config.some((c) => c.reference === "bullets");
      expect(hasBullets).toBe(true);
    });

    test("adds default ordered list if not present", () => {
      const definitions: NumberingDefinition[] = [];
      const config = createNumberingConfig(definitions);

      const hasOrdered = config.config.some((c) => c.reference === "ordered-decimal");
      expect(hasOrdered).toBe(true);
    });
  });

  // =============================================================================
  // Tests: Style Conversion
  // =============================================================================

  describe("style conversion", () => {
    test("toRunOptions converts computed style to run options", () => {
      const style: ComputedStyle = {
        ...DEFAULT_STYLE,
        bold: true,
        italic: true,
        fontSize: 28,
        color: "FF0000",
      };

      const opts = toRunOptions(style);

      expect(opts.bold).toBe(true);
      expect(opts.italics).toBe(true);
      expect(opts.size).toBe(28);
      expect(opts.color).toBe("FF0000");
    });

    test("toRunOptions omits default values", () => {
      const opts = toRunOptions(DEFAULT_STYLE);

      expect(opts.bold).toBeUndefined();
      expect(opts.italics).toBeUndefined();
      expect(opts.color).toBeUndefined(); // default black is omitted
    });

    test("toParagraphOptions converts alignment and spacing", () => {
      const style: ComputedStyle = {
        ...DEFAULT_STYLE,
        textAlign: "center",
        spaceBefore: 240,
        spaceAfter: 120,
      };

      const opts = toParagraphOptions(style);

      expect(opts.alignment).toBeDefined();
      expect(opts.spacing?.before).toBe(240);
      expect(opts.spacing?.after).toBe(120);
    });

    test("toParagraphOptions converts indentation", () => {
      const style: ComputedStyle = {
        ...DEFAULT_STYLE,
        indentLeft: 720,
        indentFirstLine: 360,
      };

      const opts = toParagraphOptions(style);

      expect(opts.indent?.left).toBe(720);
      expect(opts.indent?.firstLine).toBe(360);
    });
  });

  // =============================================================================
  // Tests: Document Emission
  // =============================================================================

  describe("document emission", () => {
    test("emitSync creates a Document from simple paragraph", () => {
      const doc = createDocument([createParagraph("Hello, World!")]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });

    test("emitSync handles headings", () => {
      const doc = createDocument([
        createHeading(1, "Title"),
        createParagraph("Content"),
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });

    test("emitSync handles lists", () => {
      const doc = createDocument([
        createList(false, ["Item 1", "Item 2", "Item 3"]),
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });

    test("emitSync handles ordered lists", () => {
      const doc = createDocument([
        createList(true, ["First", "Second", "Third"]),
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });

    test("emitSync handles tables", () => {
      const doc = createDocument([
        createTable([
          ["Header 1", "Header 2"],
          ["Cell 1", "Cell 2"],
        ]),
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });

    test("emit produces a Buffer", async () => {
      const doc = createDocument([createParagraph("Test content")]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { buffer, diagnostics } = await emit(styledDocument);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      expect(diagnostics).toHaveLength(0);
    });

    test("emit produces valid DOCX (ZIP) file", async () => {
      const doc = createDocument([
        createHeading(1, "Test Document"),
        createParagraph("This is a test paragraph."),
        createList(false, ["Item A", "Item B"]),
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { buffer } = await emit(styledDocument);

      // DOCX files are ZIP files - check for PK signature
      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    });
  });

  // =============================================================================
  // Tests: Inline Formatting
  // =============================================================================

  describe("inline formatting", () => {
    test("handles bold and italic", () => {
      const doc = createDocument([
        {
          type: "Paragraph",
          content: [
            { type: "Text", value: "Normal " },
            { type: "Bold", content: [{ type: "Text", value: "bold" }] },
            { type: "Text", value: " and " },
            { type: "Italic", content: [{ type: "Text", value: "italic" }] },
          ],
        },
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });

    test("handles links", () => {
      const doc = createDocument([
        {
          type: "Paragraph",
          content: [
            { type: "Text", value: "Visit " },
            { 
              type: "Link", 
              content: [{ type: "Text", value: "example.com" }],
              url: "https://example.com",
            },
          ],
        },
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });

    test("handles inline code", () => {
      const doc = createDocument([
        {
          type: "Paragraph",
          content: [
            { type: "Text", value: "Use " },
            { type: "Code", value: "console.log()" },
            { type: "Text", value: " for debugging" },
          ],
        },
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });
  });

  // =============================================================================
  // Tests: Special Elements
  // =============================================================================

  describe("special elements", () => {
    test("handles page breaks", () => {
      const doc = createDocument([
        createParagraph("Before"),
        { type: "PageBreak" },
        createParagraph("After"),
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });

    test("handles horizontal rules", () => {
      const doc = createDocument([
        createParagraph("Above"),
        { type: "HorizontalRule" },
        createParagraph("Below"),
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics).toHaveLength(0);
    });
  });

  // =============================================================================
  // Tests: Error Handling
  // =============================================================================

  describe("error handling", () => {
    test("emits warning for missing image", () => {
      const doc = createDocument([
        {
          type: "Paragraph",
          content: [
            { 
              type: "Image", 
              src: "nonexistent.png",
              alt: "Missing image",
            },
          ],
        },
      ]);
      const symbols = createSymbolTable();
      const { styledDocument } = style(doc, symbols);

      const { document, diagnostics } = emitSync(styledDocument);

      expect(document).toBeDefined();
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]!.severity).toBe("warning");
      expect(diagnostics[0]!.message).toContain("nonexistent.png");
    });
  });
});
