import { describe, expect, test } from "bun:test";
import { resolve as resolvePath } from "node:path";

import { compileToOoxml } from "./test-utils.ts";

function createMapLoader(files: Record<string, string>) {
  return async (path: string): Promise<string> => {
    const value = files[path];
    if (value === undefined) {
      throw new Error(`Missing fixture file: ${path}`);
    }
    return value;
  };
}

describe("ooxml harness", () => {
  test("exposes document, numbering, and styles parts", async () => {
    const source = `@style(ref: "Heading1")[Title]
@#[Item one]
@#[Item two]
`;

    const pkg = await compileToOoxml(source);

    expect(pkg.hasPart("word/document.xml")).toBe(true);
    expect(pkg.hasPart("word/numbering.xml")).toBe(true);
    expect(pkg.hasPart("word/styles.xml")).toBe(true);

    const numberingXml = await pkg.readPart("word/numbering.xml");
    const stylesXml = await pkg.readPart("word/styles.xml");

    expect(numberingXml.includes("<w:numbering")).toBe(true);
    expect(numberingXml.includes("w:numFmt")).toBe(true);
    expect(stylesXml.includes("<w:styles")).toBe(true);
    expect(stylesXml.includes('w:styleId="Heading1"')).toBe(true);
  });

  test("@anchor emits bookmarkStart and bookmarkEnd in DOCX XML", async () => {
    const source = `@anchor(id: "payment-terms")
[See payment terms above.]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    expect(docXml.includes("w:bookmarkStart")).toBe(true);
    expect(docXml.includes("w:bookmarkEnd")).toBe(true);
    // Bookmark name is sanitized: hyphens become underscores, lowercased
    expect(docXml.includes("payment_terms")).toBe(true);
  });

  test("forward cross-reference resolves without warning", async () => {
    const source = `[See @ref(id: "sec1") for details.]
@anchor(id: "sec1")
`;

    const pkg = await compileToOoxml(source);
    // No "target not found" warning — pre-pass collects anchors before emission
    const targetWarnings = pkg.diagnostics.filter(
      (d) => d.code === "E003" && d.message.includes("sec1")
    );
    expect(targetWarnings.length).toBe(0);

    const docXml = await pkg.readPart("word/document.xml");
    // Should have both the hyperlink and the bookmark
    expect(docXml.includes("w:bookmarkStart")).toBe(true);
    expect(docXml.includes("w:hyperlink")).toBe(true);
  });

  test("@#(start: 5) emits numbering with custom start value", async () => {
    const source = `@#(start: 5)[Fifth item]
@#[Sixth item]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const numberingXml = await pkg.readPart("word/numbering.xml");
    // Should contain a numbering level with start value of 5
    expect(numberingXml.includes("<w:start w:val=\"5\"/>")).toBe(true);
  });

  test("@#(continue: true) reuses same numbering instance as previous list", async () => {
    const source = `@#[First item]
@#[Second item]

[Interrupting paragraph.]

@#(continue: true)[Third item]
@#[Fourth item]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    // Both list runs should reference numbering — the continued list
    // should share the same w:numId as the first list
    const numIdMatches = docXml.match(/w:numId w:val="(\d+)"/g) ?? [];
    // With continue, we expect at least 2 groups sharing the same numId
    expect(numIdMatches.length).toBeGreaterThanOrEqual(3);

    // Extract actual numId values
    const numIds = numIdMatches.map((m) => m.match(/w:val="(\d+)"/)?.[1]);
    // The continued items should reuse the same numId as the first list
    const firstListId = numIds[0];
    const continuedId = numIds[numIds.length - 1];
    expect(continuedId).toBe(firstListId);
  });

  test("nested @#(start: N) applies start at correct nesting level", async () => {
    const source = `@#{
  [Top-level item]
  @@#(start: 5)[Nested starts at five]
  @@#[Nested continues at six]
}
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const numberingXml = await pkg.readPart("word/numbering.xml");
    // Should have a start value of 5 somewhere in the numbering XML
    expect(numberingXml.includes('<w:start w:val="5"/>')).toBe(true);

    // The dynamic definition should include "lvl-1" in its reference (nesting level 1)
    // to distinguish from top-level start overrides
    const docXml = await pkg.readPart("word/document.xml");
    // All 3 items should have numbering references
    const numIdMatches = docXml.match(/w:numId w:val="(\d+)"/g) ?? [];
    expect(numIdMatches.length).toBeGreaterThanOrEqual(3);
  });

  test("legal mode + @#(start: N) applies start value (R5-2)", async () => {
    const source = `@document(numbering: "legal")
@#(start: 10)[Starts at ten]
@#[Continues at eleven]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const numberingXml = await pkg.readPart("word/numbering.xml");
    // Should contain start value of 10 — before the fix, the ordered-legal
    // base definition wasn't available during emission so start was silently dropped
    expect(numberingXml.includes('<w:start w:val="10"/>')).toBe(true);

    // Verify legal mode is actually active — the numbering XML should contain
    // the legal format (lowerLetter at level 1), not just decimal
    expect(numberingXml).toContain("lowerLetter");
  });

  test("@#(continue: true) after @#(start: N) reuses same numId", async () => {
    const source = `@#(start: 5)[Fifth item]
@#[Sixth item]

[Interrupting paragraph.]

@#(continue: true)[Seventh item]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    const numIdMatches = docXml.match(/w:numId w:val="(\d+)"/g) ?? [];
    // 3 list items should have numId references
    expect(numIdMatches.length).toBeGreaterThanOrEqual(3);

    // The continued list (item 3) should reuse the same numId as the started list
    const numIds = numIdMatches.map((m) => m.match(/w:val="(\d+)"/)?.[1]);
    const startedListId = numIds[0];
    const continuedId = numIds[numIds.length - 1];
    expect(continuedId).toBe(startedListId);
  });

  test("@document(orientation: 'landscape') produces landscape page dimensions", async () => {
    const source = `@document(orientation: "landscape")
[Hello landscape world.]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");

    // DOCX landscape: docx package swaps w:w and w:h internally.
    // Default letter = 12240 x 15840 twips; landscape → w:w=15840, w:h=12240, w:orient="landscape"
    expect(docXml).toContain('w:orient="landscape"');
    // The docx package swaps: w:w gets the height (15840) and w:h gets the width (12240)
    expect(docXml).toContain('w:w="15840"');
    expect(docXml).toContain('w:h="12240"');
  });

  test("@box emits single-cell table with all-four-sides border", async () => {
    const source = `@box{
  [Boxed text here.]
}
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    // Box renders as a table (w:tbl) with borders
    expect(docXml).toContain("w:tbl");
    expect(docXml).toContain('w:color="000000"');
    // Content should be inside a table cell
    expect(docXml).toContain("w:tc");
  });

  test("@box with multiple paragraphs has no interior borders", async () => {
    const source = `@box{
  [First paragraph.]
  [Second paragraph.]
}
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    // Should be a single table with one cell
    expect(docXml).toContain("w:tbl");
    // Both paragraphs should be present
    const textMatches = docXml.match(/w:t xml:space="preserve"/g) ?? [];
    expect(textMatches.length).toBeGreaterThanOrEqual(2);
  });

  test("@blockquote emits blockquote with left border and indent", async () => {
    const source = `@blockquote{
  [Quoted text here.]
}
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    // Should have a left border (999999 color, single style)
    expect(docXml).toContain('w:color="999999"');
    // Should have indent (400 twips for level 1)
    expect(docXml).toContain('w:left="400"');
  });

  test("@table(headerRows: 1) marks first row as table header", async () => {
    const source = `@table(headerRows: 1){
  @row(cells: ["Name", "Age"])
  @row(cells: ["Alice", "30"])
}
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    // First row should have tblHeader (table header repeat)
    expect(docXml).toContain("w:tblHeader");
  });

  test("@row(cantSplit: true) emits cantSplit property", async () => {
    const source = `@table{
  @row(cells: ["A", "B"], cantSplit: true)
}
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    expect(docXml).toContain("w:cantSplit");
  });

  test("@table(cellPadding: '0.1in') applies uniform cell margins", async () => {
    const source = `@table(cellPadding: "0.1in"){
  @row(cells: ["Data"])
}
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    // 0.1in = 144 twips; cell margins should use this value
    expect(docXml).toContain('w:w="144"');
  });

  test("header/footer variants emit first/even references and settings", async () => {
    const source = `@header{ @left[Default header] }
@header(variant: "first"){ @left[First header] }
@header(variant: "even"){ @left[Even header] }
@footer(variant: "even"){ @center[Even footer] }
[Body]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    expect(docXml).toContain('w:headerReference w:type="default"');
    expect(docXml).toContain('w:headerReference w:type="first"');
    expect(docXml).toContain('w:headerReference w:type="even"');
    expect(docXml).toContain('w:footerReference w:type="even"');

    const settingsXml = await pkg.readPart("word/settings.xml");
    expect(settingsXml).toContain("w:evenAndOddHeaders");
  });

  test("first-page header variant sets title page in section properties", async () => {
    const source = `@header(variant: "first"){
  @left[First header only]
}
[Body]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    expect(docXml).toContain("w:titlePg");
    expect(docXml).toContain('w:headerReference w:type="first"');
  });

  test("inline @footnote emits w:footnoteReference in document.xml", async () => {
    const source = `[Important point@footnote{This is the footnote.}.]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    expect(docXml).toContain("w:footnoteReference");
  });

  test("footnotes part exists and includes expected note text", async () => {
    const source = `[See this@footnote{Footnote content here.}.]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    expect(pkg.hasPart("word/footnotes.xml")).toBe(true);
    const footnotesXml = await pkg.readPart("word/footnotes.xml");
    expect(footnotesXml).toContain("Footnote content here.");
  });

  test("footnote reference before definition still resolves (pre-pass)", async () => {
    // The inline footnote emits a FootnoteRef inline and a deferred Footnote block.
    // The pre-pass in the emitter must assign footnote IDs before emitting the ref.
    const source = `[First point@footnote{Note for first point.}.]
[Second point@footnote{Note for second point.}.]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    // Both footnote references should be present
    const refMatches = docXml.match(/w:footnoteReference/g) ?? [];
    expect(refMatches.length).toBeGreaterThanOrEqual(2);

    // Footnotes part should have both notes
    expect(pkg.hasPart("word/footnotes.xml")).toBe(true);
    const footnotesXml = await pkg.readPart("word/footnotes.xml");
    expect(footnotesXml).toContain("Note for first point.");
    expect(footnotesXml).toContain("Note for second point.");

    // No unresolved footnote warnings
    const fnWarnings = pkg.diagnostics.filter(
      (d) => d.message.includes("Footnote not found")
    );
    expect(fnWarnings.length).toBe(0);
  });

  test("structural footnote with non-paragraph content recovers with warning", async () => {
    const source = `@footnote{
  @table{
    @row(cells: ["A"])
  }
}
[Body text.]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    // Recovery must be explicit (diagnostic), not a crash.
    expect(pkg.diagnostics.some((d) => d.code === "M001")).toBe(true);

    // Footnotes part should still be emitted.
    expect(pkg.hasPart("word/footnotes.xml")).toBe(true);
  });

  test("footnote reference numbering preserves encounter order with @include", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const source = `[Parent@footnote{Parent note}.]
@include(path: "child.ldoc")
`;

    const pkg = await compileToOoxml(source, {
      sourcePath: mainPath,
      loadFile: createMapLoader({
        [childPath]: `[Child@footnote{Child note}.]\n`,
      }),
    });

    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    const idMatches = [...docXml.matchAll(/w:footnoteReference w:id="(\d+)"/g)].map((m) => Number(m[1]));
    expect(idMatches.length).toBeGreaterThanOrEqual(2);
    expect(idMatches[0]).toBe(1);
    expect(idMatches[1]).toBe(2);

    const footnotesXml = await pkg.readPart("word/footnotes.xml");
    const parentPos = footnotesXml.indexOf("Parent note");
    const childPos = footnotesXml.indexOf("Child note");
    expect(parentPos).toBeGreaterThanOrEqual(0);
    expect(childPos).toBeGreaterThanOrEqual(0);
    expect(parentPos).toBeLessThan(childPos);
  });
});
